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
  boards: [
    "id",
    "name",
    "desc",
    "closed",
    "idOrganization",
    "url",
    "shortUrl",
    "dateLastActivity",
    "dateLastView",
    "raw_json",
  ],
  lists: ["id", "idBoard", "name", "closed", "pos", "subscribed", "raw_json"],
  cards: [
    "id",
    "idBoard",
    "idList",
    "name",
    "desc",
    "closed",
    "pos",
    "url",
    "shortUrl",
    "dateLastActivity",
    "due",
    "dueComplete",
    "start",
    "idMemberCreator",
    "idAttachmentCover",
    "labels_json",
    "idLabels_json",
    "idMembers_json",
    "attachments_json",
    "raw_json",
  ],
  cardLabels: ["cardId", "labelId", "labelName", "labelColor", "raw_json"],
  labels: ["id", "idBoard", "name", "color", "raw_json"],
  cardMembers: ["cardId", "memberId", "raw_json"],
  members: ["id", "username", "fullName", "initials", "avatarUrl", "raw_json"],
  memberships: [
    "id",
    "idMember",
    "memberType",
    "unconfirmed",
    "deactivated",
    "raw_json",
  ],
  actions: [
    "id",
    "idBoard",
    "idCard",
    "idList",
    "idMemberCreator",
    "type",
    "date",
    "data_json",
    "raw_json",
  ],
  checklists: ["id", "idBoard", "idCard", "name", "pos", "raw_json"],
  checkItems: [
    "id",
    "idChecklist",
    "idCard",
    "name",
    "state",
    "pos",
    "due",
    "idMember",
    "raw_json",
  ],
  attachments: [
    "id",
    "idCard",
    "name",
    "url",
    "bytes",
    "date",
    "mimeType",
    "idMember",
    "isUpload",
    "raw_json",
  ],
  customFields: ["id", "idModel", "modelType", "name", "type", "raw_json"],
  cardCustomFieldItems: [
    "cardId",
    "idCustomField",
    "idValue",
    "value_text",
    "value_number",
    "value_date",
    "value_checked",
    "raw_json",
  ],
} satisfies Record<string, string[]>;

export async function exportTrelloBoardJsonToCsv(inputPath: string) {
  const absoluteInputPath = path.resolve(process.cwd(), inputPath);
  const exportDir = path.dirname(absoluteInputPath);
  const board = JSON.parse(await fs.readFile(absoluteInputPath, "utf8")) as JsonObject;
  const csvFiles = buildCsvFiles(board);
  const summary: CsvExportSummary = {
    sourceFile: path.basename(absoluteInputPath),
    generatedAt: new Date().toISOString(),
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

function buildCsvFiles(board: JsonObject): CsvFile[] {
  const cards = readArray(board.cards);
  const labels = readArray(board.labels);
  const labelById = new Map(labels.map((label) => [readString(label.id), label]));
  const checklists = readArray(board.checklists);

  return [
    {
      fileName: "boards.csv",
      headers: csvHeaders.boards,
      rows: [
        pickRow(board, csvHeaders.boards, {
          raw_json: toJson(board),
        }),
      ],
    },
    {
      fileName: "lists.csv",
      headers: csvHeaders.lists,
      rows: readArray(board.lists).map((list) =>
        pickRow(list, csvHeaders.lists, { raw_json: toJson(list) })
      ),
    },
    {
      fileName: "cards.csv",
      headers: csvHeaders.cards,
      rows: cards.map((card) =>
        pickRow(card, csvHeaders.cards, {
          labels_json: toJson(card.labels),
          idLabels_json: toJson(card.idLabels),
          idMembers_json: toJson(card.idMembers),
          attachments_json: toJson(card.attachments),
          raw_json: toJson(card),
        })
      ),
    },
    {
      fileName: "card_labels.csv",
      headers: csvHeaders.cardLabels,
      rows: cards.flatMap((card) => buildCardLabelRows(card, labelById)),
    },
    {
      fileName: "labels.csv",
      headers: csvHeaders.labels,
      rows: labels.map((label) =>
        pickRow(label, csvHeaders.labels, { raw_json: toJson(label) })
      ),
    },
    {
      fileName: "card_members.csv",
      headers: csvHeaders.cardMembers,
      rows: cards.flatMap((card) =>
        readArray(card.idMembers).map((memberId) => ({
          cardId: card.id,
          memberId,
          raw_json: toJson({ cardId: card.id, memberId }),
        }))
      ),
    },
    {
      fileName: "members.csv",
      headers: csvHeaders.members,
      rows: readArray(board.members).map((member) =>
        pickRow(member, csvHeaders.members, { raw_json: toJson(member) })
      ),
    },
    {
      fileName: "memberships.csv",
      headers: csvHeaders.memberships,
      rows: readArray(board.memberships).map((membership) =>
        pickRow(membership, csvHeaders.memberships, {
          raw_json: toJson(membership),
        })
      ),
    },
    {
      fileName: "actions.csv",
      headers: csvHeaders.actions,
      rows: readArray(board.actions).map((action) =>
        pickRow(action, csvHeaders.actions, {
          idBoard: readNested(action, ["data", "board", "id"]),
          idCard: readNested(action, ["data", "card", "id"]),
          idList:
            readNested(action, ["data", "list", "id"]) ??
            readNested(action, ["data", "listBefore", "id"]) ??
            readNested(action, ["data", "listAfter", "id"]),
          data_json: toJson(action.data),
          raw_json: toJson(action),
        })
      ),
    },
    {
      fileName: "checklists.csv",
      headers: csvHeaders.checklists,
      rows: checklists.map((checklist) =>
        pickRow(checklist, csvHeaders.checklists, {
          raw_json: toJson(checklist),
        })
      ),
    },
    {
      fileName: "check_items.csv",
      headers: csvHeaders.checkItems,
      rows: checklists.flatMap((checklist) =>
        readArray(checklist.checkItems).map((checkItem) =>
          pickRow(checkItem, csvHeaders.checkItems, {
            idChecklist: checklist.id,
            idCard: checkItem.idCard ?? checklist.idCard,
            raw_json: toJson(checkItem),
          })
        )
      ),
    },
    {
      fileName: "attachments.csv",
      headers: csvHeaders.attachments,
      rows: cards.flatMap((card) =>
        readArray(card.attachments).map((attachment) =>
          pickRow(attachment, csvHeaders.attachments, {
            idCard: card.id,
            raw_json: toJson(attachment),
          })
        )
      ),
    },
    {
      fileName: "custom_fields.csv",
      headers: csvHeaders.customFields,
      rows: readArray(board.customFields).map((customField) =>
        pickRow(customField, csvHeaders.customFields, {
          name:
            readNested(customField, ["display", "name"]) ??
            readString(customField.name),
          raw_json: toJson(customField),
        })
      ),
    },
    {
      fileName: "card_custom_field_items.csv",
      headers: csvHeaders.cardCustomFieldItems,
      rows: cards.flatMap((card) =>
        readArray(card.customFieldItems).map((item) =>
          pickRow(item, csvHeaders.cardCustomFieldItems, {
            cardId: card.id,
            value_text: readNested(item, ["value", "text"]),
            value_number: readNested(item, ["value", "number"]),
            value_date: readNested(item, ["value", "date"]),
            value_checked: readNested(item, ["value", "checked"]),
            raw_json: toJson(item),
          })
        )
      ),
    },
  ];
}

function buildCardLabelRows(
  card: JsonObject,
  labelById: Map<string, JsonObject>
): Record<string, unknown>[] {
  const cardLabels = readArray(card.labels);

  if (cardLabels.length > 0) {
    return cardLabels.map((label) => ({
      cardId: card.id,
      labelId: label.id,
      labelName: label.name,
      labelColor: label.color,
      raw_json: toJson({ cardId: card.id, label }),
    }));
  }

  return readPrimitiveArray(card.idLabels).map((labelIdValue) => {
    const labelId = readString(labelIdValue);
    const label = labelById.get(labelId);

    return {
      cardId: card.id,
      labelId,
      labelName: label?.name,
      labelColor: label?.color,
      raw_json: toJson({ cardId: card.id, labelId, label }),
    };
  });
}

function pickRow(
  source: JsonObject,
  headers: string[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return Object.fromEntries(
    headers.map((header) => [header, overrides[header] ?? source[header] ?? ""])
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

function readNested(source: JsonObject, keys: string[]): unknown {
  let current: unknown = source;

  for (const key of keys) {
    if (!isObject(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
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
