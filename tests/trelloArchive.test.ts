import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportTrelloBoardJsonToCsv } from "../src/trelloArchive/csvExport.js";

const expectedCsvFiles = [
  "boards.csv",
  "lists.csv",
  "cards.csv",
  "members.csv",
  "labels.csv",
  "card_members.csv",
  "card_labels.csv",
  "actions.csv",
];

const oldCsvFiles = [
  "memberships.csv",
  "checklists.csv",
  "check_items.csv",
  "attachments.csv",
  "custom_fields.csv",
  "card_custom_field_items.csv",
];

const expectedHeaders = {
  "boards.csv": ["board_id", "board_name", "json_downloaded_at", "json"],
  "lists.csv": ["list_id", "list_name", "json_downloaded_at", "json"],
  "cards.csv": [
    "card_id",
    "creator_member_id",
    "card_name",
    "date_last_activity",
    "json_downloaded_at",
    "json",
  ],
  "members.csv": ["member_id", "full_name", "json_downloaded_at", "json"],
  "labels.csv": ["label_id", "label_name", "json_downloaded_at", "json"],
  "card_members.csv": ["card_id", "member_id", "json_downloaded_at", "json"],
  "card_labels.csv": ["card_id", "label_id", "json_downloaded_at", "json"],
  "actions.csv": ["action_id", "action_date", "json_downloaded_at", "json"],
} satisfies Record<string, string[]>;

test("CSV export writes the simplified 8-file Trello archive standard", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "trello-archive-"));
  const timestampDirectory = path.join(
    directory,
    "exports",
    "trello-archive",
    "board-1",
    "2026-07-15T16-20-54-220Z"
  );
  const inputPath = path.join(timestampDirectory, "board_raw.json");

  try {
    await fs.mkdir(timestampDirectory, { recursive: true });
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        id: "board-1",
        name: "Board",
        desc: "Demo board",
        closed: false,
        idOrganization: "org-1",
        idEnterprise: "ent-1",
        url: "https://trello.example/board",
        shortLink: "abc123",
        shortUrl: "https://trello.example/b/abc123",
        dateLastActivity: "2026-07-14T10:00:00.000Z",
        dateLastView: "2026-07-14T11:00:00.000Z",
        idMemberCreator: "member-1",
        prefs: { background: "blue" },
        cards: [
          {
            id: "card-1",
            idBoard: "board-1",
            idMemberCreator: "member-1",
            name: "Card One",
            dateLastActivity: "2026-07-14T12:00:00.000Z",
            idMembers: ["member-1", "member-2"],
            labels: [
              { id: "label-1", name: "Urgent", color: "red" },
              { id: "label-2", name: "Client", color: "blue" },
            ],
          },
          {
            id: "card-2",
            idBoard: "board-1",
            idMemberCreator: "member-2",
            name: "Card Two",
            dateLastActivity: "2026-07-14T13:00:00.000Z",
            idMembers: ["member-2"],
            labels: [],
            idLabels: ["label-3"],
          },
        ],
        lists: [
          { id: "list-1", name: "Todo" },
          { id: "list-2", name: "Done" },
        ],
        members: [
          { id: "member-1", fullName: "One" },
          { id: "member-2", fullName: "Two" },
        ],
        labels: [
          { id: "label-1", name: "Urgent" },
          { id: "label-2", name: "Client" },
          { id: "label-3", name: "Fallback" },
        ],
        actions: [
          { id: "action-1", date: "2026-07-14T14:00:00.000Z", type: "createCard" },
          { id: "action-2", date: "2026-07-14T15:00:00.000Z", type: "updateCard" },
        ],
        checklists: [{ id: "checklist-1" }],
        customFields: [{ id: "custom-field-1" }],
      })
    );

    const summary = await exportTrelloBoardJsonToCsv(inputPath);
    const generatedFiles = await fs.readdir(timestampDirectory);

    assert.deepEqual(
      summary.csvFiles.map((file) => file.fileName),
      expectedCsvFiles
    );

    for (const fileName of expectedCsvFiles) {
      assert.ok(generatedFiles.includes(fileName), `${fileName} was generated`);
    }

    for (const fileName of oldCsvFiles) {
      assert.equal(
        generatedFiles.includes(fileName),
        false,
        `${fileName} was not generated`
      );
    }

    const csvByName = Object.fromEntries(
      await Promise.all(
        expectedCsvFiles.map(async (fileName) => [
          fileName,
          parseCsv(await fs.readFile(path.join(timestampDirectory, fileName), "utf8")),
        ])
      )
    ) as Record<string, string[][]>;

    for (const fileName of expectedCsvFiles) {
      assert.deepEqual(csvByName[fileName][0], expectedHeaders[fileName]);
    }

    assert.equal(readRowCount(csvByName["boards.csv"]), 1);
    assert.equal(readRowCount(csvByName["lists.csv"]), 2);
    assert.equal(readRowCount(csvByName["cards.csv"]), 2);
    assert.equal(readRowCount(csvByName["members.csv"]), 2);
    assert.equal(readRowCount(csvByName["labels.csv"]), 3);
    assert.equal(readRowCount(csvByName["card_members.csv"]), 3);
    assert.equal(readRowCount(csvByName["card_labels.csv"]), 3);
    assert.equal(readRowCount(csvByName["actions.csv"]), 2);

    assert.deepEqual(
      csvByName["card_members.csv"].slice(1).map((row) => row.slice(0, 2)),
      [
        ["card-1", "member-1"],
        ["card-1", "member-2"],
        ["card-2", "member-2"],
      ]
    );
    assert.deepEqual(
      csvByName["card_labels.csv"].slice(1).map((row) => row.slice(0, 2)),
      [
        ["card-1", "label-1"],
        ["card-1", "label-2"],
        ["card-2", "label-3"],
      ]
    );

    const jsonDownloadedAtValues = new Set(
      expectedCsvFiles.flatMap((fileName) =>
        csvByName[fileName].slice(1).map((row) => row[row.length - 2])
      )
    );
    assert.deepEqual(jsonDownloadedAtValues, new Set(["2026-07-15T16:20:54.220Z"]));

    const boardJson = JSON.parse(csvByName["boards.csv"][1][3]);
    assert.equal(boardJson.id, "board-1");
    assert.equal(boardJson.name, "Board");
    assert.equal("cards" in boardJson, false);
    assert.equal("actions" in boardJson, false);
    assert.equal("prefs" in boardJson, false);

    assert.deepEqual(summary.csvFiles, [
      { fileName: "boards.csv", rowCount: 1 },
      { fileName: "lists.csv", rowCount: 2 },
      { fileName: "cards.csv", rowCount: 2 },
      { fileName: "members.csv", rowCount: 2 },
      { fileName: "labels.csv", rowCount: 3 },
      { fileName: "card_members.csv", rowCount: 3 },
      { fileName: "card_labels.csv", rowCount: 3 },
      { fileName: "actions.csv", rowCount: 2 },
    ]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("CSV export creates header-only simplified files for missing arrays", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "trello-archive-"));
  const inputPath = path.join(directory, "board_raw.json");

  try {
    await fs.writeFile(inputPath, JSON.stringify({ id: "board-1", name: "Board" }));

    const summary = await exportTrelloBoardJsonToCsv(inputPath);

    assert.deepEqual(
      summary.csvFiles.map((file) => file.fileName),
      expectedCsvFiles
    );
    assert.equal(summary.csvFiles[0].rowCount, 1);
    assert.deepEqual(
      summary.csvFiles.slice(1).map((file) => file.rowCount),
      Array.from({ length: 7 }, () => 0)
    );

    for (const fileName of expectedCsvFiles.slice(1)) {
      const rows = parseCsv(await fs.readFile(path.join(directory, fileName), "utf8"));
      assert.deepEqual(rows, [expectedHeaders[fileName]]);
    }

    for (const fileName of oldCsvFiles) {
      await assert.rejects(fs.access(path.join(directory, fileName)));
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function readRowCount(rows: string[][]): number {
  return rows.length - 1;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  return rows.filter((currentRow) => currentRow.length > 1 || currentRow[0] !== "");
}
