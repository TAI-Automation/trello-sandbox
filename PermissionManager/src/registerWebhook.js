import "dotenv/config";

const {
  TRELLO_KEY,
  TRELLO_TOKEN,
  TRELLO_BOARD_ID,
  PUBLIC_BASE_URL,
} = process.env;

const callbackURL = `${PUBLIC_BASE_URL}/trello/webhook`;

const url = new URL("https://api.trello.com/1/webhooks/");
url.searchParams.set("key", TRELLO_KEY);
url.searchParams.set("token", TRELLO_TOKEN);
url.searchParams.set("description", "Card move listener");
url.searchParams.set("callbackURL", callbackURL);
url.searchParams.set("idModel", TRELLO_BOARD_ID);
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