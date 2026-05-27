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
  const canModify = viewer.role === "admin";

  return {
    viewer,
    canModify,
    reason: canModify ? null : "Only Workspace admins can change priorities.",
    card,
  };
}
