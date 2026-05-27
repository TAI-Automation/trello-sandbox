import {
  getDashboardBoard,
  saveBoardError,
  saveBoardWebhookState,
  upsertDashboardBoard,
} from "./repository.js";
import type { TrelloBoardRecord } from "../db/repositories/trelloBoards.js";
import { getPermissionManagerWebhookCallbackUrl } from "../permissionManagerEnforcer/config.js";
import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import {
  createTrelloWebhook,
  fetchTrelloBoard,
  fetchTrelloWebhook,
  updateTrelloWebhookActive,
  type TrelloWebhook,
} from "../trello/api.js";

export async function setBoardEnforcementState(input: {
  trelloBoardId: string;
  enabled: boolean;
}): Promise<TrelloBoardRecord> {
  try {
    const board = input.enabled
      ? await ensureDashboardBoard(input.trelloBoardId)
      : await getRequiredBoard(input.trelloBoardId);
    const webhook = input.enabled
      ? await ensureWebhookActive(board.trelloBoardId, board.trelloWebhookId)
      : await deactivateWebhookIfPresent(board.trelloWebhookId);
    const updated = await saveBoardWebhookState({
      trelloBoardId: board.trelloBoardId,
      enforcementEnabled: input.enabled,
      webhookActive: input.enabled ? webhook?.active === true : false,
      trelloWebhookId: webhook?.id ?? board.trelloWebhookId,
    });

    if (!updated) {
      throw new Error("Board enforcement state was not saved.");
    }

    return updated;
  } catch (error) {
    await saveBoardError({
      trelloBoardId: input.trelloBoardId,
      error: getErrorMessage(error),
    }).catch(() => undefined);

    throw error;
  }
}

export async function ensureWebhookActive(
  trelloBoardId: string,
  webhookId: string | null
): Promise<TrelloWebhook> {
  const callbackUrl = getPermissionManagerWebhookCallbackUrl();

  if (webhookId) {
    try {
      const webhook = await fetchTrelloWebhook(
        webhookId,
        getTrelloCredentials()
      );

      if (webhook.callbackURL === callbackUrl) {
        return updateTrelloWebhookActive(
          webhookId,
          true,
          getTrelloCredentials()
        );
      }

      await updateTrelloWebhookActive(
        webhookId,
        false,
        getTrelloCredentials()
      ).catch(() => undefined);
    } catch {
      return createTrelloWebhook(
        trelloBoardId,
        callbackUrl,
        getTrelloCredentials()
      );
    }
  }

  return createTrelloWebhook(
    trelloBoardId,
    callbackUrl,
    getTrelloCredentials()
  );
}

export async function deactivateWebhookIfPresent(
  webhookId: string | null
): Promise<TrelloWebhook | null> {
  if (!webhookId) {
    return null;
  }

  return updateTrelloWebhookActive(webhookId, false, getTrelloCredentials());
}

async function ensureDashboardBoard(trelloBoardId: string) {
  const trelloBoard = await fetchTrelloBoard(
    trelloBoardId,
    getTrelloCredentials()
  );

  return upsertDashboardBoard({
    trelloBoardId: trelloBoard.id,
    boardName: trelloBoard.name,
  });
}

async function getRequiredBoard(trelloBoardId: string) {
  const board = await getDashboardBoard(trelloBoardId);

  if (!board) {
    throw new NotFoundError("Board was not found.");
  }

  return board;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class NotFoundError extends Error {
  status = 404;
}
