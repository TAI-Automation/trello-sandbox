import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";

const app = express();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const PORT = process.env.PORT || 3000;
const TRELLO_SECRET = process.env.TRELLO_SECRET;
const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const CALLBACK_URL = `${process.env.PUBLIC_BASE_URL}/trello/webhook`;
const RECENT_REVERSAL_TTL_MS = 60_000;
const PERMISSIONS_PATH = path.resolve(__dirname, "../permissions.json");
const POWER_UP_PUBLIC_PATH = path.resolve(repoRoot, "PermissionManagerPowerUp/public");
const POWER_UP_ENV_PATH = path.resolve(repoRoot, ".power_up_env");
const powerUpEnv = loadEnvFile(POWER_UP_ENV_PATH);
const POWER_UP_TRELLO_KEY = powerUpEnv.TRELLO_KEY;
const POWER_UP_TRELLO_TOKEN = powerUpEnv.TRELLO_TOKEN;

const recentReversals = new Map();
let permissionsState = loadPermissionsState(PERMISSIONS_PATH);

// Keep the raw body so the Trello signature can be verified.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use("/power-up", express.static(POWER_UP_PUBLIC_PATH));

// Trello checks this with HEAD when creating the webhook.
app.head("/trello/webhook", (_req, res) => {
  res.sendStatus(200);
});

app.get("/", (_req, res) => {
  res.send("Trello webhook listener is running.");
});

app.get("/api/power-up/permissions", async (req, res) => {
  const boardId = req.query.boardId;

  if (typeof boardId !== "string" || boardId.trim() === "") {
    return res.status(400).json({ error: "boardId query parameter is required." });
  }

  try {
    const [board, members, lists] = await Promise.all([
      fetchTrelloBoard(boardId),
      fetchTrelloBoardMembers(boardId),
      fetchTrelloBoardLists(boardId),
    ]);
    const permissionsDocument = readPermissionsDocument(PERMISSIONS_PATH);

    res.json({
      board,
      members,
      lists,
      permissions: permissionsDocument.restrictedMoves,
    });
  } catch (error) {
    console.error("Failed to load Power-Up permissions:");
    console.error(error);
    res.status(500).json({ error: error.message || "Failed to load permissions." });
  }
});

app.put("/api/power-up/permissions", async (req, res) => {
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
    const lists = await fetchTrelloBoardLists(boardId);

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
    const permissionsDocument = readPermissionsDocument(PERMISSIONS_PATH);
    const existingIndex = permissionsDocument.restrictedMoves.findIndex(
      (entry) => entry.memberId === memberId
    );
    const entry = {
      memberId,
      memberLabel,
      deniedListIds,
    };

    if (existingIndex === -1) {
      permissionsDocument.restrictedMoves.push(entry);
    } else {
      permissionsDocument.restrictedMoves[existingIndex] = entry;
    }

    writePermissionsDocument(PERMISSIONS_PATH, permissionsDocument);
    permissionsState = loadPermissionsState(PERMISSIONS_PATH);

    res.json({ ok: true, permission: entry });
  } catch (error) {
    console.error("Failed to save Power-Up permissions:");
    console.error(error);
    res.status(500).json({ error: error.message || "Failed to save permissions." });
  }
});

app.post("/trello/webhook", async (req, res) => {
  if (!isValidTrelloWebhook(req)) {
    console.warn("Rejected webhook with invalid Trello signature.");
    return res.sendStatus(401);
  }

  const action = req.body.action;

  if (!action) {
    return res.sendStatus(200);
  }

  const isCardMovedBetweenLists =
    action.type === "updateCard" &&
    action.data?.old?.idList &&
    action.data?.card?.idList &&
    action.data.old.idList !== action.data.card.idList;

  if (isCardMovedBetweenLists) {
    const cardName = action.data.card.name;
    const cardId = action.data.card.id;
    const originalListId = action.data.old.idList;
    const currentListId = action.data.card.idList;
    const memberId = action.idMemberCreator;
    const memberLabel =
      action.memberCreator?.fullName ||
      action.memberCreator?.username ||
      memberId ||
      "unknown member";

    const fromList =
      action.data.listBefore?.name ||
      action.data.old.idList;

    const toList =
      action.data.listAfter?.name ||
      action.data.card.idList;

    console.log("Card moved:");
    console.log(`  Card: ${cardName} (${cardId})`);
    console.log(`  Member label: ${memberLabel}`);
    console.log(`  Member ID: ${memberId || "missing member ID"}`);
    console.log(`  From list: ${fromList}`);
    console.log(`  From list ID: ${originalListId}`);
    console.log(`  To list: ${toList}`);
    console.log(`  To list ID: ${currentListId}`);
    console.log(`  At: ${action.date}`);

    const moveRestriction = memberId
      ? getMoveRestriction(memberId, {
          sourceListId: originalListId,
          sourceListName: fromList,
          destinationListId: currentListId,
          destinationListName: toList,
        })
      : null;

    if (shouldIgnoreRecentReversal(cardId, currentListId)) {
      console.log("  Reversal webhook ignored.");
    } else if (!memberId) {
      console.warn("  Allowed: missing action.idMemberCreator; no restriction can match.");
    } else if (!moveRestriction) {
      console.log("  Allowed: no matching restriction.");
    } else {
      try {
        await moveCardToList(cardId, originalListId);
        rememberReversal(cardId, originalListId);
        console.log(
          `  Denied: ${moveRestriction.memberLabel || memberId} cannot move cards ${moveRestriction.direction} denied list ${moveRestriction.listName} (${moveRestriction.listId}).`
        );
        console.log(`  Reversed: moved card back to ${fromList}`);
      } catch (error) {
        console.error("  Failed to reverse card move:");
        console.error(error);
      }
    }
  }

  res.sendStatus(200);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Power-Up environment file not found at ${filePath}.`);
    return {};
  }

  return dotenv.parse(fs.readFileSync(filePath));
}

function loadPermissionsState(filePath) {
  return {
    mtimeMs: getFileMtimeMs(filePath),
    permissions: loadPermissions(filePath),
  };
}

function loadPermissions(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Permissions file not found at ${filePath}; no moves are restricted.`);
    return new Map();
  }

  const parsed = readPermissionsDocument(filePath);
  const restrictedMoves = new Map();

  for (const [index, entry] of parsed.restrictedMoves.entries()) {
    const deniedListIds = new Set();

    for (const listId of entry.deniedListIds) {
      deniedListIds.add(listId);
    }

    restrictedMoves.set(entry.memberId, {
      memberLabel: entry.memberLabel,
      deniedListIds,
    });
  }

  console.log(
    `Loaded ${restrictedMoves.size} restricted member permission set(s) from ${filePath}.`
  );

  return restrictedMoves;
}

function readPermissionsDocument(filePath) {
  if (!fs.existsSync(filePath)) {
    return { restrictedMoves: [] };
  }

  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read permissions file at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Permissions file must contain a JSON object.");
  }

  if (!Array.isArray(parsed.restrictedMoves)) {
    throw new Error("Permissions file must contain a restrictedMoves array.");
  }

  const seenMemberIds = new Set();

  for (const [index, entry] of parsed.restrictedMoves.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`restrictedMoves[${index}] must be an object.`);
    }

    if (typeof entry.memberId !== "string" || entry.memberId.trim() === "") {
      throw new Error(`restrictedMoves[${index}].memberId must be a non-empty string.`);
    }

    if (seenMemberIds.has(entry.memberId)) {
      throw new Error(`Duplicate restrictedMoves entry for memberId ${entry.memberId}.`);
    }

    seenMemberIds.add(entry.memberId);

    if (
      entry.memberLabel !== undefined &&
      typeof entry.memberLabel !== "string"
    ) {
      throw new Error(`restrictedMoves[${index}].memberLabel must be a string when provided.`);
    }

    if (!Array.isArray(entry.deniedListIds)) {
      throw new Error(`restrictedMoves[${index}].deniedListIds must be an array.`);
    }

    for (const [listIndex, listId] of entry.deniedListIds.entries()) {
      if (typeof listId !== "string" || listId.trim() === "") {
        throw new Error(
          `restrictedMoves[${index}].deniedListIds[${listIndex}] must be a non-empty string.`
        );
      }
    }
  }

  return parsed;
}

function writePermissionsDocument(filePath, document) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(document, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

function getCurrentPermissions() {
  const currentMtimeMs = getFileMtimeMs(PERMISSIONS_PATH);

  if (currentMtimeMs !== permissionsState.mtimeMs) {
    permissionsState = loadPermissionsState(PERMISSIONS_PATH);
  }

  return permissionsState.permissions;
}

function getFileMtimeMs(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.statSync(filePath).mtimeMs;
}

function getMoveRestriction(memberId, move) {
  const permissions = getCurrentPermissions();
  const memberRestrictions = permissions.get(memberId);

  if (!memberRestrictions) {
    return null;
  }

  if (memberRestrictions.deniedListIds.has(move.sourceListId)) {
    return {
      ...memberRestrictions,
      direction: "out of",
      listId: move.sourceListId,
      listName: move.sourceListName,
    };
  }

  if (memberRestrictions.deniedListIds.has(move.destinationListId)) {
    return {
      ...memberRestrictions,
      direction: "into",
      listId: move.destinationListId,
      listName: move.destinationListName,
    };
  }

  return null;
}

async function fetchTrelloBoard(boardId) {
  const url = trelloUrl(`/1/boards/${boardId}`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("memberships", "all");

  const board = await fetchTrelloJson(url);

  return {
    id: board.id,
    name: board.name,
    memberships: Array.isArray(board.memberships) ? board.memberships : [],
  };
}

async function fetchTrelloBoardMembers(boardId) {
  const url = trelloUrl(`/1/boards/${boardId}/members`);
  url.searchParams.set("fields", "id,fullName,username,initials");

  const members = await fetchTrelloJson(url);

  if (!Array.isArray(members)) {
    throw new Error("Trello returned an invalid members response.");
  }

  return members.map((member) => ({
    id: member.id,
    fullName: member.fullName,
    username: member.username,
    initials: member.initials,
  }));
}

async function fetchTrelloBoardLists(boardId) {
  const url = trelloUrl(`/1/boards/${boardId}/lists`);
  url.searchParams.set("filter", "open");
  url.searchParams.set("fields", "id,name");

  const lists = await fetchTrelloJson(url);

  if (!Array.isArray(lists)) {
    throw new Error("Trello returned an invalid lists response.");
  }

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
  }));
}

function trelloUrl(pathname) {
  if (!POWER_UP_TRELLO_KEY || !POWER_UP_TRELLO_TOKEN) {
    throw new Error("TRELLO_KEY and TRELLO_TOKEN are required in .power_up_env.");
  }

  const url = new URL(pathname, "https://api.trello.com");
  url.searchParams.set("key", POWER_UP_TRELLO_KEY);
  url.searchParams.set("token", POWER_UP_TRELLO_TOKEN);
  return url;
}

async function fetchTrelloJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Trello returned ${response.status} ${response.statusText}: ${body}`
    );
  }

  return response.json();
}

function validatePermissionUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const {
    boardId,
    memberId,
    memberLabel,
    allowedListIds,
  } = body;

  if (typeof boardId !== "string" || boardId.trim() === "") {
    return { ok: false, error: "boardId is required." };
  }

  if (typeof memberId !== "string" || memberId.trim() === "") {
    return { ok: false, error: "memberId is required." };
  }

  if (typeof memberLabel !== "string" || memberLabel.trim() === "") {
    return { ok: false, error: "memberLabel is required." };
  }

  if (!Array.isArray(allowedListIds)) {
    return { ok: false, error: "allowedListIds must be an array." };
  }

  for (const [index, listId] of allowedListIds.entries()) {
    if (typeof listId !== "string" || listId.trim() === "") {
      return {
        ok: false,
        error: `allowedListIds[${index}] must be a non-empty string.`,
      };
    }
  }

  return {
    ok: true,
    value: {
      boardId,
      memberId,
      memberLabel,
      allowedListIds: Array.from(new Set(allowedListIds)),
    },
  };
}

async function moveCardToList(cardId, listId) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    throw new Error("TRELLO_KEY and TRELLO_TOKEN are required to move cards.");
  }

  const url = new URL(`https://api.trello.com/1/cards/${cardId}`);
  url.searchParams.set("key", TRELLO_KEY);
  url.searchParams.set("token", TRELLO_TOKEN);
  url.searchParams.set("idList", listId);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Trello returned ${response.status} ${response.statusText}: ${body}`
    );
  }
}

function rememberReversal(cardId, targetListId) {
  recentReversals.set(cardId, {
    targetListId,
    expiresAt: Date.now() + RECENT_REVERSAL_TTL_MS,
  });
}

function shouldIgnoreRecentReversal(cardId, currentListId) {
  const recentReversal = recentReversals.get(cardId);

  if (!recentReversal) {
    return false;
  }

  if (Date.now() > recentReversal.expiresAt) {
    recentReversals.delete(cardId);
    return false;
  }

  if (recentReversal.targetListId !== currentListId) {
    return false;
  }

  recentReversals.delete(cardId);
  return true;
}

function isValidTrelloWebhook(req) {
  const header = req.get("X-Trello-Webhook");

  if (!header || !TRELLO_SECRET || !CALLBACK_URL || !req.rawBody) {
    return false;
  }

  const content = Buffer.concat([
    req.rawBody,
    Buffer.from(CALLBACK_URL, "utf8"),
  ]);

  const digest = crypto
    .createHmac("sha1", TRELLO_SECRET)
    .update(content)
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(header)
  );
}

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Webhook callback URL: ${CALLBACK_URL}`);
});
