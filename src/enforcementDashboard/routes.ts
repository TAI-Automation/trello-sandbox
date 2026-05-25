import express from "express";

import {
  authenticateAdmin,
  clearAdminSessionCookie,
  isAuthenticated,
  requireAdminAuth,
  setAdminSessionCookie,
} from "./auth.js";
import {
  getDashboardBoard,
  listDashboardBoards,
  markBoardLabelSyncComplete,
  removeDashboardBoard,
  saveBoardError,
  saveBoardWebhookState,
  upsertDashboardBoard,
} from "./repository.js";
import { syncProjectLabelsForBoard } from "../projectConfigurator/labelSync.js";
import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import {
  createTrelloWebhook,
  fetchTrelloBoard,
  updateTrelloWebhookActive,
  type TrelloWebhook,
} from "../trello/api.js";
import { isValidTrelloWebhook } from "../trello/webhooks.js";

export const enforcementDashboardRouter = express.Router();

enforcementDashboardRouter.post(
  "/api/enforcement-dashboard/login",
  (req, res, next) => {
    try {
      const username = readRequiredString(req.body, "username");
      const password = readRequiredString(req.body, "password");

      if (!authenticateAdmin({ username, password })) {
        throw new UnauthorizedError("Invalid username or password.");
      }

      setAdminSessionCookie(res);
      res.json({ authenticated: true });
    } catch (error) {
      next(error);
    }
  }
);

enforcementDashboardRouter.post(
  "/api/enforcement-dashboard/logout",
  (_req, res) => {
    clearAdminSessionCookie(res);
    res.status(204).send();
  }
);

enforcementDashboardRouter.get(
  "/api/enforcement-dashboard/session",
  (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
  }
);

enforcementDashboardRouter.get(
  "/api/enforcement-dashboard/state",
  requireAdminAuth,
  async (_req, res, next) => {
    try {
      res.json({ boards: await listDashboardBoards() });
    } catch (error) {
      next(error);
    }
  }
);

enforcementDashboardRouter.post(
  "/api/enforcement-dashboard/boards",
  requireAdminAuth,
  async (req, res, next) => {
    try {
      const input = normalizeBoardId(readRequiredString(req.body, "boardId"));
      const trelloBoard = await fetchTrelloBoard(input, getTrelloCredentials());
      const board = await upsertDashboardBoard({
        trelloBoardId: trelloBoard.id,
        boardName: trelloBoard.name,
      });
      const labelSync = await syncProjectLabelsForBoard({
        trelloBoardId: board.trelloBoardId,
        boardName: board.boardName,
      });

      await markBoardLabelSyncComplete({
        trelloBoardId: board.trelloBoardId,
        error:
          labelSync.failed > 0
            ? "Some project labels failed to sync."
            : null,
      });

      res.status(201).json({
        board: await getDashboardBoard(board.trelloBoardId),
        labelSync,
      });
    } catch (error) {
      next(error);
    }
  }
);

enforcementDashboardRouter.patch(
  "/api/enforcement-dashboard/boards/:trelloBoardId/enforcement",
  requireAdminAuth,
  async (req, res, next) => {
    const trelloBoardId = readRouteParam(req.params.trelloBoardId);

    try {
      const enabled = readRequiredBoolean(req.body, "enabled");
      const board = await getRequiredBoard(trelloBoardId);
      const webhook = enabled
        ? await ensureWebhookActive(board.trelloBoardId, board.trelloWebhookId)
        : await deactivateWebhookIfPresent(board.trelloWebhookId);
      const updated = await saveBoardWebhookState({
        trelloBoardId: board.trelloBoardId,
        enforcementEnabled: enabled,
        webhookActive: enabled ? webhook?.active === true : false,
        trelloWebhookId: webhook?.id ?? board.trelloWebhookId,
      });

      res.json({ board: updated });
    } catch (error) {
      if (trelloBoardId) {
        await saveBoardError({
          trelloBoardId,
          error: getErrorMessage(error),
        }).catch(() => undefined);
      }

      next(error);
    }
  }
);

enforcementDashboardRouter.delete(
  "/api/enforcement-dashboard/boards/:trelloBoardId",
  requireAdminAuth,
  async (req, res, next) => {
    const trelloBoardId = readRouteParam(req.params.trelloBoardId);

    try {
      const board = await getRequiredBoard(trelloBoardId);

      await deactivateWebhookIfPresent(board.trelloWebhookId);

      if (!(await removeDashboardBoard(board.trelloBoardId))) {
        throw new NotFoundError("Board was not found.");
      }

      res.status(204).send();
    } catch (error) {
      if (trelloBoardId) {
        await saveBoardError({
          trelloBoardId,
          error: getErrorMessage(error),
        }).catch(() => undefined);
      }

      next(error);
    }
  }
);

enforcementDashboardRouter.head(
  "/api/enforcement-dashboard/webhook",
  (_req, res) => {
    res.status(200).send();
  }
);

enforcementDashboardRouter.post(
  "/api/enforcement-dashboard/webhook",
  (req, res, next) => {
    try {
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
      const valid = isValidTrelloWebhook({
        callbackUrl: getWebhookCallbackUrl(),
        header: req.header("x-trello-webhook"),
        rawBody,
        secret: getTrelloSecret(),
      });

      if (!valid) {
        throw new UnauthorizedError("Invalid Trello webhook signature.");
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

async function getRequiredBoard(trelloBoardId: string) {
  const board = await getDashboardBoard(trelloBoardId);

  if (!board) {
    throw new NotFoundError("Board was not found.");
  }

  return board;
}

async function ensureWebhookActive(
  trelloBoardId: string,
  webhookId: string | null
): Promise<TrelloWebhook> {
  if (webhookId) {
    try {
      return await updateTrelloWebhookActive(
        webhookId,
        true,
        getTrelloCredentials()
      );
    } catch {
      return createTrelloWebhook(
        trelloBoardId,
        getWebhookCallbackUrl(),
        getTrelloCredentials()
      );
    }
  }

  return createTrelloWebhook(
    trelloBoardId,
    getWebhookCallbackUrl(),
    getTrelloCredentials()
  );
}

async function deactivateWebhookIfPresent(
  webhookId: string | null
): Promise<TrelloWebhook | null> {
  if (!webhookId) {
    return null;
  }

  return updateTrelloWebhookActive(webhookId, false, getTrelloCredentials());
}

function getWebhookCallbackUrl(): string {
  return `${getPublicBaseUrl()}/api/enforcement-dashboard/webhook`;
}

function getPublicBaseUrl(): string {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");

  if (!publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required.");
  }

  return publicBaseUrl;
}

function getTrelloSecret(): string {
  const secret = process.env.TRELLO_SECRET;

  if (!secret) {
    throw new Error("TRELLO_SECRET is required.");
  }

  return secret;
}

function normalizeBoardId(value: string): string {
  const boardId = value.trim();

  if (!/^[A-Za-z0-9]{8,64}$/.test(boardId)) {
    throw new BadRequestError(
      "Board ID must be a Trello short board ID or full board ID."
    );
  }

  return boardId;
}

function readRouteParam(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new BadRequestError("trelloBoardId route parameter is required.");
}

function readRequiredString(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`${key} must be a non-empty string.`);
  }

  return value.trim();
}

function readRequiredBoolean(body: unknown, key: string): boolean {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (typeof value !== "boolean") {
    throw new BadRequestError(`${key} must be a boolean.`);
  }

  return value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class BadRequestError extends Error {
  status = 400;
}

class UnauthorizedError extends Error {
  status = 401;
}

class NotFoundError extends Error {
  status = 404;
}
