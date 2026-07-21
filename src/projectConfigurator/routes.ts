import express from "express";

import { isTrelloLabelColor } from "../config/projectConfigurator.js";
import { listMembersByIds } from "../db/repositories/members.js";
import { getAppSettings } from "../enforcementDashboard/repository.js";
import {
  getProjectManagerFieldApplyJob,
  startProjectManagerFieldApplyJob,
} from "../shared/projectManagerFields/apply.js";
import {
  addProjectManager,
  activeDepartmentExists,
  activeProjectExists,
  createDepartment,
  createProject,
  deleteDepartment,
  getProject,
  removeProjectManager,
  deleteProjectSecondaryFolderRoute,
  replaceProjectSecondaryFolderRoutes,
  saveProjectSecondaryFolderRoute,
  updateDepartmentColor,
  updateDepartmentName,
  updateProjectColor,
  updateProjectName,
  upsertProjectFolderRoute,
} from "./repository.js";
import {
  getLabelSyncJob,
  getProjectLabelDeletionJob,
  startLabelSyncJob,
  startProjectLabelDeletionJob,
} from "./labelSync.js";
import { resolveProjectConfiguratorViewer } from "./permissions.js";
import { getProjectConfiguratorState } from "./state.js";

export const projectConfiguratorRouter = express.Router();

projectConfiguratorRouter.post(
  "/api/project-configurator/state",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");
      const state = await getProjectConfiguratorState(
        trelloMemberId,
        trelloBoardId
      );

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

      res.status(202).json({ labelSync: await startLabelSyncJob(trelloBoardId) });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/labels/sync/status",
  async (req, res, next) => {
    try {
      readRequiredString(req.body, "trelloMemberId");
      readRequiredString(req.body, "trelloBoardId");

      res.json({ labelSync: await getLabelSyncJob() });
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
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const projectManagerMemberIds = readOptionalStringArray(
        req.body,
        "projectManagerMemberIds"
      );

      assertTrelloColor(projectColor, "projectColor");
      if (projectManagerMemberIds.length > 0) {
        await requireAdmin(trelloMemberId);
        await assertProjectManagerSelection(projectManagerMemberIds);
      }

      const project = await createProject({
        name,
        projectColor,
        projectManagerMemberIds,
      });

      res.status(201).json({ project });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/projects/:projectId/project-managers",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const managerMemberId = readRequiredString(req.body, "managerMemberId");

      await requireAdmin(trelloMemberId);

      const project = await getProject(req.params.projectId);

      if (!project) {
        throw new NotFoundError("Project was not found.");
      }

      await assertProjectManagerSelection([
        ...project.projectManagers.map((manager) => manager.trelloMemberId),
        managerMemberId,
      ]);

      const updatedProject = await addProjectManager({
        projectId: req.params.projectId,
        trelloMemberId: managerMemberId,
      });

      res.json({ project: updatedProject });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.delete(
  "/api/project-configurator/projects/:projectId/project-managers/:managerMemberId",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");

      await requireAdmin(trelloMemberId);

      const project = await removeProjectManager({
        projectId: req.params.projectId,
        trelloMemberId: req.params.managerMemberId,
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

projectConfiguratorRouter.post(
  "/api/project-configurator/project-manager-fields/apply",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");

      await requireAdmin(trelloMemberId);

      res.status(202).json({
        apply: await startProjectManagerFieldApplyJob(trelloBoardId),
      });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/project-manager-fields/apply/status",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");

      await requireAdmin(trelloMemberId);

      res.json({
        apply: await getProjectManagerFieldApplyJob(trelloBoardId),
      });
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

projectConfiguratorRouter.patch(
  "/api/project-configurator/projects/:projectId/folder-path",
  async (req, res, next) => {
    try {
      const folderPath = readRequiredString(req.body, "folderPath");

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const project = await upsertProjectFolderRoute({
        projectId: req.params.projectId,
        folderPath,
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
  "/api/project-configurator/projects/:projectId/secondary-folder-path",
  async (req, res, next) => {
    try {
      const folderPath = readRequiredString(req.body, "folderPath");
      const originalFolderPath = readOptionalString(
        req.body,
        "originalFolderPath"
      );

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const project = await saveProjectSecondaryFolderRoute({
        projectId: req.params.projectId,
        folderPath,
        originalFolderPath,
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
  "/api/project-configurator/projects/:projectId/secondary-folder-path",
  async (req, res, next) => {
    try {
      const folderPath = readRequiredString(req.body, "folderPath");

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const project = await deleteProjectSecondaryFolderRoute({
        projectId: req.params.projectId,
        folderPath,
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
  "/api/project-configurator/projects/:projectId/secondary-folder-paths",
  async (req, res, next) => {
    try {
      const paths = readPathList(req.body, "paths");

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const project = await replaceProjectSecondaryFolderRoutes({
        projectId: req.params.projectId,
        paths,
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
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");

      if (!(await activeProjectExists(req.params.projectId))) {
        throw new NotFoundError("Project was not found.");
      }

      const deletion = await startProjectLabelDeletionJob(
        req.params.projectId,
        trelloBoardId
      );

      if (deletion.done && deletion.error) {
        throw new Error(deletion.error);
      }

      res.status(202).json({ projectDeletion: deletion });
    } catch (error) {
      next(error);
    }
  }
);

projectConfiguratorRouter.post(
  "/api/project-configurator/projects/:projectId/delete/status",
  async (req, res, next) => {
    try {
      readRequiredString(req.body, "trelloMemberId");
      readRequiredString(req.body, "trelloBoardId");

      const deletion = await getProjectLabelDeletionJob(req.params.projectId);

      if (!deletion) {
        throw new NotFoundError("Project was not found.");
      }

      res.json({ projectDeletion: deletion });
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

function readOptionalStringArray(body: unknown, key: string): string[] {
  if (!body || typeof body !== "object" || !(key in body)) {
    return [];
  }

  const value = (body as Record<string, unknown>)[key];

  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadRequestError(`${key} must be an array.`);
  }

  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0
    )
    .map((item) => item.trim());
}

function readOptionalString(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object" || !(key in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadRequestError(`${key} must be a string.`);
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readPathList(body: unknown, key: string): string[] {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (!Array.isArray(value)) {
    throw new BadRequestError(`${key} must be an array.`);
  }

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      throw new BadRequestError(`${key} must contain only strings.`);
    }

    const path = item.trim();

    if (!path || seen.has(path)) {
      continue;
    }

    seen.add(path);
    paths.push(path);
  }

  return paths;
}

async function requireAdmin(trelloMemberId: string): Promise<void> {
  const viewer = await resolveProjectConfiguratorViewer(trelloMemberId);

  if (viewer.role !== "admin") {
    throw new ForbiddenError("Only Trello workspace admins can do this.");
  }
}

async function assertProjectManagerSelection(
  trelloMemberIds: string[]
): Promise<void> {
  const uniqueMemberIds = [...new Set(trelloMemberIds)];
  const settings = await getAppSettings();

  if (uniqueMemberIds.length > settings.projectManagerCap) {
    throw new BadRequestError(
      `A project can have at most ${settings.projectManagerCap} project manager(s).`
    );
  }

  const members = await listMembersByIds(uniqueMemberIds);

  if (members.length !== uniqueMemberIds.length) {
    throw new BadRequestError("Project managers must be known board members.");
  }
}

export class BadRequestError extends Error {
  status = 400;
}

class NotFoundError extends Error {
  status = 404;
}

class ForbiddenError extends Error {
  status = 403;
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
