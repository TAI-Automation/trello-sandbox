import { getDashboardBoard } from "../enforcementDashboard/repository.js";
import {
  getBoardProjectLabelByTrelloLabelId,
  listActiveProjects,
  listBoardProjectLabels,
  listManagedDepartmentIds,
  listManagedProjectIds,
  markBoardProjectLabelSynced,
  type BoardProjectLabelSummary,
} from "../projectConfigurator/repository.js";
import {
  getOrganizationId,
  getTrelloCredentials,
} from "../projectConfigurator/permissions.js";
import {
  addLabelToCard,
  createTrelloLabel,
  deleteTrelloCard,
  deleteTrelloLabel,
  fetchTrelloCard,
  isTrelloWorkspaceAdmin,
  moveCard,
  removeLabelFromCard,
  setCardClosed,
  updateTrelloLabel,
  updateTrelloList,
  type TrelloCard,
} from "../trello/api.js";
import { listSafeLists } from "../enforcementDashboard/safeLists.js";
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
  list?: TrelloRef & { closed?: boolean };
  listBefore?: TrelloRef;
  listAfter?: TrelloRef;
  label?: TrelloLabelRef;
  old?: Record<string, unknown>;
};

type TrelloRef = {
  id?: string;
  name?: string;
};

type TrelloCardRef = TrelloRef & {
  closed?: boolean;
  idBoard?: string;
  idList?: string;
  idLabels?: string[];
};

type TrelloLabelRef = TrelloRef & {
  color?: string;
};

type ProjectLabel = BoardProjectLabelSummary & {
  departmentId: string;
};

const projectLabelPattern = /^[^:\n]+:\s*[^:\n]+$/;

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

  const credentials = getTrelloCredentials();
  const isAdmin = await isTrelloWorkspaceAdmin(
    getOrganizationId(),
    actorMemberId,
    credentials
  );

  if (isAdmin) {
    return;
  }

  switch (action.type) {
    case "createCard":
    case "copyCard":
      await enforceAdminOnlyCardCreate(action);
      break;
    case "updateCard":
      await enforceCardUpdate(action, actorMemberId, boardId);
      break;
    case "addLabelToCard":
      await enforceAddLabelToCard(action, actorMemberId, boardId);
      break;
    case "removeLabelFromCard":
      await enforceRemoveLabelFromCard(action, actorMemberId, boardId);
      break;
    case "createLabel":
      await enforceCreateLabel(action, boardId);
      break;
    case "updateLabel":
      await enforceUpdateLabel(action, boardId);
      break;
    case "deleteLabel":
      await enforceDeleteLabel(action, boardId);
      break;
    case "updateList":
      await enforceUpdateList(action);
      break;
    case "moveListFromBoard":
    case "moveListToBoard":
      await enforceMoveList(action);
      break;
  }
}

async function enforceAdminOnlyCardCreate(action: TrelloAction): Promise<void> {
  const cardId = action.data?.card?.id;

  if (!cardId) {
    return;
  }

  await deleteTrelloCard(cardId, getTrelloCredentials());
}

async function enforceCardUpdate(
  action: TrelloAction,
  actorMemberId: string,
  boardId: string
): Promise<void> {
  const cardId = action.data?.card?.id;

  if (!cardId) {
    return;
  }

  const old = action.data?.old ?? {};

  if (typeof old.closed === "boolean") {
    await setCardClosed(cardId, old.closed, getTrelloCredentials());
  }

  if ("idList" in old || "idBoard" in old) {
    await enforceCardMove(action, actorMemberId, boardId);
  }
}

async function enforceCardMove(
  action: TrelloAction,
  actorMemberId: string,
  boardId: string
): Promise<void> {
  const cardId = action.data?.card?.id;

  if (!cardId) {
    return;
  }

  const old = action.data?.old ?? {};
  const sourceBoardId = readString(old.idBoard) ?? action.data?.boardSource?.id;
  const sourceListId =
    readString(old.idList) ??
    action.data?.listBefore?.id ??
    action.data?.card?.idList;

  if (!(await canMoveCard(action, actorMemberId, boardId))) {
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
}

async function canMoveCard(
  action: TrelloAction,
  actorMemberId: string,
  boardId: string
): Promise<boolean> {
  const old = action.data?.old ?? {};
  const sourceBoardId = readString(old.idBoard) ?? action.data?.boardSource?.id;
  const targetBoardId = action.data?.boardTarget?.id ?? action.data?.board?.id;
  const isCrossBoardMove =
    Boolean(sourceBoardId && targetBoardId) && sourceBoardId !== targetBoardId;

  if (!isCrossBoardMove && (await isSafeListMove(action))) {
    return true;
  }

  const projectLabels = await getCardProjectLabels(
    action,
    sourceBoardId ?? boardId
  );

  return hasProjectMovePermission(actorMemberId, projectLabels);
}

async function isSafeListMove(action: TrelloAction): Promise<boolean> {
  const sourceName = action.data?.listBefore?.name;
  const targetName = action.data?.listAfter?.name ?? action.data?.list?.name;

  if (!sourceName || !targetName) {
    return false;
  }

  const safeNames = new Set(
    (await listSafeLists()).map((safeList) => safeList.nameNormalized)
  );

  return (
    safeNames.has(normalizeName(sourceName)) &&
    safeNames.has(normalizeName(targetName))
  );
}

async function enforceAddLabelToCard(
  action: TrelloAction,
  actorMemberId: string,
  boardId: string
): Promise<void> {
  const cardId = action.data?.card?.id;
  const labelId = action.data?.label?.id;

  if (!cardId || !labelId) {
    return;
  }

  const projectLabel = await getProjectLabelByLabelId(boardId, labelId);

  if (!projectLabel) {
    if (isProjectLabelName(action.data?.label?.name)) {
      await removeLabelFromCard(cardId, labelId, getTrelloCredentials());
      await deleteTrelloLabel(labelId, getTrelloCredentials());
    }

    return;
  }

  if (!(await canManageProjectLabel(actorMemberId, projectLabel))) {
    await removeLabelFromCard(cardId, labelId, getTrelloCredentials());
  }
}

async function enforceRemoveLabelFromCard(
  action: TrelloAction,
  actorMemberId: string,
  boardId: string
): Promise<void> {
  const cardId = action.data?.card?.id;
  const labelId = action.data?.label?.id;

  if (!cardId || !labelId) {
    return;
  }

  const projectLabel = await getProjectLabelByLabelId(boardId, labelId);

  if (
    projectLabel &&
    !(await canManageProjectLabel(actorMemberId, projectLabel))
  ) {
    await addLabelToCard(cardId, labelId, getTrelloCredentials());
  }
}

async function enforceCreateLabel(
  action: TrelloAction,
  boardId: string
): Promise<void> {
  const label = action.data?.label;

  if (!label?.id || !isProjectLabelName(label.name)) {
    return;
  }

  const projectLabel = await getProjectLabelByLabelId(boardId, label.id);

  if (!projectLabel) {
    await deleteTrelloLabel(label.id, getTrelloCredentials());
  }
}

async function enforceUpdateLabel(
  action: TrelloAction,
  boardId: string
): Promise<void> {
  const label = action.data?.label;

  if (!label?.id) {
    return;
  }

  const projectLabel = await getProjectLabelByLabelId(boardId, label.id);

  if (projectLabel) {
    await updateTrelloLabel(
      {
        labelId: projectLabel.trelloLabelId,
        name: projectLabel.syncedLabelText,
        color: projectLabel.syncedColor,
      },
      getTrelloCredentials()
    );
    return;
  }

  if (isProjectLabelName(label.name)) {
    await deleteTrelloLabel(label.id, getTrelloCredentials());
  }
}

async function enforceDeleteLabel(
  action: TrelloAction,
  boardId: string
): Promise<void> {
  const labelId = action.data?.label?.id;

  if (!labelId) {
    return;
  }

  const projectLabel = await getProjectLabelByLabelId(boardId, labelId);

  if (!projectLabel) {
    return;
  }

  const recreated = await createTrelloLabel(
    {
      boardId,
      name: projectLabel.syncedLabelText,
      color: projectLabel.syncedColor,
    },
    getTrelloCredentials()
  );

  await markBoardProjectLabelSynced({
    trelloBoardId: boardId,
    projectId: projectLabel.projectId,
    trelloLabelId: recreated.id,
    syncedLabelText: projectLabel.syncedLabelText,
    syncedColor: projectLabel.syncedColor,
  });
}

async function enforceUpdateList(action: TrelloAction): Promise<void> {
  const listId = action.data?.list?.id;

  if (!listId) {
    return;
  }

  const old = action.data?.old ?? {};
  const name = readString(old.name);
  const closed =
    typeof old.closed === "boolean" ? old.closed : undefined;
  const boardId = readString(old.idBoard);

  if (name === undefined && closed === undefined && boardId === undefined) {
    return;
  }

  await updateTrelloList(
    {
      listId,
      name,
      closed,
      boardId,
    },
    getTrelloCredentials()
  );
}

async function enforceMoveList(action: TrelloAction): Promise<void> {
  const listId = action.data?.list?.id;
  const boardId = action.data?.boardSource?.id ?? action.data?.board?.id;

  if (!listId || !boardId) {
    return;
  }

  await updateTrelloList({ listId, boardId }, getTrelloCredentials());
}

async function getCardProjectLabels(
  action: TrelloAction,
  boardId: string
): Promise<ProjectLabel[]> {
  const cardLabelIds =
    action.data?.card?.idLabels ?? (await fetchCardLabelIds(action));

  if (cardLabelIds.length === 0) {
    return [];
  }

  const projectLabels = await getProjectLabelsForBoard(boardId);
  const cardLabelIdSet = new Set(cardLabelIds);

  return projectLabels.filter((label) =>
    cardLabelIdSet.has(label.trelloLabelId)
  );
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

async function getProjectLabelByLabelId(
  boardId: string,
  labelId: string
): Promise<ProjectLabel | null> {
  const label = await getBoardProjectLabelByTrelloLabelId({
    trelloBoardId: boardId,
    trelloLabelId: labelId,
  });

  if (!label) {
    return null;
  }

  const projects = await listActiveProjects();
  const project = projects.find((item) => item.id === label.projectId);

  if (!project) {
    return null;
  }

  return {
    ...label,
    departmentId: project.departmentId,
  };
}

async function getProjectLabelsForBoard(
  boardId: string
): Promise<ProjectLabel[]> {
  const [labels, projects] = await Promise.all([
    listBoardProjectLabels(boardId),
    listActiveProjects(),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  return labels.flatMap((label) => {
    const project = projectsById.get(label.projectId);

    return project
      ? [
          {
            ...label,
            departmentId: project.departmentId,
          },
        ]
      : [];
  });
}

async function hasProjectMovePermission(
  memberId: string,
  projectLabels: ProjectLabel[]
): Promise<boolean> {
  if (projectLabels.length === 0) {
    return false;
  }

  const [managedProjectIds, managedDepartmentIds] = await Promise.all([
    listManagedProjectIds(memberId),
    listManagedDepartmentIds(memberId),
  ]);
  const managedProjectIdSet = new Set(managedProjectIds);
  const managedDepartmentIdSet = new Set(managedDepartmentIds);

  return projectLabels.some(
    (label) =>
      managedProjectIdSet.has(label.projectId) ||
      managedDepartmentIdSet.has(label.departmentId)
  );
}

async function canManageProjectLabel(
  memberId: string,
  projectLabel: ProjectLabel
): Promise<boolean> {
  const managedDepartmentIds = await listManagedDepartmentIds(memberId);

  return managedDepartmentIds.includes(projectLabel.departmentId);
}

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
    null
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isProjectLabelName(name: string | undefined): boolean {
  return Boolean(name && projectLabelPattern.test(name.trim()));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
