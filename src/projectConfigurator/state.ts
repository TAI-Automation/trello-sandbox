import { trelloLabelColors } from "../config/projectConfigurator.js";
import { getAppSettings } from "../enforcementDashboard/repository.js";
import { upsertMembers, type MemberRecord } from "../db/repositories/members.js";
import { fetchTrelloBoardMembers } from "../trello/api.js";
import {
  listActiveDepartments,
  listActiveProjectsWithSecondaryStatus,
} from "./repository.js";
import {
  getTrelloCredentials,
  resolveCapabilities,
  resolveProjectConfiguratorViewer,
  type ProjectConfiguratorCapabilities,
  type ProjectConfiguratorViewer,
} from "./permissions.js";

export type ProjectConfiguratorState = {
  viewer: ProjectConfiguratorViewer;
  capabilities: ProjectConfiguratorCapabilities;
  departments: Awaited<ReturnType<typeof listActiveDepartments>>;
  projects: Awaited<
    ReturnType<typeof listActiveProjectsWithSecondaryStatus>
  >["projects"];
  members: MemberRecord[];
  settings: {
    projectManagerCap: number;
  };
  errors: {
    secondaryFolderPaths: string | null;
  };
  colors: {
    all: string[];
    usedDepartmentColors: string[];
    availableDepartmentColors: string[];
  };
};

export async function getProjectConfiguratorState(
  trelloMemberId: string,
  trelloBoardId: string
): Promise<ProjectConfiguratorState> {
  const [viewer, departments, projectList, trelloMembers, settings] = await Promise.all([
    resolveProjectConfiguratorViewer(trelloMemberId),
    listActiveDepartments(),
    listActiveProjectsWithSecondaryStatus(),
    fetchTrelloBoardMembers(trelloBoardId, getTrelloCredentials()),
    getAppSettings(),
  ]);
  const members = await upsertMembers(
    trelloMembers.map((member) => ({
      trelloMemberId: member.id,
      displayName: member.fullName?.trim() || member.username || member.id,
      username: member.username ?? null,
    }))
  );
  const usedDepartmentColors = departments.map(
    (department) => department.departmentColor
  );
  const usedDepartmentColorSet = new Set(usedDepartmentColors);

  return {
    viewer,
    capabilities: resolveCapabilities(viewer),
    departments,
    projects: projectList.projects,
    members,
    settings,
    errors: {
      secondaryFolderPaths: projectList.secondaryFolderPathError,
    },
    colors: {
      all: [...trelloLabelColors],
      usedDepartmentColors,
      availableDepartmentColors: trelloLabelColors.filter(
        (color) => !usedDepartmentColorSet.has(color)
      ),
    },
  };
}
