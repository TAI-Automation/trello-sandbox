import { trelloLabelColors } from "../config/projectConfigurator.js";
import {
  listActiveDepartments,
  listActiveProjects,
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
  colors: {
    all: string[];
    usedDepartmentColors: string[];
    availableDepartmentColors: string[];
  };
};

export async function getProjectConfiguratorState(
  trelloMemberId: string
): Promise<ProjectConfiguratorState> {
  const [viewer, departments, projects] = await Promise.all([
    resolveProjectConfiguratorViewer(trelloMemberId),
    listActiveDepartments(),
    listActiveProjects(),
  ]);
  const usedDepartmentColors = departments.map(
    (department) => department.departmentColor
  );
  const usedDepartmentColorSet = new Set(usedDepartmentColors);

  return {
    viewer,
    capabilities: resolveCapabilities(),
    departments,
    projects,
    colors: {
      all: [...trelloLabelColors],
      usedDepartmentColors,
      availableDepartmentColors: trelloLabelColors.filter(
        (color) => !usedDepartmentColorSet.has(color)
      ),
    },
  };
}
