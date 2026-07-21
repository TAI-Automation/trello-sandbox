import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;

type CsvFile = {
  fileName: string;
  headers: string[];
  rows: Record<string, unknown>[];
};

export type CsvExportSummary = {
  sourceFile: string;
  generatedAt: string;
  csvFiles: {
    fileName: string;
    rowCount: number;
  }[];
};

const csvHeaders = {
  boards: ["board_id", "board_name", "json_downloaded_at", "json"],
  lists: ["list_id", "list_name", "json_downloaded_at", "json"],
  cards: [
    "card_id",
    "creator_member_id",
    "card_name",
    "date_last_activity",
    "json_downloaded_at",
    "json",
  ],
  members: ["member_id", "full_name", "json_downloaded_at", "json"],
  labels: ["label_id", "label_name", "json_downloaded_at", "json"],
  cardMembers: ["card_id", "member_id", "json_downloaded_at", "json"],
  cardLabels: ["card_id", "label_id", "json_downloaded_at", "json"],
  actions: ["action_id", "action_date", "json_downloaded_at", "json"],
} satisfies Record<string, string[]>;

export async function exportTrelloBoardJsonToCsv(inputPath: string) {
  const absoluteInputPath = path.resolve(process.cwd(), inputPath);
  const exportDir = path.dirname(absoluteInputPath);
  const board = JSON.parse(await fs.readFile(absoluteInputPath, "utf8")) as JsonObject;
  const jsonDownloadedAt = deriveJsonDownloadedAt(absoluteInputPath);
  const csvFiles = buildCsvFiles(board, jsonDownloadedAt);
  const summary: CsvExportSummary = {
    sourceFile: path.basename(absoluteInputPath),
    generatedAt: jsonDownloadedAt,
    csvFiles: [],
  };

  for (const csvFile of csvFiles) {
    await fs.writeFile(
      path.join(exportDir, csvFile.fileName),
      toCsv(csvFile.headers, csvFile.rows)
    );
    summary.csvFiles.push({
      fileName: csvFile.fileName,
      rowCount: csvFile.rows.length,
    });
  }

  await fs.writeFile(
    path.join(exportDir, "import_summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`
  );

  return summary;
}

function buildCsvFiles(board: JsonObject, jsonDownloadedAt: string): CsvFile[] {
  const cards = readArray(board.cards);
  const labels = readArray(board.labels);

  return [
    {
      fileName: "boards.csv",
      headers: csvHeaders.boards,
      rows: [
        {
          board_id: board.id,
          board_name: board.name,
          json_downloaded_at: jsonDownloadedAt,
          json: toJson(buildBoardSummaryJson(board)),
        },
      ],
    },
    {
      fileName: "lists.csv",
      headers: csvHeaders.lists,
      rows: readArray(board.lists).map((list) => ({
        list_id: list.id,
        list_name: list.name,
        json_downloaded_at: jsonDownloadedAt,
        json: toJson(list),
      })),
    },
    {
      fileName: "cards.csv",
      headers: csvHeaders.cards,
      rows: cards.map((card) => ({
        card_id: card.id,
        creator_member_id: card.idMemberCreator,
        card_name: card.name,
        date_last_activity: card.dateLastActivity,
        json_downloaded_at: jsonDownloadedAt,
        json: toJson(card),
      })),
    },
    {
      fileName: "members.csv",
      headers: csvHeaders.members,
      rows: readArray(board.members).map((member) => ({
        member_id: member.id,
        full_name: member.fullName,
        json_downloaded_at: jsonDownloadedAt,
        json: toJson(member),
      })),
    },
    {
      fileName: "labels.csv",
      headers: csvHeaders.labels,
      rows: labels.map((label) => ({
        label_id: label.id,
        label_name: label.name,
        json_downloaded_at: jsonDownloadedAt,
        json: toJson(label),
      })),
    },
    {
      fileName: "card_members.csv",
      headers: csvHeaders.cardMembers,
      rows: cards.flatMap((card) => buildCardMemberRows(card, jsonDownloadedAt)),
    },
    {
      fileName: "card_labels.csv",
      headers: csvHeaders.cardLabels,
      rows: cards.flatMap((card) => buildCardLabelRows(card, jsonDownloadedAt)),
    },
    {
      fileName: "actions.csv",
      headers: csvHeaders.actions,
      rows: readArray(board.actions).map((action) => ({
        action_id: action.id,
        action_date: action.date,
        json_downloaded_at: jsonDownloadedAt,
        json: toJson(action),
      })),
    },
  ];
}

function buildCardMemberRows(
  card: JsonObject,
  jsonDownloadedAt: string
): Record<string, unknown>[] {
  return readPrimitiveArray(card.idMembers).map((memberId) => ({
    card_id: card.id,
    member_id: memberId,
    json_downloaded_at: jsonDownloadedAt,
    json: toJson(card),
  }));
}

function buildCardLabelRows(
  card: JsonObject,
  jsonDownloadedAt: string
): Record<string, unknown>[] {
  const cardLabels = readArray(card.labels);

  if (cardLabels.length > 0) {
    return cardLabels.map((label) => ({
      card_id: card.id,
      label_id: label.id,
      json_downloaded_at: jsonDownloadedAt,
      json: toJson(card),
    }));
  }

  return readPrimitiveArray(card.idLabels).map((labelId) => ({
    card_id: card.id,
    label_id: labelId,
    json_downloaded_at: jsonDownloadedAt,
    json: toJson(card),
  }));
}

function buildBoardSummaryJson(board: JsonObject): JsonObject {
  const summaryHeaders = [
    "id",
    "name",
    "desc",
    "closed",
    "idOrganization",
    "idEnterprise",
    "url",
    "shortLink",
    "shortUrl",
    "dateLastActivity",
    "dateLastView",
    "idMemberCreator",
  ];

  return Object.fromEntries(
    summaryHeaders
      .filter((header) => board[header] !== undefined)
      .map((header) => [header, board[header]])
  );
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}

function escapeCsvValue(value: unknown): string {
  const normalized =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);

  return `"${normalized.replace(/"/g, '""')}"`;
}

function readArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => isObject(item))
    : [];
}

function readPrimitiveArray(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.filter((item) => !isObject(item) && !Array.isArray(item))
    : [];
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function deriveJsonDownloadedAt(inputPath: string): string {
  const timestampFolder = path.basename(path.dirname(inputPath));
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(
    timestampFolder
  );

  if (!match) {
    return new Date().toISOString();
  }

  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInputArg(argv: string[]): string {
  const inputFlagIndex = argv.indexOf("--input");

  if (inputFlagIndex === -1 || !argv[inputFlagIndex + 1]) {
    throw new Error('Usage: npm run trello:json-to-csv -- --input "path/to/board_raw.json"');
  }

  return argv[inputFlagIndex + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summary = await exportTrelloBoardJsonToCsv(readInputArg(process.argv.slice(2)));

  console.log(JSON.stringify(summary, null, 2));
}
