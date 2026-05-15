import "dotenv/config";
import { config, getWebhookCallbackUrl, requireConfigValue } from "../../config/env.js";

const key = requireConfigValue(config.trelloKey, "TRELLO_KEY");
const token = requireConfigValue(config.trelloToken, "TRELLO_TOKEN");
const boardId = requireConfigValue(config.trelloBoardId, "TRELLO_BOARD_ID");
const callbackURL = getWebhookCallbackUrl(config);

const url = new URL("https://api.trello.com/1/webhooks/");
url.searchParams.set("key", key);
url.searchParams.set("token", token);
url.searchParams.set("description", "Card move listener");
url.searchParams.set("callbackURL", callbackURL);
url.searchParams.set("idModel", boardId);
url.searchParams.set("active", "true");

const response = await fetch(url, {
  method: "POST",
  headers: {
    Accept: "application/json",
  },
});

const body = await response.text();

if (!response.ok) {
  console.error("Failed to create webhook:");
  console.error(response.status, response.statusText);
  console.error(body);
  process.exit(1);
}

console.log("Webhook created:");
console.log(JSON.stringify(JSON.parse(body), null, 2));
