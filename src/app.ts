import express from "express";
import type { AppConfig } from "./config/env.js";
import { config } from "./config/env.js";
import { createPermissionAdminPowerUpRouter } from "./apps/permission-admin-power-up/backend/routes.js";
import { createPermissionEnforcerRouter } from "./apps/permission-enforcer/routes.js";
import type { TrelloWebhookRequest } from "./types/express.js";

export function createApp(appConfig: AppConfig = config): express.Express {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as TrelloWebhookRequest).rawBody = buf;
      },
    })
  );

  app.use(
    "/power-ups/permission-admin-power-up",
    express.static(appConfig.powerUpPublicPath)
  );

  app.get("/", (_req, res) => {
    res.send("Trello permission apps are running.");
  });

  app.use(createPermissionAdminPowerUpRouter(appConfig));
  app.use(createPermissionEnforcerRouter(appConfig));

  return app;
}

export default createApp();
