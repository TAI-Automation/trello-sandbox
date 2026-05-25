export type TrelloBoard = {
  id: string;
  name: string;
  idOrganization?: string | null;
  memberships: TrelloMembership[];
};

export type TrelloMembership = {
  idMember: string;
  memberType?: string;
  unconfirmed?: boolean;
  deactivated?: boolean;
};

export type TrelloMember = {
  id: string;
  fullName?: string;
  username?: string;
  initials?: string;
};

export type TrelloList = {
  id: string;
  name: string;
};

export type TrelloLabel = {
  id: string;
  idBoard: string;
  name: string;
  color: string;
};

export type TrelloWebhook = {
  id: string;
  description?: string;
  idModel: string;
  callbackURL: string;
  active: boolean;
};

export type TrelloCredentials = {
  key: string;
  token: string;
};

function trelloUrl(pathname: string, credentials: TrelloCredentials): URL {
  const url = new URL(pathname, "https://api.trello.com");
  url.searchParams.set("key", credentials.key);
  url.searchParams.set("token", credentials.token);
  return url;
}

export async function fetchTrelloJson<T>(url: URL): Promise<T> {
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

  return response.json() as Promise<T>;
}

export async function fetchTrelloBoard(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloBoard> {
  const url = trelloUrl(`/1/boards/${boardId}`, credentials);
  url.searchParams.set("fields", "id,name,idOrganization");
  url.searchParams.set("memberships", "all");

  const board = await fetchTrelloJson<{
    id: string;
    name: string;
    idOrganization?: string | null;
    memberships?: TrelloMembership[];
  }>(url);

  return {
    id: board.id,
    name: board.name,
    idOrganization: board.idOrganization,
    memberships: normalizeTrelloMemberships(board.memberships),
  };
}

function normalizeTrelloMemberships(
  memberships: TrelloMembership[] | undefined
): TrelloMembership[] {
  if (!Array.isArray(memberships)) {
    return [];
  }

  return memberships
    .filter((membership) => typeof membership.idMember === "string")
    .map((membership) => ({
      idMember: membership.idMember,
      memberType: membership.memberType,
      unconfirmed: membership.unconfirmed,
      deactivated: membership.deactivated,
    }));
}

export function isTrelloAdminMembership(
  membership: TrelloMembership | undefined
): boolean {
  return (
    membership?.memberType === "admin" &&
    membership.unconfirmed !== true &&
    membership.deactivated !== true
  );
}

export function isTrelloBoardAdmin(
  board: TrelloBoard,
  memberId: string
): boolean {
  return board.memberships.some(
    (membership) =>
      membership.idMember === memberId && isTrelloAdminMembership(membership)
  );
}

export async function fetchTrelloOrganizationMemberships(
  organizationId: string,
  credentials: TrelloCredentials
): Promise<TrelloMembership[]> {
  const url = trelloUrl(
    `/1/organizations/${organizationId}/memberships`,
    credentials
  );

  const memberships = await fetchTrelloJson<TrelloMembership[]>(url);

  return normalizeTrelloMemberships(memberships);
}

export async function isTrelloWorkspaceAdmin(
  organizationId: string,
  memberId: string,
  credentials: TrelloCredentials
): Promise<boolean> {
  const memberships = await fetchTrelloOrganizationMemberships(
    organizationId,
    credentials
  );

  return memberships.some(
    (membership) =>
      membership.idMember === memberId && isTrelloAdminMembership(membership)
  );
}

export async function isTrelloWorkspaceAdminForBoard(
  boardId: string,
  memberId: string,
  credentials: TrelloCredentials
): Promise<boolean> {
  const board = await fetchTrelloBoard(boardId, credentials);

  if (!board.idOrganization) {
    return isTrelloBoardAdmin(board, memberId);
  }

  return isTrelloWorkspaceAdmin(board.idOrganization, memberId, credentials);
}

export async function fetchTrelloBoardMembers(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloMember[]> {
  const url = trelloUrl(`/1/boards/${boardId}/members`, credentials);
  url.searchParams.set("fields", "id,fullName,username,initials");

  const members = await fetchTrelloJson<TrelloMember[]>(url);

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

export async function fetchTrelloBoardLists(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloList[]> {
  const url = trelloUrl(`/1/boards/${boardId}/lists`, credentials);
  url.searchParams.set("filter", "open");
  url.searchParams.set("fields", "id,name");

  const lists = await fetchTrelloJson<TrelloList[]>(url);

  if (!Array.isArray(lists)) {
    throw new Error("Trello returned an invalid lists response.");
  }

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
  }));
}

export async function moveCardToList(
  cardId: string,
  listId: string,
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/cards/${cardId}`, credentials);
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

export async function createTrelloLabel(
  input: {
    boardId: string;
    name: string;
    color: string;
  },
  credentials: TrelloCredentials
): Promise<TrelloLabel> {
  const url = trelloUrl("/1/labels", credentials);
  url.searchParams.set("idBoard", input.boardId);
  url.searchParams.set("name", input.name);
  url.searchParams.set("color", input.color);

  const response = await fetch(url, {
    method: "POST",
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

  return normalizeTrelloLabel((await response.json()) as TrelloLabel);
}

export async function updateTrelloLabel(
  input: {
    labelId: string;
    name: string;
    color: string;
  },
  credentials: TrelloCredentials
): Promise<TrelloLabel> {
  const url = trelloUrl(`/1/labels/${input.labelId}`, credentials);
  url.searchParams.set("name", input.name);
  url.searchParams.set("color", input.color);

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

  return normalizeTrelloLabel((await response.json()) as TrelloLabel);
}

function normalizeTrelloLabel(label: TrelloLabel): TrelloLabel {
  return {
    id: label.id,
    idBoard: label.idBoard,
    name: label.name,
    color: label.color,
  };
}

export async function listTrelloWebhooks(
  credentials: TrelloCredentials
): Promise<TrelloWebhook[]> {
  const url = trelloUrl(`/1/tokens/${credentials.token}/webhooks`, credentials);

  const webhooks = await fetchTrelloJson<TrelloWebhook[]>(url);

  if (!Array.isArray(webhooks)) {
    throw new Error("Trello returned an invalid webhooks response.");
  }

  return webhooks.map((webhook) => ({
    id: webhook.id,
    description: webhook.description,
    idModel: webhook.idModel,
    callbackURL: webhook.callbackURL,
    active: Boolean(webhook.active),
  }));
}

export async function createTrelloWebhook(
  boardId: string,
  callbackURL: string,
  credentials: TrelloCredentials
): Promise<TrelloWebhook> {
  const url = trelloUrl("/1/webhooks/", credentials);
  url.searchParams.set("description", "Trello webhook listener");
  url.searchParams.set("callbackURL", callbackURL);
  url.searchParams.set("idModel", boardId);
  url.searchParams.set("active", "true");

  const response = await fetch(url, {
    method: "POST",
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

  const webhook = (await response.json()) as TrelloWebhook;

  return {
    id: webhook.id,
    description: webhook.description,
    idModel: webhook.idModel,
    callbackURL: webhook.callbackURL,
    active: Boolean(webhook.active),
  };
}

export async function updateTrelloWebhookActive(
  webhookId: string,
  active: boolean,
  credentials: TrelloCredentials
): Promise<TrelloWebhook> {
  const url = trelloUrl(`/1/webhooks/${webhookId}`, credentials);
  url.searchParams.set("active", String(active));

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

  const webhook = (await response.json()) as TrelloWebhook;

  return {
    id: webhook.id,
    description: webhook.description,
    idModel: webhook.idModel,
    callbackURL: webhook.callbackURL,
    active: Boolean(webhook.active),
  };
}
