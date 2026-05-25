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
  fetchTrelloWebhook,
  fetchTrelloBoard,
  updateTrelloWebhookActive,
  type TrelloWebhook,
} from "../trello/api.js";
import {
  addSafeList,
  listSafeLists,
  removeSafeList,
} from "../db/repositories/safeLists.js";
import { getPermissionManagerWebhookCallbackUrl } from "../permissionManagerEnforcer/config.js";

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
      const [boards, safeLists] = await Promise.all([
        listDashboardBoards(),
        listSafeLists(),
      ]);

      res.json({ boards, safeLists });
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

enforcementDashboardRouter.get(
  "/api/enforcement-dashboard/safe-lists",
  requireAdminAuth,
  async (_req, res, next) => {
    try {
      res.json({ safeLists: await listSafeLists() });
    } catch (error) {
      next(error);
    }
  }
);

enforcementDashboardRouter.post(
  "/api/enforcement-dashboard/safe-lists",
  requireAdminAuth,
  async (req, res, next) => {
    try {
      const name = readRequiredString(req.body, "name");
      const safeList = await addSafeList(name);

      res.status(201).json({ safeList });
    } catch (error) {
      next(error);
    }
  }
);

enforcementDashboardRouter.delete(
  "/api/enforcement-dashboard/safe-lists/:safeListId",
  requireAdminAuth,
  async (req, res, next) => {
    try {
      const safeListId = readRouteParam(req.params.safeListId);

      if (!(await removeSafeList(safeListId))) {
        throw new NotFoundError("Safe list was not found.");
      }

      res.status(204).send();
    } catch (error) {
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

async function deactivateWebhookIfPresent(
  webhookId: string | null
): Promise<TrelloWebhook | null> {
  if (!webhookId) {
    return null;
  }

  return updateTrelloWebhookActive(webhookId, false, getTrelloCredentials());
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
