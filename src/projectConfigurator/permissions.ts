import {
  isTrelloWorkspaceAdmin,
  type TrelloCredentials,
} from "../trello/api.js";
import type { ProjectConfiguratorRole } from "../config/projectConfigurator.js";

export type ProjectConfiguratorViewer = {
  trelloMemberId: string;
  role: ProjectConfiguratorRole;
  managedDepartmentIds: string[];
  managedProjectIds: string[];
};

export type ProjectConfiguratorCapabilities = {
  canEditDepartments: boolean;
  canEditProjects: boolean;
  canSynchronizeLabels: boolean;
};

export function getOrganizationId(): string {
  const organizationId = process.env.ORGANIZATION_ID;

  if (!organizationId) {
    throw new Error("ORGANIZATION_ID is required.");
  }

  return organizationId;
}

export function getTrelloCredentials(): TrelloCredentials {
  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;

  if (!key || !token) {
    throw new Error("TRELLO_KEY and TRELLO_TOKEN are required.");
  }

  return { key, token };
}

export async function resolveProjectConfiguratorViewer(
  trelloMemberId: string
): Promise<ProjectConfiguratorViewer> {
  const isAdmin = await isTrelloWorkspaceAdmin(
    getOrganizationId(),
    trelloMemberId,
    getTrelloCredentials()
  );

  return {
    trelloMemberId,
    role: isAdmin ? "admin" : "normal_user",
    managedDepartmentIds: [],
    managedProjectIds: [],
  };
}

export function resolveCapabilities(): ProjectConfiguratorCapabilities {
  return {
    canEditDepartments: true,
    canEditProjects: true,
    canSynchronizeLabels: true,
  };
}
