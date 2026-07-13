import fs from "node:fs/promises";
import path from "node:path";

import {
  fetchTrelloJson,
  TrelloApiError,
  type TrelloCredentials,
} from "../trello/api.js";

export type TrelloBoardArchive = {
  board: unknown;
  fetchedAt: string;
  trelloApiLimitations: string[];
};

export type SavedTrelloBoardArchive = {
  absolutePath: string;
  relativePath: string;
};

function createTrelloUrl(
  pathname: string,
  credentials: TrelloCredentials
): URL {
  const url = new URL(pathname, "https://api.trello.com");
  url.searchParams.set("key", credentials.key);
  url.searchParams.set("token", credentials.token);
  return url;
}

export async function fetchTrelloBoardArchive(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloBoardArchive> {
  const url = createTrelloUrl(`/1/boards/${boardId}`, credentials);

  url.searchParams.set("fields", "all");
  url.searchParams.set("actions", "all");
  url.searchParams.set("actions_limit", "1000");
  url.searchParams.set("cards", "all");
  url.searchParams.set("card_fields", "all");
  url.searchParams.set("card_attachments", "true");
  url.searchParams.set("card_attachment_fields", "all");
  url.searchParams.set("checklists", "all");
  url.searchParams.set("labels", "all");
  url.searchParams.set("lists", "all");
  url.searchParams.set("members", "all");
  url.searchParams.set("member_fields", "all");
  url.searchParams.set("memberships", "all");
  url.searchParams.set("customFields", "true");
  url.searchParams.set("card_customFieldItems", "true");

  try {
    return {
      board: await fetchTrelloJson<unknown>(url),
      fetchedAt: new Date().toISOString(),
      trelloApiLimitations: [
        "The board endpoint can include actions, but Trello caps action pagination; actions_limit=1000 fetches the newest available page only.",
        "Attachment metadata is included when available, but binary attachment files are not downloaded.",
      ],
    };
  } catch (error) {
    if (error instanceof TrelloApiError) {
      throw new TrelloArchiveApiError(
        "Trello API request failed while fetching board archive JSON.",
        error.status,
        error
      );
    }

    throw error;
  }
}

export async function saveTrelloBoardArchive(
  boardId: string,
  archive: TrelloBoardArchive
): Promise<SavedTrelloBoardArchive> {
  const timestamp = archive.fetchedAt.replace(/[:.]/g, "-");
  const relativePath = path.join(
    "exports",
    "trello-archive",
    boardId,
    timestamp,
    "board_raw.json"
  );
  const absolutePath = path.resolve(process.cwd(), relativePath);

  // Local/dev convenience only. Serverless hosts such as Vercel should treat
  // this as ephemeral, so callers must opt in with saveLocal=true.
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(archive.board, null, 2));

  return {
    absolutePath,
    relativePath,
  };
}

export class TrelloArchiveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cause: TrelloApiError
  ) {
    super(message);
  }
}
