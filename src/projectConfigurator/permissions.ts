import {
  projectConfiguratorConfig,
  type ProjectConfiguratorRole,
} from "../config/projectConfigurator.js";
import {
  isTrelloWorkspaceAdmin,
  type TrelloCredentials,
} from "../trello/api.js";
import {
  listManagedDepartmentIds,
  listManagedProjectIds,
} from "./repository.js";

export type ProjectConfiguratorViewer = {
  trelloMemberId: string;
  role: ProjectConfiguratorRole;
  managedDepartmentIds: string[];
  managedProjectIds: string[];
};

export type ProjectConfiguratorCapabilities = {
  canViewDepartmentManagers: boolean;
  canCreateDepartments: boolean;
  canAssignDepartmentManagers: boolean;
  canCreateProjectsInDepartmentIds: string[];
  canAssignProjectManagersInDepartmentIds: string[];
  canDeleteProjectsInDepartmentIds: string[];
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
  const [isAdmin, managedDepartmentIds, managedProjectIds] = await Promise.all([
    isTrelloWorkspaceAdmin(
      getOrganizationId(),
      trelloMemberId,
      getTrelloCredentials()
    ),
    listManagedDepartmentIds(trelloMemberId),
    listManagedProjectIds(trelloMemberId),
  ]);

  const role = resolveRole({
    isAdmin,
    managedDepartmentIds,
    managedProjectIds,
  });

  return {
    trelloMemberId,
    role,
    managedDepartmentIds,
    managedProjectIds,
  };
}

export function resolveCapabilities(
  viewer: ProjectConfiguratorViewer
): ProjectConfiguratorCapabilities {
  const isAdmin = viewer.role === "admin";
  const canManageDepartments = isAdmin ? ["*"] : viewer.managedDepartmentIds;

  return {
    canViewDepartmentManagers:
      projectConfiguratorConfig.visibility.departmentManagersVisibleTo.includes(
        viewer.role
      ),
    canCreateDepartments: isAdmin,
    canAssignDepartmentManagers: isAdmin,
    canCreateProjectsInDepartmentIds: canManageDepartments,
    canAssignProjectManagersInDepartmentIds: canManageDepartments,
    canDeleteProjectsInDepartmentIds: canManageDepartments,
  };
}

export function canDeleteProjectsInDepartment(
  capabilities: ProjectConfiguratorCapabilities,
  departmentId: string
): boolean {
  return canUseDepartmentCapability(
    capabilities.canDeleteProjectsInDepartmentIds,
    departmentId
  );
}

export function canManageDepartment(
  capabilities: ProjectConfiguratorCapabilities,
  departmentId: string
): boolean {
  return canUseDepartmentCapability(
    capabilities.canCreateProjectsInDepartmentIds,
    departmentId
  );
}

export function canAssignProjectManagersInDepartment(
  capabilities: ProjectConfiguratorCapabilities,
  departmentId: string
): boolean {
  return canUseDepartmentCapability(
    capabilities.canAssignProjectManagersInDepartmentIds,
    departmentId
  );
}

function canUseDepartmentCapability(
  departmentIds: string[],
  departmentId: string
): boolean {
  return (
    departmentIds.includes("*") || departmentIds.includes(departmentId)
  );
}

function resolveRole({
  isAdmin,
  managedDepartmentIds,
  managedProjectIds,
}: {
  isAdmin: boolean;
  managedDepartmentIds: string[];
  managedProjectIds: string[];
}): ProjectConfiguratorRole {
  if (isAdmin) {
    return "admin";
  }

  if (managedDepartmentIds.length > 0) {
    return "department_manager";
  }

  if (managedProjectIds.length > 0) {
    return "project_manager";
  }

  return "normal_user";
}
