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

export type TrelloCustomField = {
  id: string;
  idModel: string;
  modelType: string;
  name: string;
  type: string;
};

export type TrelloCard = {
  id: string;
  idBoard: string;
  idList: string;
  closed: boolean;
  idLabels: string[];
  customFieldItems?: TrelloCustomFieldItem[];
  name?: string;
  url?: string;
};

export type TrelloCustomFieldItem = {
  idCustomField: string;
  value?: {
    text?: string;
  };
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

export class TrelloApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly body: string
  ) {
    super(message);
  }
}

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
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
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

export async function moveCard(
  input: {
    cardId: string;
    listId?: string;
    boardId?: string;
  },
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/cards/${input.cardId}`, credentials);

  if (input.listId) {
    url.searchParams.set("idList", input.listId);
  }

  if (input.boardId) {
    url.searchParams.set("idBoard", input.boardId);
  }

  await sendTrelloRequest(url, "PUT");
}

export async function setCardClosed(
  cardId: string,
  closed: boolean,
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/cards/${cardId}`, credentials);
  url.searchParams.set("closed", String(closed));

  await sendTrelloRequest(url, "PUT");
}

export async function deleteTrelloCard(
  cardId: string,
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/cards/${cardId}`, credentials);

  await sendTrelloRequest(url, "DELETE");
}

export async function fetchTrelloCard(
  cardId: string,
  credentials: TrelloCredentials
): Promise<TrelloCard> {
  const url = trelloUrl(`/1/cards/${cardId}`, credentials);
  url.searchParams.set("fields", "id,idBoard,idList,closed,idLabels,name,url");

  const card = await fetchTrelloJson<TrelloCard>(url);

  return normalizeTrelloCard(card);
}

export async function listTrelloBoardCards(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloCard[]> {
  const url = trelloUrl(`/1/boards/${boardId}/cards`, credentials);
  url.searchParams.set("filter", "open");
  url.searchParams.set("fields", "id,idBoard,idList,closed,idLabels,name,url");
  url.searchParams.set("customFieldItems", "true");

  const cards = await fetchTrelloJson<TrelloCard[]>(url);

  if (!Array.isArray(cards)) {
    throw new Error("Trello returned an invalid cards response.");
  }

  return cards.map(normalizeTrelloCard);
}

export async function listTrelloCardCustomFieldItems(
  cardId: string,
  credentials: TrelloCredentials
): Promise<TrelloCustomFieldItem[]> {
  const url = trelloUrl(`/1/cards/${cardId}/customFieldItems`, credentials);
  const items = await fetchTrelloJson<TrelloCustomFieldItem[]>(url);

  if (!Array.isArray(items)) {
    throw new Error("Trello returned an invalid custom field items response.");
  }

  return items.map((item) => ({
    idCustomField: item.idCustomField,
    value: item.value,
  }));
}

export function isTrelloNotFoundError(error: unknown): boolean {
  return error instanceof TrelloApiError && error.status === 404;
}

export async function createTrelloCard(
  input: {
    listId: string;
    name: string;
    labelIds: string[];
  },
  credentials: TrelloCredentials
): Promise<TrelloCard> {
  const url = trelloUrl("/1/cards", credentials);
  url.searchParams.set("idList", input.listId);
  url.searchParams.set("name", input.name);
  url.searchParams.set("idLabels", input.labelIds.join(","));
  url.searchParams.set("pos", "bottom");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
    );
  }

  return normalizeTrelloCard((await response.json()) as TrelloCard);
}

export async function addLabelToCard(
  cardId: string,
  labelId: string,
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/cards/${cardId}/idLabels`, credentials);
  url.searchParams.set("value", labelId);

  await sendTrelloRequest(url, "POST");
}

export async function removeLabelFromCard(
  cardId: string,
  labelId: string,
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/cards/${cardId}/idLabels/${labelId}`, credentials);

  await sendTrelloRequest(url, "DELETE");
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
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
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
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
    );
  }

  return normalizeTrelloLabel((await response.json()) as TrelloLabel);
}

export async function deleteTrelloLabel(
  labelId: string,
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/labels/${labelId}`, credentials);

  await sendTrelloRequest(url, "DELETE");
}

export async function listTrelloBoardLabels(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloLabel[]> {
  const url = trelloUrl(`/1/boards/${boardId}/labels`, credentials);
  url.searchParams.set("fields", "id,idBoard,name,color");

  const labels = await fetchTrelloJson<TrelloLabel[]>(url);

  if (!Array.isArray(labels)) {
    throw new Error("Trello returned an invalid labels response.");
  }

  return labels.map(normalizeTrelloLabel);
}

export async function listTrelloBoardCustomFields(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloCustomField[]> {
  const url = trelloUrl(`/1/boards/${boardId}/customFields`, credentials);

  const customFields = await fetchTrelloJson<TrelloCustomField[]>(url);

  if (!Array.isArray(customFields)) {
    throw new Error("Trello returned an invalid custom fields response.");
  }

  return customFields.map(normalizeTrelloCustomField);
}

export async function createTrelloBoardTextCustomField(
  input: {
    boardId: string;
    name: string;
  },
  credentials: TrelloCredentials
): Promise<TrelloCustomField> {
  const url = trelloUrl("/1/customFields", credentials);
  url.searchParams.set("idModel", input.boardId);
  url.searchParams.set("modelType", "board");
  url.searchParams.set("name", input.name);
  url.searchParams.set("type", "text");
  url.searchParams.set("pos", "bottom");
  url.searchParams.set("display_cardFront", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
    );
  }

  return normalizeTrelloCustomField(
    (await response.json()) as TrelloCustomField
  );
}

export async function setTrelloCardTextCustomField(
  input: {
    cardId: string;
    customFieldId: string;
    value: string;
  },
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(
    `/1/cards/${input.cardId}/customField/${input.customFieldId}/item`,
    credentials
  );

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: {
        text: input.value,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
    );
  }
}

export async function clearTrelloCardCustomField(
  input: {
    cardId: string;
    customFieldId: string;
  },
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(
    `/1/cards/${input.cardId}/customField/${input.customFieldId}/item`,
    credentials
  );

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      value: "",
      idValue: "",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
    );
  }
}

export async function updateTrelloList(
  input: {
    listId: string;
    name?: string;
    closed?: boolean;
    boardId?: string;
  },
  credentials: TrelloCredentials
): Promise<void> {
  const url = trelloUrl(`/1/lists/${input.listId}`, credentials);

  if (input.name !== undefined) {
    url.searchParams.set("name", input.name);
  }

  if (input.closed !== undefined) {
    url.searchParams.set("closed", String(input.closed));
  }

  if (input.boardId !== undefined) {
    url.searchParams.set("idBoard", input.boardId);
  }

  await sendTrelloRequest(url, "PUT");
}

function normalizeTrelloCard(card: TrelloCard): TrelloCard {
  return {
    id: card.id,
    idBoard: card.idBoard,
    idList: card.idList,
    closed: Boolean(card.closed),
    idLabels: Array.isArray(card.idLabels) ? card.idLabels : [],
    customFieldItems: Array.isArray(card.customFieldItems)
      ? card.customFieldItems.map((item) => ({
          idCustomField: item.idCustomField,
          value: item.value,
        }))
      : undefined,
    name: card.name,
    url: card.url,
  };
}

function normalizeTrelloLabel(label: TrelloLabel): TrelloLabel {
  return {
    id: label.id,
    idBoard: label.idBoard,
    name: label.name,
    color: label.color,
  };
}

function normalizeTrelloCustomField(
  customField: TrelloCustomField
): TrelloCustomField {
  const display = (
    customField as TrelloCustomField & {
      display?: {
        name?: string;
      };
    }
  ).display;

  return {
    id: customField.id,
    idModel: customField.idModel,
    modelType: customField.modelType,
    name: display?.name ?? customField.name,
    type: customField.type,
  };
}

export async function fetchTrelloWebhook(
  webhookId: string,
  credentials: TrelloCredentials
): Promise<TrelloWebhook> {
  const url = trelloUrl(`/1/webhooks/${webhookId}`, credentials);
  const webhook = await fetchTrelloJson<TrelloWebhook>(url);

  return normalizeTrelloWebhook(webhook);
}

export async function listTrelloWebhooks(
  credentials: TrelloCredentials
): Promise<TrelloWebhook[]> {
  const url = trelloUrl(`/1/tokens/${credentials.token}/webhooks`, credentials);

  const webhooks = await fetchTrelloJson<TrelloWebhook[]>(url);

  if (!Array.isArray(webhooks)) {
    throw new Error("Trello returned an invalid webhooks response.");
  }

  return webhooks.map(normalizeTrelloWebhook);
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

  return normalizeTrelloWebhook(webhook);
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

  return normalizeTrelloWebhook(webhook);
}

function normalizeTrelloWebhook(webhook: TrelloWebhook): TrelloWebhook {
  return {
    id: webhook.id,
    description: webhook.description,
    idModel: webhook.idModel,
    callbackURL: webhook.callbackURL,
    active: Boolean(webhook.active),
  };
}

async function sendTrelloRequest(
  url: URL,
  method: "DELETE" | "POST" | "PUT"
): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new TrelloApiError(
      `Trello returned ${response.status} ${response.statusText}: ${body}`,
      response.status,
      response.statusText,
      body
    );
  }
}
