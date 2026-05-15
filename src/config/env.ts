import "dotenv/config";
import path from "node:path";

export type AppConfig = {
  port: number;
  publicBaseUrl: string;
  databaseUrl?: string;
  trelloKey?: string;
  trelloToken?: string;
  trelloSecret?: string;
  trelloBoardId?: string;
  repoRoot: string;
  permissionsPath: string;
  powerUpPublicPath: string;
  permissionEnforcerAdminPublicPath: string;
};

const repoRoot = process.cwd();

export const config: AppConfig = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  databaseUrl:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL,
  trelloKey: process.env.TRELLO_KEY,
  trelloToken: process.env.TRELLO_TOKEN,
  trelloSecret: process.env.TRELLO_SECRET,
  trelloBoardId: process.env.TRELLO_BOARD_ID,
  repoRoot,
  permissionsPath: path.resolve(repoRoot, "src/core/permissions/permissions.json"),
  powerUpPublicPath: path.resolve(
    repoRoot,
    "public/power-ups/permission-admin-power-up"
  ),
  permissionEnforcerAdminPublicPath: path.resolve(
    repoRoot,
    "public/admin/permission-enforcer"
  ),
};

export function getWebhookCallbackUrl(appConfig = config): string {
  return `${appConfig.publicBaseUrl}/trello/webhook`;
}

export function requireConfigValue(
  value: string | undefined,
  name: string
): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
