import express from "express";

export function createApp(): express.Express {
  const app = express();

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

  return app;
}

export default createApp();
