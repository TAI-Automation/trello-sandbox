import crypto from "node:crypto";

export type TrelloWebhookValidationInput = {
  callbackUrl: string;
  header?: string;
  rawBody?: Buffer;
  secret?: string;
};

export function isValidTrelloWebhook({
  callbackUrl,
  header,
  rawBody,
  secret,
}: TrelloWebhookValidationInput): boolean {
  if (!header || !secret || !callbackUrl || !rawBody) {
    return false;
  }

  const content = Buffer.concat([rawBody, Buffer.from(callbackUrl, "utf8")]);

  const digest = crypto
    .createHmac("sha1", secret)
    .update(content)
    .digest("base64");

  const digestBuffer = Buffer.from(digest);
  const headerBuffer = Buffer.from(header);

  if (digestBuffer.length !== headerBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(digestBuffer, headerBuffer);
}
