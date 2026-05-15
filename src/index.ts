import { createApp } from "./app.js";
import { config, getWebhookCallbackUrl } from "./config/env.js";

const app = createApp(config);

app.listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
  console.log(`Webhook callback URL: ${getWebhookCallbackUrl(config)}`);
});
