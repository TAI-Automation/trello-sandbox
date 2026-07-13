import express from "express";
import path from "node:path";

import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import { exportTrelloBoardJsonToCsv } from "./csvExport.js";
import {
  fetchTrelloBoardArchive,
  saveTrelloBoardArchive,
  TrelloArchiveApiError,
} from "./repository.js";

export const trelloArchiveRouter = express.Router();

trelloArchiveRouter.get(
  "/api/trello-archive/board-json",
  async (req, res, next) => {
    try {
      const boardId = readRequiredTrelloId(req.query.boardId, "boardId");
      const saveLocal = readOptionalBooleanQuery(req.query.saveLocal, "saveLocal");
      const saveCsv = readOptionalBooleanQuery(req.query.saveCsv, "saveCsv");

      if (saveCsv && !saveLocal) {
        throw new BadRequestError("saveCsv=true requires saveLocal=true.");
      }

      const archive = await fetchTrelloBoardArchive(
        boardId,
        getTrelloCredentials()
      );
      const saved = saveLocal
        ? await saveTrelloBoardArchive(boardId, archive)
        : null;

      if (saveCsv && saved) {
        const csvSummary = await exportTrelloBoardJsonToCsv(saved.relativePath);
        const actionsCount = getArrayCount(archive.board, "actions");
        const response: Record<string, unknown> = {
          boardId,
          boardName: readObjectString(archive.board, "name"),
          outputFolder: path.dirname(saved.relativePath),
          rawJsonPath: saved.relativePath,
          csvFiles: csvSummary.csvFiles.map((csvFile) => csvFile.fileName),
          rowCounts: Object.fromEntries(
            csvSummary.csvFiles.map((csvFile) => [
              csvFile.fileName,
              csvFile.rowCount,
            ])
          ),
          actionsCount,
        };

        if (actionsCount === 1000) {
          response.warning =
            "actionsCount is 1000, so Trello's action page cap may have been reached.";
        }

        res.json(response);
        return;
      }

      res.json({
        board: archive.board,
        fetchedAt: archive.fetchedAt,
        saved,
        trelloApiLimitations: archive.trelloApiLimitations,
      });
    } catch (error) {
      if (error instanceof TrelloArchiveApiError) {
        next(new BadGatewayError(error.message));
        return;
      }

      next(error);
    }
  }
);

function readRequiredQueryString(
  value: unknown,
  key: string
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new BadRequestError(`${key} query parameter is required.`);
}

function readOptionalBooleanQuery(value: unknown, key: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new BadRequestError(`${key} must be true or false when provided.`);
}

function readObjectString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return null;
  }

  const propertyValue = (value as Record<string, unknown>)[key];

  return typeof propertyValue === "string" ? propertyValue : null;
}

function getArrayCount(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return 0;
  }

  const propertyValue = (value as Record<string, unknown>)[key];

  return Array.isArray(propertyValue) ? propertyValue.length : 0;
}

class BadRequestError extends Error {
  status = 400;
}

class BadGatewayError extends Error {
  status = 502;
}

function readRequiredTrelloId(value: unknown, key: string): string {
  const result = readRequiredQueryString(value, key);

  if (!/^[a-zA-Z0-9]+$/.test(result)) {
    throw new BadRequestError(`${key} must be a valid Trello id.`);
  }

  return result;
}
