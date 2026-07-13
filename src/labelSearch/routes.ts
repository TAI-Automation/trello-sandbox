import express from "express";

import { applyBoardLabelToCard, searchBoardLabels } from "./repository.js";

export const labelSearchRouter = express.Router();

labelSearchRouter.get("/api/label-search/search", async (req, res, next) => {
  try {
    const boardId = readRequiredQueryString(req.query.boardId, "boardId");
    const query = readOptionalQueryString(req.query.q);
    const results = await searchBoardLabels({ boardId, query });

    res.json({ results });
  } catch (error) {
    next(error);
  }
});

labelSearchRouter.post("/api/label-search/apply", async (req, res, next) => {
  try {
    const cardId = readRequiredBodyString(req.body, "cardId");
    const boardId = readRequiredBodyString(req.body, "boardId");
    const trelloLabelId = readRequiredBodyString(req.body, "trelloLabelId");

    await applyBoardLabelToCard({ cardId, boardId, trelloLabelId });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

function readRequiredQueryString(
  value: unknown,
  key: string
): string {
  const result = readOptionalQueryString(value);

  if (!result) {
    throw new BadRequestError(`${key} is required.`);
  }

  return result;
}

function readOptionalQueryString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim();
  }

  return "";
}

function readRequiredBodyString(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestError(`${key} is required.`);
  }

  return value.trim();
}

class BadRequestError extends Error {
  status = 400;
}
