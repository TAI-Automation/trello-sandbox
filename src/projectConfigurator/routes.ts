import express from "express";

import { isTrelloLabelColor } from "../config/projectConfigurator.js";
import {
  activeDepartmentExists,
  activeProjectExists,
  createDepartment,
  createProject,
  deleteDepartment,
  deleteProject,
  updateDepartmentColor,
  updateDepartmentName,
  updateProjectColor,
  updateProjectName,
} from "./repository.js";
import { syncAllConfiguredLabels } from "./labelSync.js";
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
  "/api/project-configurator/labels/sync",
  async (req, res, next) => {
    try {
      readRequiredString(req.body, "trelloMemberId");
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");

      res.json({ labelSync: await syncAllConfiguredLabels(trelloBoardId) });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/departments",
  async (req, res, next) => {
    try {
      const name = readRequiredString(req.body, "name");
      const departmentColor = readRequiredString(req.body, "departmentColor");
      const sortOrder = readOptionalInteger(req.body, "sortOrder");

      assertTrelloColor(departmentColor, "departmentColor");

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
  "/api/project-configurator/departments/:departmentId/name",
  async (req, res, next) => {
    try {
      const name = readRequiredString(req.body, "name");
      const department = await updateDepartmentName({
        departmentId: req.params.departmentId,
        name,
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

projectConfiguratorRouter.patch(
  "/api/project-configurator/departments/:departmentId/color",
  async (req, res, next) => {
    try {
      const departmentColor = readRequiredString(req.body, "departmentColor");

      assertTrelloColor(departmentColor, "departmentColor");

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

projectConfiguratorRouter.delete(
  "/api/project-configurator/departments/:departmentId",
  async (req, res, next) => {
    try {
      readRequiredString(req.body, "trelloMemberId");

      if (!(await activeDepartmentExists(req.params.departmentId))) {
        throw new NotFoundError("Department was not found.");
      }

      const deleted = await deleteDepartment(req.params.departmentId);

      if (!deleted) {
        throw new NotFoundError("Department was not found.");
      }

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
      const name = readRequiredString(req.body, "name");
      const projectColor = readRequiredString(req.body, "projectColor");

      assertTrelloColor(projectColor, "projectColor");

      const project = await createProject({
        name,
        projectColor,
      });

      res.status(201).json({ project });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.patch(
  "/api/project-configurator/projects/:projectId/name",
  async (req, res, next) => {
    try {
      const name = readRequiredString(req.body, "name");

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const project = await updateProjectName({
        projectId: req.params.projectId,
        name,
      });

      if (!project) {
        throw new NotFoundError("Project was not found.");
      }

      res.json({ project });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.patch(
  "/api/project-configurator/projects/:projectId/color",
  async (req, res, next) => {
    try {
      const projectColor = readRequiredString(req.body, "projectColor");

      assertTrelloColor(projectColor, "projectColor");

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const project = await updateProjectColor({
        projectId: req.params.projectId,
        projectColor,
      });

      if (!project) {
        throw new NotFoundError("Project was not found.");
      }

      res.json({ project });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.delete(
  "/api/project-configurator/projects/:projectId",
  async (req, res, next) => {
    try {
      readRequiredString(req.body, "trelloMemberId");

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const deleted = await deleteProject(req.params.projectId);

      if (!deleted) {
        throw new NotFoundError("Project was not found.");
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

function assertTrelloColor(value: string, key: string): void {
  if (!isTrelloLabelColor(value)) {
    throw new BadRequestError(`${key} must be a valid Trello color.`);
  }
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

class NotFoundError extends Error {
  status = 404;
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
