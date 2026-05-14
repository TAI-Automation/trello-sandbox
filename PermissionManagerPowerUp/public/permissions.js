/* global TrelloPowerUp */

const t = TrelloPowerUp.iframe();

const state = {
  boardId: null,
  lists: [],
  members: [],
  permissionsByMemberId: new Map(),
  allowedByMemberId: new Map(),
  currentMemberId: null,
  selectedMemberId: null,
  dirty: false,
};

const elements = {
  allowedSummary: document.getElementById("allowedSummary"),
  boardLabel: document.getElementById("boardLabel"),
  listChoices: document.getElementById("listChoices"),
  manager: document.getElementById("manager"),
  memberList: document.getElementById("memberList"),
  memberSearch: document.getElementById("memberSearch"),
  message: document.getElementById("message"),
  saveButton: document.getElementById("saveButton"),
  selectAll: document.getElementById("selectAll"),
  selectedMemberLabel: document.getElementById("selectedMemberLabel"),
};

init().catch(function handleInitError(error) {
  showMessage(error.message || "Failed to load permissions.", "error");
});

async function init() {
  const context = t.getContext();
  state.boardId = context.board;
  state.currentMemberId = context.member;

  if (!state.boardId) {
    throw new Error("Unable to determine the current board.");
  }

  elements.memberSearch.addEventListener("input", renderMembers);
  elements.selectAll.addEventListener("change", onSelectAllChanged);
  elements.saveButton.addEventListener("click", savePermissions);

  const board = await t.board("name", "memberships");
  elements.boardLabel.textContent = board.name
    ? `Board: ${board.name}`
    : "Board permissions";

  await loadPermissions();
  elements.manager.hidden = false;
  renderMembers();
  selectMember(state.members[0]?.id || null);
  await t.sizeTo("body");
}

async function loadPermissions() {
  const response = await fetch(`/api/power-up/permissions?boardId=${encodeURIComponent(state.boardId)}`, {
    headers: {
      Accept: "application/json",
    },
  });

  const payload = await readJsonResponse(response);

  state.lists = payload.lists;
  state.members = payload.members;
  state.permissionsByMemberId = new Map(
    payload.permissions.map(function mapPermission(permission) {
      return [permission.memberId, permission];
    })
  );
  state.allowedByMemberId = new Map();

  for (const member of state.members) {
    const permission = state.permissionsByMemberId.get(member.id);
    const denied = new Set(permission?.deniedListIds || []);
    const allowed = permission
      ? state.lists
          .filter(function listAllowed(list) {
            return !denied.has(list.id);
          })
          .map(function toId(list) {
            return list.id;
          })
      : [];

    state.allowedByMemberId.set(member.id, new Set(allowed));
  }
}

function renderMembers() {
  const query = elements.memberSearch.value.trim().toLowerCase();
  const members = state.members.filter(function filterMember(member) {
    const label = memberLabel(member).toLowerCase();
    return label.includes(query) || member.id.toLowerCase().includes(query);
  });

  elements.memberList.replaceChildren(
    ...members.map(function memberButton(member) {
      const button = document.createElement("button");
      button.className = "member-button";
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(member.id === state.selectedMemberId));
      button.addEventListener("click", function onClick() {
        selectMember(member.id);
      });

      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = memberLabel(member);

      const meta = document.createElement("span");
      meta.className = "member-meta";
      meta.textContent = member.username ? `@${member.username}` : member.id;

      button.append(name, meta);
      return button;
    })
  );
}

function selectMember(memberId) {
  state.selectedMemberId = memberId;
  renderMembers();
  renderLists();
}

function renderLists() {
  const member = state.members.find(function findMember(candidate) {
    return candidate.id === state.selectedMemberId;
  });

  elements.listChoices.replaceChildren();

  if (!member) {
    elements.selectedMemberLabel.textContent = "Select a user";
    elements.allowedSummary.textContent = "Choose lists this user may access.";
    elements.saveButton.disabled = true;
    elements.selectAll.checked = false;
    elements.selectAll.disabled = true;
    return;
  }

  const allowed = getAllowedSet(member.id);
  elements.selectedMemberLabel.textContent = memberLabel(member);
  elements.allowedSummary.textContent = `${allowed.size} of ${state.lists.length} lists allowed`;
  elements.saveButton.disabled = !state.dirty;
  elements.selectAll.disabled = state.lists.length === 0;
  elements.selectAll.checked = state.lists.length > 0 && allowed.size === state.lists.length;

  const choices = state.lists.map(function createChoice(list) {
    const label = document.createElement("label");
    label.className = "list-choice";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = allowed.has(list.id);
    checkbox.addEventListener("change", function onListChanged() {
      if (checkbox.checked) {
        allowed.add(list.id);
      } else {
        allowed.delete(list.id);
      }

      state.dirty = true;
      renderLists();
    });

    const text = document.createElement("span");
    text.textContent = list.name;

    label.append(checkbox, text);
    return label;
  });

  elements.listChoices.replaceChildren(...choices);
}

function onSelectAllChanged() {
  if (!state.selectedMemberId) {
    return;
  }

  const allowed = getAllowedSet(state.selectedMemberId);
  allowed.clear();

  if (elements.selectAll.checked) {
    for (const list of state.lists) {
      allowed.add(list.id);
    }
  }

  state.dirty = true;
  renderLists();
}

async function savePermissions() {
  if (!state.selectedMemberId || !state.dirty) {
    return;
  }

  elements.saveButton.disabled = true;
  showMessage("Saving permissions...", null);

  try {
    const member = state.members.find(function findMember(candidate) {
      return candidate.id === state.selectedMemberId;
    });
    const allowedListIds = Array.from(getAllowedSet(state.selectedMemberId));

    const response = await fetch("/api/power-up/permissions", {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        boardId: state.boardId,
        memberId: state.selectedMemberId,
        memberLabel: member ? memberLabel(member) : state.selectedMemberId,
        allowedListIds,
      }),
    });

    await readJsonResponse(response);
    state.dirty = false;
    await loadPermissions();
    renderMembers();
    renderLists();
    showMessage("Permissions saved.", "success");
  } catch (error) {
    showMessage(error.message || "Failed to save permissions.", "error");
    elements.saveButton.disabled = false;
  }

  await t.sizeTo("body");
}

function getAllowedSet(memberId) {
  if (!state.allowedByMemberId.has(memberId)) {
    state.allowedByMemberId.set(memberId, new Set());
  }

  return state.allowedByMemberId.get(memberId);
}

function memberLabel(member) {
  return member.fullName || member.username || member.id;
}

async function readJsonResponse(response) {
  const payload = await response.json().catch(function noJson() {
    return {};
  });

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

function showMessage(text, type) {
  elements.message.hidden = false;
  elements.message.textContent = text;
  elements.message.className = type ? `message ${type}` : "message";
}
