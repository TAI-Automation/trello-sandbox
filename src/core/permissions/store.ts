import fs from "node:fs";

export type PermissionEntry = {
  memberId: string;
  memberLabel?: string;
  deniedListIds: string[];
};

export type PermissionsDocument = {
  restrictedMoves: PermissionEntry[];
};

export type LoadedMemberRestriction = {
  memberLabel?: string;
  deniedListIds: Set<string>;
};

export type PermissionsState = {
  mtimeMs: number | null;
  permissions: Map<string, LoadedMemberRestriction>;
};

export function loadPermissionsState(filePath: string): PermissionsState {
  return {
    mtimeMs: getFileMtimeMs(filePath),
    permissions: loadPermissions(filePath),
  };
}

export function loadPermissions(
  filePath: string
): Map<string, LoadedMemberRestriction> {
  if (!fs.existsSync(filePath)) {
    console.warn(`Permissions file not found at ${filePath}; no moves are restricted.`);
    return new Map();
  }

  const parsed = readPermissionsDocument(filePath);
  const restrictedMoves = new Map<string, LoadedMemberRestriction>();

  for (const entry of parsed.restrictedMoves) {
    restrictedMoves.set(entry.memberId, {
      memberLabel: entry.memberLabel,
      deniedListIds: new Set(entry.deniedListIds),
    });
  }

  console.log(
    `Loaded ${restrictedMoves.size} restricted member permission set(s) from ${filePath}.`
  );

  return restrictedMoves;
}

export function readPermissionsDocument(filePath: string): PermissionsDocument {
  if (!fs.existsSync(filePath)) {
    return { restrictedMoves: [] };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read permissions file at ${filePath}: ${message}`);
  }

  assertPermissionsDocument(parsed);
  return parsed;
}

export function writePermissionsDocument(
  filePath: string,
  document: PermissionsDocument
): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(document, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

export function getFileMtimeMs(filePath: string): number | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.statSync(filePath).mtimeMs;
}

function assertPermissionsDocument(value: unknown): asserts value is PermissionsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Permissions file must contain a JSON object.");
  }

  const candidate = value as { restrictedMoves?: unknown };

  if (!Array.isArray(candidate.restrictedMoves)) {
    throw new Error("Permissions file must contain a restrictedMoves array.");
  }

  const seenMemberIds = new Set<string>();

  for (const [index, entry] of candidate.restrictedMoves.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`restrictedMoves[${index}] must be an object.`);
    }

    const permission = entry as Partial<PermissionEntry>;

    if (typeof permission.memberId !== "string" || permission.memberId.trim() === "") {
      throw new Error(`restrictedMoves[${index}].memberId must be a non-empty string.`);
    }

    if (seenMemberIds.has(permission.memberId)) {
      throw new Error(`Duplicate restrictedMoves entry for memberId ${permission.memberId}.`);
    }

    seenMemberIds.add(permission.memberId);

    if (
      permission.memberLabel !== undefined &&
      typeof permission.memberLabel !== "string"
    ) {
      throw new Error(`restrictedMoves[${index}].memberLabel must be a string when provided.`);
    }

    if (!Array.isArray(permission.deniedListIds)) {
      throw new Error(`restrictedMoves[${index}].deniedListIds must be an array.`);
    }

    for (const [listIndex, listId] of permission.deniedListIds.entries()) {
      if (typeof listId !== "string" || listId.trim() === "") {
        throw new Error(
          `restrictedMoves[${index}].deniedListIds[${listIndex}] must be a non-empty string.`
        );
      }
    }
  }
}
