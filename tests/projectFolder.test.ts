import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";

test("project-folder endpoint accepts the board-and-label-id contract", async () => {
  const server = createApp().listen(0);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();

    assert(address && typeof address === "object");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/project-folder/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boardId: "board-1", labelIds: [] }),
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { matched: false, routes: [] });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
