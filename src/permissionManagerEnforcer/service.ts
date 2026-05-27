import { getDashboardBoard } from "../enforcementDashboard/repository.js";
import {
  getBoardDepartmentLabelByTrelloLabelId,
  getBoardProjectLabelByTrelloLabelId,
  listBoardProjectLabels,
  markBoardDepartmentLabelSynced,
  markBoardProjectLabelSynced,
  type BoardDepartmentLabelSummary,
  type BoardProjectLabelSummary,
} from "../projectConfigurator/repository.js";
import {
  getOrganizationId,
  getTrelloCredentials,
} from "../projectConfigurator/permissions.js";
import {
  createTrelloLabel,
  fetchTrelloCard,
  isTrelloWorkspaceAdmin,
  moveCard,
  updateTrelloLabel,
  type TrelloCard,
} from "../trello/api.js";
import { getBotMemberId } from "./config.js";

type WebhookPayload = {
  action?: TrelloAction;
  model?: { id?: string };
};

type TrelloAction = {
  type?: string;
  idMemberCreator?: string;
  memberCreator?: { id?: string };
  data?: ActionData;
};

type ActionData = {
  board?: TrelloRef;
  boardSource?: TrelloRef;
  boardTarget?: TrelloRef;
  card?: TrelloCardRef;
  listBefore?: TrelloRef;
  label?: TrelloLabelRef;
  old?: Record<string, unknown>;
};

type TrelloRef = {
  id?: string;
  name?: string;
};

type TrelloCardRef = TrelloRef & {
  idBoard?: string;
  idList?: string;
  idLabels?: string[];
};

type TrelloLabelRef = TrelloRef & {
  idBoard?: string;
  color?: string;
};

export async function enforceTrelloWebhook(payload: unknown): Promise<void> {
  const action = readAction(payload);

  if (!action?.type) {
    return;
  }

  const actorMemberId = action.idMemberCreator ?? action.memberCreator?.id;

  if (!actorMemberId || actorMemberId === getBotMemberId()) {
    return;
  }

  const boardId = getActionBoardId(action);

  if (!boardId) {
    return;
  }

  const board = await getDashboardBoard(boardId);

  if (!board?.enforcementEnabled) {
    return;
  }

  switch (action.type) {
    case "updateCard":
      await enforceCardMoveIfNeeded(action, actorMemberId, boardId);
      break;
    case "updateLabel":
      await enforceUpdateLabel(action, boardId);
      break;
    case "deleteLabel":
      await enforceDeleteLabel(action, boardId);
      break;
  }
}

async function enforceCardMoveIfNeeded(
  action: TrelloAction,
  actorMemberId: string,
  boardId: string
): Promise<void> {
  const old = action.data?.old ?? {};

  if (!("idList" in old || "idBoard" in old)) {
    return;
  }

  const isAdmin = await isTrelloWorkspaceAdmin(
    getOrganizationId(),
    actorMemberId,
    getTrelloCredentials()
  );

  if (isAdmin) {
    return;
  }

  const cardId = action.data?.card?.id;

  if (!cardId) {
    return;
  }

  const sourceBoardId = readString(old.idBoard) ?? action.data?.boardSource?.id;
  const sourceListId =
    readString(old.idList) ??
    action.data?.listBefore?.id ??
    action.data?.card?.idList;

  if (await cardHasSyncedProjectLabel(action, sourceBoardId ?? boardId)) {
    return;
  }

  if (!sourceBoardId && !sourceListId) {
    return;
  }

  await moveCard(
    {
      cardId,
      boardId: sourceBoardId,
      listId: sourceListId,
    },
    getTrelloCredentials()
  );
}

async function enforceUpdateLabel(
  action: TrelloAction,
  boardId: string
): Promise<void> {
  const labelId = action.data?.label?.id;

  if (!labelId) {
    return;
  }

  const label = await getTrackedLabel(boardId, labelId);

  if (!label) {
    return;
  }

  await updateTrelloLabel(
    {
      labelId: label.trelloLabelId,
      name: label.syncedLabelText,
      color: label.syncedColor,
    },
    getTrelloCredentials()
  );
}

async function enforceDeleteLabel(
  action: TrelloAction,
  boardId: string
): Promise<void> {
  const labelId = action.data?.label?.id;

  if (!labelId) {
    return;
  }

  const tracked = await getTrackedLabel(boardId, labelId);

  if (!tracked) {
    return;
  }

  const recreated = await createTrelloLabel(
    {
      boardId,
      name: tracked.syncedLabelText,
      color: tracked.syncedColor,
    },
    getTrelloCredentials()
  );

  if (tracked.kind === "project") {
    await markBoardProjectLabelSynced({
      trelloBoardId: boardId,
      projectId: tracked.projectId,
      trelloLabelId: recreated.id,
      syncedLabelText: tracked.syncedLabelText,
      syncedColor: tracked.syncedColor,
    });
    return;
  }

  await markBoardDepartmentLabelSynced({
    trelloBoardId: boardId,
    departmentId: tracked.departmentId,
    trelloLabelId: recreated.id,
    syncedLabelText: tracked.syncedLabelText,
    syncedColor: tracked.syncedColor,
  });
}

async function cardHasSyncedProjectLabel(
  action: TrelloAction,
  boardId: string
): Promise<boolean> {
  const cardLabelIds =
    action.data?.card?.idLabels ?? (await fetchCardLabelIds(action));

  if (cardLabelIds.length === 0) {
    return false;
  }

  const syncedProjectLabelIds = new Set(
    (await listBoardProjectLabels(boardId))
      .filter((label) => label.syncStatus === "synced")
      .map((label) => label.trelloLabelId)
  );

  return cardLabelIds.some((labelId) => syncedProjectLabelIds.has(labelId));
}

async function fetchCardLabelIds(action: TrelloAction): Promise<string[]> {
  const cardId = action.data?.card?.id;

  if (!cardId) {
    return [];
  }

  try {
    const card: TrelloCard = await fetchTrelloCard(
      cardId,
      getTrelloCredentials()
    );

    return card.idLabels;
  } catch {
    return [];
  }
}

async function getTrackedLabel(
  boardId: string,
  labelId: string
): Promise<TrackedLabel | null> {
  const projectLabel = await getBoardProjectLabelByTrelloLabelId({
    trelloBoardId: boardId,
    trelloLabelId: labelId,
  });

  if (projectLabel) {
    return { kind: "project", ...projectLabel };
  }

  const departmentLabel = await getBoardDepartmentLabelByTrelloLabelId({
    trelloBoardId: boardId,
    trelloLabelId: labelId,
  });

  return departmentLabel ? { kind: "department", ...departmentLabel } : null;
}

type TrackedLabel =
  | ({ kind: "project" } & BoardProjectLabelSummary)
  | ({ kind: "department" } & BoardDepartmentLabelSummary);

function readAction(payload: unknown): TrelloAction | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const action = (payload as WebhookPayload).action;

  return action && typeof action === "object" ? action : null;
}

function getActionBoardId(action: TrelloAction): string | null {
  return (
    action.data?.board?.id ??
    action.data?.boardTarget?.id ??
    action.data?.boardSource?.id ??
    action.data?.card?.idBoard ??
    action.data?.label?.idBoard ??
    null
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}
