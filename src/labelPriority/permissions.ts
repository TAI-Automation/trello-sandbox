import {
  resolveProjectConfiguratorViewer,
  type ProjectConfiguratorViewer,
} from "../projectConfigurator/permissions.js";
import { isProjectManagerForBoardProjectLabel } from "../projectConfigurator/repository.js";
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
  const canModify =
    viewer.role === "admin" ||
    (await isProjectManagerForBoardProjectLabel({
      trelloBoardId: card.idBoard,
      trelloMemberId: input.trelloMemberId,
      trelloLabelIds: card.idLabels,
    }));

  return {
    viewer,
    canModify,
    reason: canModify
      ? null
      : "Only Workspace admins or the matching project managers can change priorities.",
    card,
  };
}
