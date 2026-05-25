import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectConfiguratorRouter } from "./projectConfigurator/routes.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const publicDir = path.join(projectRoot, "public");

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(express.static(publicDir));
  app.use(projectConfiguratorRouter);

  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Trello Plugins</title>
  </head>
  <body></body>
</html>`);
  });

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        typeof error.status === "number"
          ? error.status
          : 500;
      const message =
        error instanceof Error ? error.message : "Unexpected server error.";

      res.status(status).json({ error: message });
    }
  );

  return app;
}

export default createApp();
