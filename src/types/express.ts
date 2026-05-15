import type { Request } from "express";

export type TrelloWebhookRequest = Request & {
  rawBody?: Buffer;
};
