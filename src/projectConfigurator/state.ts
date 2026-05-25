import { trelloLabelColors } from "../config/projectConfigurator.js";
import {
  listActiveDepartments,
  listActiveProjects,
  listDepartmentManagerAssignments,
  listMembers,
  listProjectManagerAssignments,
} from "./repository.js";
import {
  resolveCapabilities,
  resolveProjectConfiguratorViewer,
  type ProjectConfiguratorCapabilities,
  type ProjectConfiguratorViewer,
} from "./permissions.js";

export type ProjectConfiguratorState = {
  viewer: ProjectConfiguratorViewer;
  capabilities: ProjectConfiguratorCapabilities;
  departments: Awaited<ReturnType<typeof listActiveDepartments>>;
  projects: Awaited<ReturnType<typeof listActiveProjects>>;
  departmentManagers: Awaited<
    ReturnType<typeof listDepartmentManagerAssignments>
  >;
  projectManagers: Awaited<ReturnType<typeof listProjectManagerAssignments>>;
  members: Awaited<ReturnType<typeof listMembers>>;
  colors: {
    all: string[];
    used: string[];
    available: string[];
  };
};

export async function getProjectConfiguratorState(
  trelloMemberId: string
): Promise<ProjectConfiguratorState> {
  const viewer = await resolveProjectConfiguratorViewer(trelloMemberId);
  const capabilities = resolveCapabilities(viewer);

  const [
    departments,
    projects,
    departmentManagers,
    projectManagers,
    members,
  ] = await Promise.all([
    listActiveDepartments(),
    listActiveProjects(),
    capabilities.canViewDepartmentManagers
      ? listDepartmentManagerAssignments()
      : Promise.resolve([]),
    listProjectManagerAssignments(),
    listMembers(),
  ]);

  const used = departments.map((department) => department.departmentColor);
  const usedSet = new Set(used);

  return {
    viewer,
    capabilities,
    departments,
    projects,
    departmentManagers,
    projectManagers,
    members,
    colors: {
      all: [...trelloLabelColors],
      used,
      available: trelloLabelColors.filter((color) => !usedSet.has(color)),
    },
  };
}
