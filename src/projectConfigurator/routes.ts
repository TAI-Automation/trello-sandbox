import express from "express";

import { isTrelloLabelColor } from "../config/projectConfigurator.js";
import {
  addDepartmentManager,
  addProjectManager,
  activeDepartmentExists,
  createDepartment,
  createProject,
  getProjectDepartmentId,
  updateDepartmentColor,
} from "./repository.js";
import {
  canAssignProjectManagersInDepartment,
  canManageDepartment,
  resolveCapabilities,
  resolveProjectConfiguratorViewer,
} from "./permissions.js";
import { syncAllProjectLabels } from "./labelSync.js";
import { getProjectConfiguratorState } from "./state.js";

export const projectConfiguratorRouter = express.Router();

projectConfiguratorRouter.post(
  "/api/project-configurator/state",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const state = await getProjectConfiguratorState(trelloMemberId);

      res.json(state);
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/departments",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const name = readRequiredString(req.body, "name");
      const departmentColor = readRequiredString(req.body, "departmentColor");
      const sortOrder = readOptionalInteger(req.body, "sortOrder");
      const { capabilities } = await resolveViewerAndCapabilities(
        trelloMemberId
      );

      if (!capabilities.canCreateDepartments) {
        throw new ForbiddenError("Only Workspace admins can create departments.");
      }

      if (!isTrelloLabelColor(departmentColor)) {
        throw new BadRequestError(
          "departmentColor must be a valid Trello color."
        );
      }

      const department = await createDepartment({
        name,
        departmentColor,
        sortOrder,
      });

      res.status(201).json({ department });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.patch(
  "/api/project-configurator/departments/:departmentId/color",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const departmentColor = readRequiredString(req.body, "departmentColor");
      const { capabilities } = await resolveViewerAndCapabilities(
        trelloMemberId
      );

      if (!capabilities.canCreateDepartments) {
        throw new ForbiddenError(
          "Only Workspace admins can change department colors."
        );
      }

      if (!isTrelloLabelColor(departmentColor)) {
        throw new BadRequestError(
          "departmentColor must be a valid Trello color."
        );
      }

      const department = await updateDepartmentColor({
        departmentId: req.params.departmentId,
        departmentColor,
      });

      if (!department) {
        throw new NotFoundError("Department was not found.");
      }

      res.json({ department });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/departments/:departmentId/managers",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const managerTrelloMemberId = readRequiredString(
        req.body,
        "managerTrelloMemberId"
      );
      const { capabilities } = await resolveViewerAndCapabilities(
        trelloMemberId
      );

      if (!capabilities.canAssignDepartmentManagers) {
        throw new ForbiddenError(
          "Only Workspace admins can assign department managers."
        );
      }

      if (!(await activeDepartmentExists(req.params.departmentId))) {
        throw new NotFoundError("Department was not found.");
      }

      await addDepartmentManager({
        departmentId: req.params.departmentId,
        managerTrelloMemberId,
        grantedByMemberId: trelloMemberId,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/projects",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const departmentId = readRequiredString(req.body, "departmentId");
      const name = readRequiredString(req.body, "name");
      const labelText = readOptionalString(req.body, "labelText") ?? name;
      const { capabilities } = await resolveViewerAndCapabilities(
        trelloMemberId
      );

      if (!canManageDepartment(capabilities, departmentId)) {
        throw new ForbiddenError(
          "Only Workspace admins and assigned department managers can create projects."
        );
      }

      if (!(await activeDepartmentExists(departmentId))) {
        throw new NotFoundError("Department was not found.");
      }

      const project = await createProject({
        departmentId,
        name,
        labelText,
      });
      const labelSync = await syncAllProjectLabels();

      res.status(201).json({ project, labelSync });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/projects/:projectId/managers",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const managerTrelloMemberId = readRequiredString(
        req.body,
        "managerTrelloMemberId"
      );
      const projectDepartmentId = await getProjectDepartmentId(
        req.params.projectId
      );

      if (!projectDepartmentId) {
        throw new NotFoundError("Project was not found.");
      }

      const { capabilities } = await resolveViewerAndCapabilities(
        trelloMemberId
      );

      if (
        !canAssignProjectManagersInDepartment(
          capabilities,
          projectDepartmentId
        )
      ) {
        throw new ForbiddenError(
          "Only Workspace admins and assigned department managers can assign project managers."
        );
      }

      await addProjectManager({
        projectId: req.params.projectId,
        managerTrelloMemberId,
        grantedByMemberId: trelloMemberId,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

async function resolveViewerAndCapabilities(trelloMemberId: string) {
  const viewer = await resolveProjectConfiguratorViewer(trelloMemberId);

  return {
    viewer,
    capabilities: resolveCapabilities(viewer),
  };
}

function readRequiredString(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`${key} must be a non-empty string.`);
  }

  return value.trim();
}

export class BadRequestError extends Error {
  status = 400;
}

class ForbiddenError extends Error {
  status = 403;
}

class NotFoundError extends Error {
  status = 404;
}

function readOptionalString(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object" || !(key in body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>)[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`${key} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalInteger(body: unknown, key: string): number | undefined {
  if (!body || typeof body !== "object" || !(key in body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>)[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestError(`${key} must be an integer.`);
  }

  return value;
}
