import express from "express";

import { searchBoardLabels } from "./repository.js";

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

class BadRequestError extends Error {
  status = 400;
}
