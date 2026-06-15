import { labelPriorityConfig } from "../config/labelPriority.js";
import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import { fetchTrelloCard, isTrelloNotFoundError } from "../trello/api.js";
import {
  deleteLabelPriority,
  listLabelPriorityCleanupCandidates,
  markLabelPriorityCardArchived,
  markLabelPriorityCardOpen,
} from "./repository.js";

export type LabelPriorityCleanupResult = {
  checked: number;
  deleted: number;
  kept: number;
  archivedMarked: number;
  errors: number;
};

export async function cleanupStaleLabelPriorities(): Promise<LabelPriorityCleanupResult> {
  const candidates = await listLabelPriorityCleanupCandidates();
  const result: LabelPriorityCleanupResult = {
    checked: candidates.length,
    deleted: 0,
    kept: 0,
    archivedMarked: 0,
    errors: 0,
  };
  const cutoff = Date.now() - labelPriorityConfig.archivedCleanupAfterDays * 24 * 60 * 60 * 1000;

  for (const candidate of candidates) {
    try {
      const card = await fetchTrelloCard(
        candidate.trelloCardId,
        getTrelloCredentials()
      );

      if (!card.closed) {
        await markLabelPriorityCardOpen(candidate.trelloCardId);
        result.kept += 1;
        continue;
      }

      if (
        candidate.archivedSince &&
        candidate.archivedSince.getTime() < cutoff
      ) {
        await deleteLabelPriority(candidate.trelloCardId);
        result.deleted += 1;
        continue;
      }

      await markLabelPriorityCardArchived(candidate.trelloCardId);
      result.archivedMarked += 1;
      result.kept += 1;
    } catch (error) {
      if (isTrelloNotFoundError(error)) {
        await deleteLabelPriority(candidate.trelloCardId);
        result.deleted += 1;
      } else {
        result.errors += 1;
      }
    }
  }

  return result;
}
