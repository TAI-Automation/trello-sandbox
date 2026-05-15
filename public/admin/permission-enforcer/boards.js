const boardsBody = document.querySelector("#boardsBody");
const statusEl = document.querySelector("#status");
const addBoardForm = document.querySelector("#addBoardForm");
const boardIdInput = document.querySelector("#boardIdInput");
const refreshButton = document.querySelector("#refreshButton");

let busy = false;
let boards = [];

addBoardForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const boardId = boardIdInput.value.trim();

  if (!boardId) {
    return;
  }

  await runRequest("Adding board...", async () => {
    await fetchJson("/api/admin/permission-enforcer/boards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ boardId }),
    });
    boardIdInput.value = "";
    await loadBoards("Board added.");
  });
});

refreshButton.addEventListener("click", async () => {
  await runRequest("Refreshing webhook status...", async () => {
    const data = await fetchJson("/api/admin/permission-enforcer/boards/refresh", {
      method: "POST",
    });
    boards = data.boards;
    renderBoards();
    setStatus("Webhook status refreshed.");
  });
});

boardsBody.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-toggle-board]");

  if (!button) {
    return;
  }

  const boardId = button.dataset.toggleBoard;
  const board = boards.find((candidate) => candidate.boardId === boardId);

  if (!board) {
    return;
  }

  await runRequest("Updating enforcement...", async () => {
    const data = await fetchJson(
      `/api/admin/permission-enforcer/boards/${encodeURIComponent(boardId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enforcementEnabled: !board.enforcementEnabled,
        }),
      }
    );

    boards = boards.map((candidate) =>
      candidate.boardId === data.board.boardId ? data.board : candidate
    );
    renderBoards();
    setStatus("Enforcement updated.");
  });
});

runRequest("Loading boards...", () => loadBoards());

async function loadBoards(message) {
  const data = await fetchJson("/api/admin/permission-enforcer/boards");
  boards = data.boards;
  renderBoards();

  if (message) {
    setStatus(message);
  } else {
    setStatus("");
  }
}

async function runRequest(workingMessage, request) {
  if (busy) {
    return;
  }

  busy = true;
  setBusy(true);
  setStatus(workingMessage);

  try {
    await request();
  } catch (error) {
    setStatus(error.message || "Request failed.", true);
  } finally {
    busy = false;
    setBusy(false);
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}.`);
  }

  return data;
}

function renderBoards() {
  if (boards.length === 0) {
    boardsBody.innerHTML = `
      <tr>
        <td colspan="5">No boards are tracked yet.</td>
      </tr>
    `;
    return;
  }

  boardsBody.innerHTML = boards.map(renderBoardRow).join("");
}

function renderBoardRow(board) {
  const enforcementClass = board.enforcementEnabled ? "on" : "off";
  const enforcementLabel = board.enforcementEnabled ? "Enabled" : "Disabled";
  const webhookClass = board.webhookActive ? "on" : "off";
  const webhookLabel = board.webhookActive ? "Active" : "Inactive";
  const toggleClass = board.enforcementEnabled ? "danger" : "";
  const toggleLabel = board.enforcementEnabled ? "Turn off" : "Turn on";
  const lastCheckedAt = board.lastCheckedAt
    ? new Date(board.lastCheckedAt).toLocaleString()
    : "Never";

  return `
    <tr>
      <td data-label="Board">
        <strong>${escapeHtml(board.boardName)}</strong>
        <div class="muted"><code>${escapeHtml(board.boardId)}</code></div>
      </td>
      <td data-label="Enforcement">
        <span class="pill ${enforcementClass}">${enforcementLabel}</span>
      </td>
      <td data-label="Webhook">
        <span class="pill ${webhookClass}">${webhookLabel}</span>
        <div class="muted">${escapeHtml(board.webhookId || "No webhook ID")}</div>
        ${board.lastError ? `<div class="error">${escapeHtml(board.lastError)}</div>` : ""}
      </td>
      <td data-label="Last checked">${escapeHtml(lastCheckedAt)}</td>
      <td data-label="Action">
        <button class="${toggleClass}" type="button" data-toggle-board="${escapeHtml(
          board.boardId
        )}">${toggleLabel}</button>
      </td>
    </tr>
  `;
}

function setBusy(nextBusy) {
  addBoardForm.querySelector("button").disabled = nextBusy;
  refreshButton.disabled = nextBusy;
  boardsBody.querySelectorAll("button").forEach((button) => {
    button.disabled = nextBusy;
  });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
