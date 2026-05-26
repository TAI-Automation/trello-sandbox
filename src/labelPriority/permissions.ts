import { labelPriorityConfig } from "../config/labelPriority.js";
import {
  listBoardProjectLabels,
  listActiveProjects,
} from "../projectConfigurator/repository.js";
import {
  resolveProjectConfiguratorViewer,
  type ProjectConfiguratorViewer,
} from "../projectConfigurator/permissions.js";
import { fetchTrelloCard, type TrelloCard } from "../trello/api.js";
import { getTrelloCredentials } from "../projectConfigurator/permissions.js";

export type LabelPriorityPermissionResult = {
  viewer: ProjectConfiguratorViewer;
  canModify: boolean;
  reason: string | null;
  card: TrelloCard;
};

export async function resolveLabelPriorityPermission(input: {
  trelloMemberId: string;
  trelloCardId: string;
}): Promise<LabelPriorityPermissionResult> {
  const [viewer, card] = await Promise.all([
    resolveProjectConfiguratorViewer(input.trelloMemberId),
    fetchTrelloCard(input.trelloCardId, getTrelloCredentials()),
  ]);

  if (viewer.role === "admin" || viewer.role === "department_manager") {
    return { viewer, canModify: true, reason: null, card };
  }

  if (viewer.role !== "project_manager") {
    return {
      viewer,
      canModify: false,
      reason: "Only admins, department managers, and permitted project managers can change priorities.",
      card,
    };
  }

  if (!labelPriorityConfig.projectManagersCanModifyPriorities) {
    return {
      viewer,
      canModify: false,
      reason: "Project managers cannot change priorities right now.",
      card,
    };
  }

  const canManageCardProject = await cardHasManagedProjectLabel({
    card,
    managedProjectIds: viewer.managedProjectIds,
  });

  return {
    viewer,
    canModify: canManageCardProject,
    reason: canManageCardProject
      ? null
      : "Project managers can only change priorities for cards under their projects.",
    card,
  };
}

async function cardHasManagedProjectLabel(input: {
  card: TrelloCard;
  managedProjectIds: string[];
}): Promise<boolean> {
  if (input.managedProjectIds.length === 0 || input.card.idLabels.length === 0) {
    return false;
  }

  const [projects, boardLabels] = await Promise.all([
    listActiveProjects(),
    listBoardProjectLabels(input.card.idBoard),
  ]);
  const activeProjectIds = new Set(projects.map((project) => project.id));
  const managedProjectIds = new Set(input.managedProjectIds);
  const cardLabelIds = new Set(input.card.idLabels);

  return boardLabels.some(
    (label) =>
      label.syncStatus === "synced" &&
      activeProjectIds.has(label.projectId) &&
      managedProjectIds.has(label.projectId) &&
      cardLabelIds.has(label.trelloLabelId)
  );
}
