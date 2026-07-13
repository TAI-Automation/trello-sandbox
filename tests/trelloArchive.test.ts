import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportTrelloBoardJsonToCsv } from "../src/trelloArchive/csvExport.js";

test("CSV export preserves primitive card member IDs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "trello-archive-"));
  const inputPath = path.join(directory, "board_raw.json");

  try {
    await fs.writeFile(
      inputPath,
      JSON.stringify({
        id: "board-1",
        name: "Board",
        cards: [
          {
            id: "card-1",
            idBoard: "board-1",
            idMembers: ["member-1", "member-2"],
          },
        ],
        members: [
          { id: "member-1", fullName: "One" },
          { id: "member-2", fullName: "Two" },
        ],
      })
    );

    const summary = await exportTrelloBoardJsonToCsv(inputPath);
    const cardMembers = await fs.readFile(
      path.join(directory, "card_members.csv"),
      "utf8"
    );

    assert.equal(
      summary.csvFiles.find((file) => file.fileName === "card_members.csv")
        ?.rowCount,
      2
    );
    assert.match(cardMembers, /"card-1","member-1"/);
    assert.match(cardMembers, /"card-1","member-2"/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
