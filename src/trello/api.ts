import type { AppConfig } from "../config/env.js";
import { config, requireConfigValue } from "../config/env.js";

export type TrelloBoard = {
  id: string;
  name: string;
  memberships: unknown[];
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

export type TrelloWebhook = {
  id: string;
  description?: string;
  idModel: string;
  callbackURL: string;
  active: boolean;
};

function trelloUrl(pathname: string, appConfig: AppConfig = config): URL {
  const key = requireConfigValue(appConfig.trelloKey, "TRELLO_KEY");
  const token = requireConfigValue(appConfig.trelloToken, "TRELLO_TOKEN");
  const url = new URL(pathname, "https://api.trello.com");
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
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
  appConfig: AppConfig = config
): Promise<TrelloBoard> {
  const url = trelloUrl(`/1/boards/${boardId}`, appConfig);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("memberships", "all");

  const board = await fetchTrelloJson<{
    id: string;
    name: string;
    memberships?: unknown[];
  }>(url);

  return {
    id: board.id,
    name: board.name,
    memberships: Array.isArray(board.memberships) ? board.memberships : [],
  };
}

export async function fetchTrelloBoardMembers(
  boardId: string,
  appConfig: AppConfig = config
): Promise<TrelloMember[]> {
  const url = trelloUrl(`/1/boards/${boardId}/members`, appConfig);
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
  appConfig: AppConfig = config
): Promise<TrelloList[]> {
  const url = trelloUrl(`/1/boards/${boardId}/lists`, appConfig);
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
  appConfig: AppConfig = config
): Promise<void> {
  const url = trelloUrl(`/1/cards/${cardId}`, appConfig);
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

export async function listTrelloWebhooks(
  appConfig: AppConfig = config
): Promise<TrelloWebhook[]> {
  const token = requireConfigValue(appConfig.trelloToken, "TRELLO_TOKEN");
  const url = trelloUrl(`/1/tokens/${token}/webhooks`, appConfig);

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
  appConfig: AppConfig = config
): Promise<TrelloWebhook> {
  const url = trelloUrl("/1/webhooks/", appConfig);
  url.searchParams.set("description", "Permission enforcement listener");
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
  appConfig: AppConfig = config
): Promise<TrelloWebhook> {
  const url = trelloUrl(`/1/webhooks/${webhookId}`, appConfig);
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
