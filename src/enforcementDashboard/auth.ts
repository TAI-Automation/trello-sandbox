import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const cookieName = "board_admin_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;

type SessionPayload = {
  username: string;
  expiresAt: number;
};

export function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: "Authentication is required." });
    return;
  }

  next();
}

export function authenticateAdmin(input: {
  username: string;
  password: string;
}): boolean {
  return (
    timingSafeEqual(input.username, getAdminUsername()) &&
    timingSafeEqual(input.password, getAdminPassword())
  );
}

export function setAdminSessionCookie(res: Response): void {
  const payload: SessionPayload = {
    username: getAdminUsername(),
    expiresAt: Date.now() + sessionDurationMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = sign(encodedPayload);

  res.setHeader(
    "Set-Cookie",
    serializeCookie(`${encodedPayload}.${signature}`, {
      httpOnly: true,
      maxAge: Math.floor(sessionDurationMs / 1000),
      path: "/",
      sameSite: "Lax",
      secure: shouldUseSecureCookie(),
    })
  );
}

export function clearAdminSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie("", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: shouldUseSecureCookie(),
    })
  );
}

export function isAuthenticated(req: Request): boolean {
  const cookie = parseCookies(req.headers.cookie)[cookieName];

  if (!cookie) {
    return false;
  }

  const [encodedPayload, signature] = cookie.split(".");

  if (
    !encodedPayload ||
    !signature ||
    !timingSafeEqual(signature, sign(encodedPayload))
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<SessionPayload>;

    return (
      payload.username === getAdminUsername() &&
      typeof payload.expiresAt === "number" &&
      payload.expiresAt > Date.now()
    );
  } catch {
    return false;
  }
}

function getAdminUsername(): string {
  const username = process.env.BOARD_ADMIN_USERNAME;

  if (!username) {
    throw new Error("BOARD_ADMIN_USERNAME is required.");
  }

  return username;
}

function getAdminPassword(): string {
  const password = process.env.BOARD_ADMIN_PASSWORD;

  if (!password) {
    throw new Error("BOARD_ADMIN_PASSWORD is required.");
  }

  return password;
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", `${getAdminUsername()}:${getAdminPassword()}`)
    .update(value)
    .digest("base64url");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((cookies, part) => {
    const index = part.indexOf("=");

    if (index === -1) {
      return cookies;
    }

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (name) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = "";
      }
    }

    return cookies;
  }, {});
}

function serializeCookie(
  value: string,
  options: {
    httpOnly: boolean;
    maxAge: number;
    path: string;
    sameSite: "Lax";
    secure: boolean;
  }
): string {
  const parts = [
    `${cookieName}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function shouldUseSecureCookie(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    (process.env.PUBLIC_BASE_URL ?? "").startsWith("https://")
  );
}
