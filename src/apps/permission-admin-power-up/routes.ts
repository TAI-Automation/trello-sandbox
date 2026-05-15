import { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import { config } from "../../config/env.js";
import {
  readPermissionsDocument,
  upsertPermissionEntry,
} from "../../core/permissions/store.js";
import {
  fetchTrelloBoard,
  fetchTrelloBoardLists,
  fetchTrelloBoardMembers,
} from "../../trello/api.js";
import { validatePermissionUpdate } from "./validation.js";

export function createPermissionAdminPowerUpRouter(
  appConfig: AppConfig = config
): Router {
  const router = Router();

  router.get("/api/power-up/permissions", async (req, res) => {
    const boardId = req.query.boardId;

    if (typeof boardId !== "string" || boardId.trim() === "") {
      return res.status(400).json({ error: "boardId query parameter is required." });
    }

    try {
      const [board, members, lists] = await Promise.all([
        fetchTrelloBoard(boardId, appConfig),
        fetchTrelloBoardMembers(boardId, appConfig),
        fetchTrelloBoardLists(boardId, appConfig),
      ]);
      const permissionsDocument = await readPermissionsDocument(appConfig, boardId);

      return res.json({
        board,
        members,
        lists,
        permissions: permissionsDocument.restrictedMoves,
      });
    } catch (error) {
      console.error("Failed to load Power-Up permissions:");
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to load permissions.";
      return res.status(500).json({ error: message });
    }
  });

  router.put("/api/power-up/permissions", async (req, res) => {
    const validation = validatePermissionUpdate(req.body);

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const {
      boardId,
      memberId,
      memberLabel,
      allowedListIds,
    } = validation.value;

    try {
      const lists = await fetchTrelloBoardLists(boardId, appConfig);
      const openListIds = new Set(lists.map((list) => list.id));
      const allowed = new Set(allowedListIds);

      for (const listId of allowed) {
        if (!openListIds.has(listId)) {
          return res.status(400).json({ error: `Unknown or closed list ID: ${listId}` });
        }
      }

      const deniedListIds = lists
        .filter((list) => !allowed.has(list.id))
        .map((list) => list.id);
      const entry = {
        memberId,
        memberLabel,
        deniedListIds,
      };

      await upsertPermissionEntry(appConfig, boardId, entry);

      return res.json({ ok: true, permission: entry });
    } catch (error) {
      console.error("Failed to save Power-Up permissions:");
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to save permissions.";
      return res.status(500).json({ error: message });
    }
  });

  return router;
}
