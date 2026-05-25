export function getPermissionManagerWebhookCallbackUrl(): string {
  return `${getPublicBaseUrl()}/api/permission-manager-enforcer/webhook`;
}

export function getBotMemberId(): string {
  const botMemberId = process.env.TRELLO_BOT_MEMBER_ID;

  if (!botMemberId) {
    throw new Error("TRELLO_BOT_MEMBER_ID is required.");
  }

  return botMemberId;
}

export function getTrelloSecret(): string {
  const secret = process.env.TRELLO_SECRET;

  if (!secret) {
    throw new Error("TRELLO_SECRET is required.");
  }

  return secret;
}

function getPublicBaseUrl(): string {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");

  if (!publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required.");
  }

  return publicBaseUrl;
}
