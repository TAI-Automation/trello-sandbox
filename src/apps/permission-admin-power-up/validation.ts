export type PermissionUpdate = {
  boardId: string;
  adminMemberId: string;
  memberId: string;
  memberLabel: string;
  allowedListIds: string[];
};

export type ValidationResult =
  | { ok: true; value: PermissionUpdate }
  | { ok: false; error: string };

export function validatePermissionUpdate(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const {
    boardId,
    adminMemberId,
    memberId,
    memberLabel,
    allowedListIds,
  } = body as Partial<PermissionUpdate>;

  if (typeof boardId !== "string" || boardId.trim() === "") {
    return { ok: false, error: "boardId is required." };
  }

  if (typeof adminMemberId !== "string" || adminMemberId.trim() === "") {
    return { ok: false, error: "adminMemberId is required." };
  }

  if (typeof memberId !== "string" || memberId.trim() === "") {
    return { ok: false, error: "memberId is required." };
  }

  if (typeof memberLabel !== "string" || memberLabel.trim() === "") {
    return { ok: false, error: "memberLabel is required." };
  }

  if (!Array.isArray(allowedListIds)) {
    return { ok: false, error: "allowedListIds must be an array." };
  }

  for (const [index, listId] of allowedListIds.entries()) {
    if (typeof listId !== "string" || listId.trim() === "") {
      return {
        ok: false,
        error: `allowedListIds[${index}] must be a non-empty string.`,
      };
    }
  }

  return {
    ok: true,
    value: {
      boardId,
      adminMemberId,
      memberId,
      memberLabel,
      allowedListIds: Array.from(new Set(allowedListIds)),
    },
  };
}
