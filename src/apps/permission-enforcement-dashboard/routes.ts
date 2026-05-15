import express, { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import { config, getWebhookCallbackUrl } from "../../config/env.js";
import {
  createTrelloWebhook,
  fetchTrelloBoard,
  listTrelloWebhooks,
  type TrelloWebhook,
  updateTrelloWebhookActive,
} from "../../trello/api.js";
import {
  getEnforcedBoard,
  listEnforcedBoards,
  updateEnforcedBoardStatus,
  upsertEnforcedBoard,
} from "./store.js";

type ToggleRequest = {
  enforcementEnabled?: unknown;
};

export function createPermissionEnforcementDashboardRouter(
  appConfig: AppConfig = config
): Router {
  const router = Router();

  router.use(
    "/admin/permission-enforcer",
    express.static(appConfig.permissionEnforcerAdminPublicPath)
  );

  router.get("/admin/permission-enforcer/boards", (_req, res) => {
    res.sendFile("boards.html", {
      root: appConfig.permissionEnforcerAdminPublicPath,
    });
  });

  router.get("/api/admin/permission-enforcer/boards", async (_req, res) => {
    try {
      await importEnvBoard(appConfig);
      const boards = await listEnforcedBoards(appConfig);
      return res.json({ boards });
    } catch (error) {
      console.error("Failed to list enforced boards:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post("/api/admin/permission-enforcer/boards", async (req, res) => {
    const boardId = req.body?.boardId;

    if (typeof boardId !== "string" || boardId.trim() === "") {
      return res.status(400).json({ error: "boardId is required." });
    }

    try {
      const board = await fetchTrelloBoard(boardId.trim(), appConfig);
      const webhook = await getOrCreateActiveWebhook(
        appConfig,
        board.id,
        getWebhookCallbackUrl(appConfig)
      );

      const trackedBoard = await upsertEnforcedBoard(appConfig, {
        boardId: board.id,
        boardName: board.name,
        enforcementEnabled: true,
        webhookId: webhook.id,
        webhookActive: webhook.active,
        webhookCallbackUrl: webhook.callbackURL,
      });

      return res.status(201).json({ board: trackedBoard });
    } catch (error) {
      console.error("Failed to add enforced board:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.patch("/api/admin/permission-enforcer/boards/:boardId", async (req, res) => {
    const validation = validateToggleRequest(req.body);

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const trackedBoard = await getEnforcedBoard(appConfig, req.params.boardId);

      if (!trackedBoard) {
        return res.status(404).json({ error: "Board is not tracked." });
      }

      const callbackURL = getWebhookCallbackUrl(appConfig);
      const webhook = validation.enforcementEnabled
        ? await getOrCreateActiveWebhook(appConfig, trackedBoard.boardId, callbackURL)
        : await disableWebhookForBoard(appConfig, trackedBoard.webhookId);

      const updatedBoard = await updateEnforcedBoardStatus(
        appConfig,
        trackedBoard.boardId,
        {
          enforcementEnabled: validation.enforcementEnabled,
          webhookId: webhook?.id || trackedBoard.webhookId || null,
          webhookActive: webhook?.active ?? false,
          webhookCallbackUrl: webhook?.callbackURL || trackedBoard.webhookCallbackUrl || null,
          lastError: null,
        }
      );

      return res.json({ board: updatedBoard });
    } catch (error) {
      console.error("Failed to update enforced board:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post("/api/admin/permission-enforcer/boards/refresh", async (_req, res) => {
    try {
      await importEnvBoard(appConfig);
      const boards = await listEnforcedBoards(appConfig);
      const webhooks = await listTrelloWebhooks(appConfig);
      const callbackURL = getWebhookCallbackUrl(appConfig);

      await Promise.all(
        boards.map(async (board) => {
          const webhook = findBoardWebhook(webhooks, board.boardId, callbackURL);
          await updateEnforcedBoardStatus(appConfig, board.boardId, {
            webhookId: webhook?.id || null,
            webhookActive: webhook?.active ?? false,
            webhookCallbackUrl: webhook?.callbackURL || callbackURL,
            lastError: webhook ? null : "No Trello webhook found for this board.",
          });
        })
      );

      const refreshedBoards = await listEnforcedBoards(appConfig);
      return res.json({ boards: refreshedBoards });
    } catch (error) {
      console.error("Failed to refresh enforced boards:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  return router;
}

async function importEnvBoard(appConfig: AppConfig): Promise<void> {
  if (!appConfig.trelloBoardId) {
    return;
  }

  const existing = await getEnforcedBoard(appConfig, appConfig.trelloBoardId);

  if (existing) {
    return;
  }

  const board = await fetchTrelloBoard(appConfig.trelloBoardId, appConfig);
  const webhook = await getOrCreateActiveWebhook(
    appConfig,
    board.id,
    getWebhookCallbackUrl(appConfig)
  );

  await upsertEnforcedBoard(appConfig, {
    boardId: board.id,
    boardName: board.name,
    enforcementEnabled: true,
    webhookId: webhook.id,
    webhookActive: webhook.active,
    webhookCallbackUrl: webhook.callbackURL,
  });
}

async function getOrCreateActiveWebhook(
  appConfig: AppConfig,
  boardId: string,
  callbackURL: string
): Promise<TrelloWebhook> {
  const webhooks = await listTrelloWebhooks(appConfig);
  const existing = findBoardWebhook(webhooks, boardId, callbackURL);

  if (existing) {
    return existing.active
      ? existing
      : updateTrelloWebhookActive(existing.id, true, appConfig);
  }

  return createTrelloWebhook(boardId, callbackURL, appConfig);
}

async function disableWebhookForBoard(
  appConfig: AppConfig,
  webhookId: string | undefined
): Promise<TrelloWebhook | null> {
  if (!webhookId) {
    return null;
  }

  return updateTrelloWebhookActive(webhookId, false, appConfig);
}

function findBoardWebhook(
  webhooks: TrelloWebhook[],
  boardId: string,
  callbackURL: string
): TrelloWebhook | undefined {
  return webhooks.find(
    (webhook) =>
      webhook.idModel === boardId &&
      normalizeUrl(webhook.callbackURL) === normalizeUrl(callbackURL)
  );
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function validateToggleRequest(
  body: ToggleRequest
): { ok: true; enforcementEnabled: boolean } | { ok: false; error: string } {
  if (typeof body?.enforcementEnabled !== "boolean") {
    return { ok: false, error: "enforcementEnabled must be a boolean." };
  }

  return { ok: true, enforcementEnabled: body.enforcementEnabled };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}
