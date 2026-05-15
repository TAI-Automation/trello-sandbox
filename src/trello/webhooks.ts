import crypto from "node:crypto";
import type { AppConfig } from "../config/env.js";
import { config, getWebhookCallbackUrl } from "../config/env.js";
import type { TrelloWebhookRequest } from "../types/express.js";

export function isValidTrelloWebhook(
  req: TrelloWebhookRequest,
  appConfig: AppConfig = config
): boolean {
  const header = req.get("X-Trello-Webhook");
  const callbackUrl = getWebhookCallbackUrl(appConfig);

  if (!header || !appConfig.trelloSecret || !callbackUrl || !req.rawBody) {
    return false;
  }

  const content = Buffer.concat([
    req.rawBody,
    Buffer.from(callbackUrl, "utf8"),
  ]);

  const digest = crypto
    .createHmac("sha1", appConfig.trelloSecret)
    .update(content)
    .digest("base64");

  const digestBuffer = Buffer.from(digest);
  const headerBuffer = Buffer.from(header);

  if (digestBuffer.length !== headerBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(digestBuffer, headerBuffer);
}
