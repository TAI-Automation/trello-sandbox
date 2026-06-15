import express from "express";

import {
  getAppSettings,
  getDashboardBoard,
} from "../enforcementDashboard/repository.js";
import { setBoardEnforcementState } from "../enforcementDashboard/webhookState.js";
import { listBoardProjectLabels } from "../projectConfigurator/repository.js";
import {
  getOrganizationId,
  getTrelloCredentials,
} from "../projectConfigurator/permissions.js";
import {
  fetchTrelloCard,
  isTrelloWorkspaceAdmin,
} from "../trello/api.js";
import {
  getPermissionManagerWebhookCallbackUrl,
  getTrelloSecret,
} from "./config.js";
import {
  previewLegacyLabelPurge,
  purgeLegacyLabels,
} from "./labelPurge.js";
import { enforceTrelloWebhook } from "./service.js";
import { isValidTrelloWebhook } from "../trello/webhooks.js";

export const permissionManagerEnforcerRouter = express.Router();

permissionManagerEnforcerRouter.head(
  "/api/permission-manager-enforcer/webhook",
  (_req, res) => {
    res.status(200).send();
  }
);

permissionManagerEnforcerRouter.post(
  "/api/permission-manager-enforcer/webhook",
  async (req, res, next) => {
    try {
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
      const valid = isValidTrelloWebhook({
        callbackUrl: getPermissionManagerWebhookCallbackUrl(),
        header: req.header("x-trello-webhook"),
        rawBody,
        secret: getTrelloSecret(),
      });

      if (!valid) {
        throw new UnauthorizedError("Invalid Trello webhook signature.");
      }

      await enforceTrelloWebhook(req.body);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

permissionManagerEnforcerRouter.post(
  "/api/permission-manager-enforcer/missing-label-status",
  async (req, res, next) => {
    try {
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");
      const trelloCardId = readRequiredString(req.body, "trelloCardId");
      const cardLabelIds =
        readOptionalStringArray(req.body, "cardLabelIds") ??
        (await fetchCardLabelIds(trelloCardId));
      const missingProjectLabel = !(await hasSyncedProjectLabel({
        trelloBoardId,
        cardLabelIds,
      }));

      console.log("permission-manager-enforcer missing-label-status", {
        trelloBoardId,
        trelloCardId,
        cardLabelCount: cardLabelIds.length,
        missingProjectLabel,
      });
      res.json({
        missingProjectLabel,
      });
    } catch (error) {
      next(error);
    }
  }
);

permissionManagerEnforcerRouter.post(
  "/api/permission-manager-enforcer/enforcement/state",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");
      const isAdmin = await isTrelloWorkspaceAdmin(
        getOrganizationId(),
        trelloMemberId,
        getTrelloCredentials()
      );
      const board = await getDashboardBoard(trelloBoardId);
      const settings = isAdmin ? await getAppSettings() : null;
      const labelPurgePreview = isAdmin
        ? await previewLegacyLabelPurge(trelloBoardId)
        : null;

      res.json({
        isAdmin,
        enforcementEnabled: board?.enforcementEnabled ?? false,
        webhookActive: board?.webhookActive ?? false,
        lastError: board?.lastError ?? null,
        settings,
        labelPurgePreview,
      });
    } catch (error) {
      next(error);
    }
  }
);

permissionManagerEnforcerRouter.post(
  "/api/permission-manager-enforcer/enforcement",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");
      const enabled = readRequiredBoolean(req.body, "enabled");
      const isAdmin = await isTrelloWorkspaceAdmin(
        getOrganizationId(),
        trelloMemberId,
        getTrelloCredentials()
      );

      if (!isAdmin) {
        throw new ForbiddenError(
          "Only Trello workspace admins can toggle enforcement."
        );
      }

      const existing = await getDashboardBoard(trelloBoardId);

      if (!enabled && !existing) {
        res.json({
          isAdmin,
          enforcementEnabled: false,
          webhookActive: false,
          lastError: null,
        });
        return;
      }

      const board = await setBoardEnforcementState({
        trelloBoardId,
        enabled,
      });

      res.json({
        isAdmin,
        enforcementEnabled: board.enforcementEnabled,
        webhookActive: board.webhookActive,
        lastError: board.lastError,
      });
    } catch (error) {
      next(error);
    }
  }
);

permissionManagerEnforcerRouter.post(
  "/api/permission-manager-enforcer/labels/purge-legacy",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloBoardId = readRequiredString(req.body, "trelloBoardId");
      const isAdmin = await isTrelloWorkspaceAdmin(
        getOrganizationId(),
        trelloMemberId,
        getTrelloCredentials()
      );

      if (!isAdmin) {
        throw new ForbiddenError(
          "Only Trello workspace admins can purge legacy labels."
        );
      }

      const labelPurge = await purgeLegacyLabels(trelloBoardId);
      res.json({ isAdmin, labelPurge });
    } catch (error) {
      next(error);
    }
  }
);

async function hasSyncedProjectLabel(input: {
  trelloBoardId: string;
  cardLabelIds: string[];
}): Promise<boolean> {
  if (input.cardLabelIds.length === 0) {
    return false;
  }

  const syncedProjectLabelIds = new Set(
    (await listBoardProjectLabels(input.trelloBoardId))
      .filter((label) => label.syncStatus === "synced")
      .map((label) => label.trelloLabelId)
  );

  return input.cardLabelIds.some((labelId) =>
    syncedProjectLabelIds.has(labelId)
  );
}

async function fetchCardLabelIds(trelloCardId: string): Promise<string[]> {
  const card = await fetchTrelloCard(trelloCardId, getTrelloCredentials());

  return card.idLabels;
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

function readOptionalStringArray(
  body: unknown,
  key: string
): string[] | null {
  if (!body || typeof body !== "object" || !(key in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new BadRequestError(`${key} must be an array.`);
  }

  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
}

class BadRequestError extends Error {
  status = 400;
}

class UnauthorizedError extends Error {
  status = 401;
}

class ForbiddenError extends Error {
  status = 403;
}
