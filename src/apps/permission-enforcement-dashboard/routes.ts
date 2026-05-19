import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response, Router } from "express";
import type { AppConfig } from "../../config/env.js";
import { config, getWebhookCallbackUrl } from "../../config/env.js";
import {
  createTrelloWebhook,
  fetchTrelloBoard,
  listTrelloWebhooks,
  type TrelloWebhook,
  updateTrelloWebhookActive,
} from "../../trello/api.js";
import {
  getEnforcedBoard,
  listEnforcedBoards,
  updateEnforcedBoardStatus,
  upsertEnforcedBoard,
} from "./store.js";

type ToggleRequest = {
  enforcementEnabled?: unknown;
};

const ADMIN_COOKIE_NAME = "permission_enforcer_admin";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_PATH = "/admin/permission-enforcer/login";
const BOARDS_PATH = "/admin/permission-enforcer/boards";

export function createPermissionEnforcementDashboardRouter(
  appConfig: AppConfig = config
): Router {
  const router = Router();
  const requirePageAdmin = createAdminAuthMiddleware(appConfig, "page");
  const requireApiAdmin = createAdminAuthMiddleware(appConfig, "api");

  router.get(LOGIN_PATH, (req, res) => {
    if (hasValidAdminSession(req, appConfig)) {
      return res.redirect(BOARDS_PATH);
    }

    return res.status(200).send(renderLoginPage());
  });

  router.post(
    "/api/admin/permission-enforcer/login",
    express.urlencoded({ extended: false }),
    (req, res) => {
      if (!isAdminAuthConfigured(appConfig)) {
        return res.status(500).send(renderLoginPage("Admin auth is not configured."));
      }

      const username = req.body?.username;
      const password = req.body?.password;

      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        !secureStringEqual(username, appConfig.boardAdminUsername || "") ||
        !secureStringEqual(password, appConfig.boardAdminPassword || "")
      ) {
        return res.status(401).send(renderLoginPage("Invalid username or password."));
      }

      res.setHeader("Set-Cookie", createAdminSessionCookie(appConfig));
      return res.redirect(303, BOARDS_PATH);
    }
  );

  router.post("/api/admin/permission-enforcer/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearAdminSessionCookie());
    return res.redirect(303, LOGIN_PATH);
  });

  router.use(
    "/admin/permission-enforcer",
    requirePageAdmin,
    express.static(appConfig.permissionEnforcerAdminPublicPath)
  );

  router.get("/admin/permission-enforcer/boards", requirePageAdmin, (_req, res) => {
    res.sendFile("boards.html", {
      root: appConfig.permissionEnforcerAdminPublicPath,
    });
  });

  router.get("/api/admin/permission-enforcer/boards", requireApiAdmin, async (_req, res) => {
    try {
      const boards = await listEnforcedBoards(appConfig);
      return res.json({ boards });
    } catch (error) {
      console.error("Failed to list enforced boards:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post("/api/admin/permission-enforcer/boards", requireApiAdmin, async (req, res) => {
    const boardId = req.body?.boardId;

    if (typeof boardId !== "string" || boardId.trim() === "") {
      return res.status(400).json({ error: "boardId is required." });
    }

    try {
      const board = await fetchTrelloBoard(boardId.trim(), appConfig);
      const webhook = await getOrCreateActiveWebhook(
        appConfig,
        board.id,
        getWebhookCallbackUrl(appConfig)
      );

      const trackedBoard = await upsertEnforcedBoard(appConfig, {
        boardId: board.id,
        boardName: board.name,
        enforcementEnabled: true,
        webhookId: webhook.id,
        webhookActive: webhook.active,
        webhookCallbackUrl: webhook.callbackURL,
      });

      return res.status(201).json({ board: trackedBoard });
    } catch (error) {
      console.error("Failed to add enforced board:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.patch("/api/admin/permission-enforcer/boards/:boardId", requireApiAdmin, async (req, res) => {
    const validation = validateToggleRequest(req.body);
    const boardId = req.params.boardId;

    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    if (typeof boardId !== "string") {
      return res.status(400).json({ error: "boardId is required." });
    }

    try {
      const trackedBoard = await getEnforcedBoard(appConfig, boardId);

      if (!trackedBoard) {
        return res.status(404).json({ error: "Board is not tracked." });
      }

      const callbackURL = getWebhookCallbackUrl(appConfig);
      const webhook = validation.enforcementEnabled
        ? await getOrCreateActiveWebhook(appConfig, trackedBoard.boardId, callbackURL)
        : await disableWebhookForBoard(appConfig, trackedBoard.webhookId);

      const updatedBoard = await updateEnforcedBoardStatus(
        appConfig,
        trackedBoard.boardId,
        {
          enforcementEnabled: validation.enforcementEnabled,
          webhookId: webhook?.id || trackedBoard.webhookId || null,
          webhookActive: webhook?.active ?? false,
          webhookCallbackUrl: webhook?.callbackURL || trackedBoard.webhookCallbackUrl || null,
          lastError: null,
        }
      );

      return res.json({ board: updatedBoard });
    } catch (error) {
      console.error("Failed to update enforced board:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post("/api/admin/permission-enforcer/boards/refresh", requireApiAdmin, async (_req, res) => {
    try {
      const boards = await listEnforcedBoards(appConfig);
      const webhooks = await listTrelloWebhooks(appConfig);
      const callbackURL = getWebhookCallbackUrl(appConfig);

      await Promise.all(
        boards.map(async (board) => {
          const webhook = findBoardWebhook(webhooks, board.boardId, callbackURL);
          await updateEnforcedBoardStatus(appConfig, board.boardId, {
            webhookId: webhook?.id || null,
            webhookActive: webhook?.active ?? false,
            webhookCallbackUrl: webhook?.callbackURL || callbackURL,
            lastError: webhook ? null : "No Trello webhook found for this board.",
          });
        })
      );

      const refreshedBoards = await listEnforcedBoards(appConfig);
      return res.json({ boards: refreshedBoards });
    } catch (error) {
      console.error("Failed to refresh enforced boards:");
      console.error(error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  return router;
}

function createAdminAuthMiddleware(
  appConfig: AppConfig,
  responseType: "api" | "page"
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAdminAuthConfigured(appConfig)) {
      if (responseType === "api") {
        return res.status(500).json({ error: "Admin auth is not configured." });
      }

      return res.status(500).send(renderLoginPage("Admin auth is not configured."));
    }

    if (hasValidAdminSession(req, appConfig)) {
      return next();
    }

    if (responseType === "api") {
      return res.status(401).json({ error: "Admin login is required." });
    }

    return res.redirect(LOGIN_PATH);
  };
}

function isAdminAuthConfigured(appConfig: AppConfig): boolean {
  return Boolean(appConfig.boardAdminUsername && appConfig.boardAdminPassword);
}

function hasValidAdminSession(req: Request, appConfig: AppConfig): boolean {
  if (!isAdminAuthConfigured(appConfig)) {
    return false;
  }

  const token = parseCookies(req.headers.cookie || "")[ADMIN_COOKIE_NAME];

  if (!token) {
    return false;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = signAdminSessionPayload(payload, appConfig);

  if (!secureStringEqual(signature, expectedSignature)) {
    return false;
  }

  const session = parseAdminSessionPayload(payload);

  if (!session) {
    return false;
  }

  return (
    session.username === appConfig.boardAdminUsername && session.expiresAt > Date.now()
  );
}

function createAdminSessionCookie(appConfig: AppConfig): string {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ username: appConfig.boardAdminUsername, expiresAt }),
    "utf8"
  ).toString("base64url");
  const signature = signAdminSessionPayload(payload, appConfig);
  const expires = new Date(expiresAt).toUTCString();

  return `${ADMIN_COOKIE_NAME}=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${expires}`;
}

function clearAdminSessionCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function signAdminSessionPayload(payload: string, appConfig: AppConfig): string {
  return crypto
    .createHmac("sha256", adminSessionSecret(appConfig))
    .update(payload)
    .digest("base64url");
}

function adminSessionSecret(appConfig: AppConfig): string {
  return `${appConfig.boardAdminUsername || ""}:${appConfig.boardAdminPassword || ""}`;
}

function parseAdminSessionPayload(
  payload: string
): { username: string; expiresAt: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      username?: unknown;
      expiresAt?: unknown;
    };

    if (typeof parsed.username !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }

    return {
      username: parsed.username,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const cookie of header.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();

    if (name) {
      cookies[name] = value;
    }
  }

  return cookies;
}

function secureStringEqual(actual: string, expected: string): boolean {
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();

  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function renderLoginPage(error?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Permission Enforcement Login</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, Helvetica, sans-serif;
        background: #f6f7f9;
        color: #172b4d;
      }

      body {
        margin: 0;
      }

      main {
        max-width: 380px;
        margin: 0 auto;
        padding: 72px 20px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.2;
      }

      p {
        color: #626f86;
        margin: 0 0 24px;
      }

      form {
        display: grid;
        gap: 14px;
      }

      label {
        display: grid;
        gap: 6px;
        font-size: 14px;
        font-weight: 700;
      }

      input {
        border: 1px solid #d0d7de;
        border-radius: 6px;
        font-size: 16px;
        padding: 10px 12px;
      }

      button {
        border: 1px solid #0c66e4;
        border-radius: 6px;
        background: #0c66e4;
        color: white;
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
        padding: 10px 14px;
      }

      .error {
        color: #ae2a19;
        margin-bottom: 16px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Admin Login</h1>
      <p>Sign in to manage permission enforcement boards.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/api/admin/permission-enforcer/login">
        <label>
          Username
          <input name="username" autocomplete="username" required autofocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  </body>
</html>`;
}

async function getOrCreateActiveWebhook(
  appConfig: AppConfig,
  boardId: string,
  callbackURL: string
): Promise<TrelloWebhook> {
  const webhooks = await listTrelloWebhooks(appConfig);
  const existing = findBoardWebhook(webhooks, boardId, callbackURL);

  if (existing) {
    return existing.active
      ? existing
      : updateTrelloWebhookActive(existing.id, true, appConfig);
  }

  return createTrelloWebhook(boardId, callbackURL, appConfig);
}

async function disableWebhookForBoard(
  appConfig: AppConfig,
  webhookId: string | undefined
): Promise<TrelloWebhook | null> {
  if (!webhookId) {
    return null;
  }

  return updateTrelloWebhookActive(webhookId, false, appConfig);
}

function findBoardWebhook(
  webhooks: TrelloWebhook[],
  boardId: string,
  callbackURL: string
): TrelloWebhook | undefined {
  return webhooks.find(
    (webhook) =>
      webhook.idModel === boardId &&
      normalizeUrl(webhook.callbackURL) === normalizeUrl(callbackURL)
  );
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function validateToggleRequest(
  body: ToggleRequest
): { ok: true; enforcementEnabled: boolean } | { ok: false; error: string } {
  if (typeof body?.enforcementEnabled !== "boolean") {
    return { ok: false, error: "enforcementEnabled must be a boolean." };
  }

  return { ok: true, enforcementEnabled: body.enforcementEnabled };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
