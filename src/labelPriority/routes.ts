import express from "express";

import {
  labelPriorityConfig,
  priorityColor,
} from "../config/labelPriority.js";
import {
  deleteLabelPriority,
  getLabelPriority,
  listLabelPrioritiesByCardIds,
  upsertLabelPriority,
} from "./repository.js";
import { resolveLabelPriorityPermission } from "./permissions.js";

export const labelPriorityRouter = express.Router();

labelPriorityRouter.post("/api/label-priority/state", async (req, res, next) => {
  try {
    const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
    const trelloCardId = readRequiredString(req.body, "trelloCardId");
    const [permission, priority] = await Promise.all([
      resolveLabelPriorityPermission({ trelloMemberId, trelloCardId }),
      getLabelPriority(trelloCardId),
    ]);

    res.json({
      priority: priority ? mapPriority(priority.priority) : null,
      canModify: permission.canModify,
      reason: permission.reason,
      card: {
        id: permission.card.id,
        idBoard: permission.card.idBoard,
        closed: permission.card.closed,
      },
    });
  } catch (error) {
    next(error);
  }
});

labelPriorityRouter.post(
  "/api/label-priority/priorities",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloCardId = readRequiredString(req.body, "trelloCardId");
      const priority = readPriority(req.body, "priority");
      const permission = await resolveLabelPriorityPermission({
        trelloMemberId,
        trelloCardId,
      });

      if (!permission.canModify) {
        throw new ForbiddenError(permission.reason ?? "Priority cannot be changed.");
      }

      const saved = await upsertLabelPriority({
        trelloCardId,
        trelloBoardId: permission.card.idBoard,
        priority,
        updatedByMemberId: trelloMemberId,
      });

      res.json({ priority: mapPriority(saved.priority) });
    } catch (error) {
      next(error);
    }
  }
);

labelPriorityRouter.delete(
  "/api/label-priority/priorities/:trelloCardId",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloCardId = readRouteParam(req.params.trelloCardId);
      const permission = await resolveLabelPriorityPermission({
        trelloMemberId,
        trelloCardId,
      });

      if (!permission.canModify) {
        throw new ForbiddenError(permission.reason ?? "Priority cannot be cleared.");
      }

      await deleteLabelPriority(trelloCardId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

labelPriorityRouter.post(
  "/api/label-priority/priorities/batch",
  async (req, res, next) => {
    try {
      const trelloCardIds = readStringArray(req.body, "trelloCardIds");
      const priorities = await listLabelPrioritiesByCardIds(trelloCardIds);

      res.json({
        priorities: priorities.map((priority) => ({
          trelloCardId: priority.trelloCardId,
          ...mapPriority(priority.priority),
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

labelPriorityRouter.post(
  "/api/label-priority/access",
  async (req, res, next) => {
    try {
      const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
      const trelloCardId = readRequiredString(req.body, "trelloCardId");
      const permission = await resolveLabelPriorityPermission({
        trelloMemberId,
        trelloCardId,
      });

      res.json({
        canModify: permission.canModify,
        reason: permission.reason,
      });
    } catch (error) {
      next(error);
    }
  }
);

function mapPriority(priority: number) {
  return {
    value: priority,
    text: `Priority ${priority}`,
    color: priorityColor(priority),
    refresh: labelPriorityConfig.badgeRefreshSeconds,
  };
}

function readPriority(body: unknown, key: string): number {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new BadRequestError(`${key} must be an integer from 1 to 10.`);
  }

  return value;
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

function readStringArray(body: unknown, key: string): string[] {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new BadRequestError(`${key} must be an array of non-empty strings.`);
  }

  return Array.from(new Set(value.map((item) => item.trim())));
}

function readRouteParam(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new BadRequestError("trelloCardId route parameter is required.");
}

class BadRequestError extends Error {
  status = 400;
}

class ForbiddenError extends Error {
  status = 403;
}
