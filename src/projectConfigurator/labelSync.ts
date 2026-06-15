import {
  createTrelloLabel,
  listTrelloBoardLabels,
  TrelloApiError,
  updateTrelloLabel,
  type TrelloLabel,
} from "../trello/api.js";
import { getTrelloCredentials } from "./permissions.js";
import {
  listActiveDepartments,
  listActiveProjects,
  listBoardDepartmentLabels,
  listBoardProjectLabels,
  listLabelSyncBoards,
  markBoardDepartmentLabelError,
  markBoardDepartmentLabelSynced,
  markBoardLabelSyncComplete,
  markBoardProjectLabelError,
  markBoardProjectLabelSynced,
  type BoardDepartmentLabelSummary,
  type BoardProjectLabelSummary,
  type DepartmentSummary,
  type ManagedBoardSummary,
  type ProjectSummary,
} from "./repository.js";

export type LabelSyncResult = {
  boards: number;
  attempted: number;
  synced: number;
  failed: number;
};

export async function syncAllConfiguredLabels(
  currentBoardId?: string
): Promise<LabelSyncResult> {
  const [boards, projects, departments] = await Promise.all([
    listLabelSyncBoards(currentBoardId),
    listActiveProjects(),
    listActiveDepartments(),
  ]);

  let attempted = 0;
  let synced = 0;
  let failed = 0;

  for (const board of boards) {
    const result = await syncConfiguredLabelsForBoardWithEntities({
      board,
      projects,
      departments,
    });

    attempted += result.attempted;
    synced += result.synced;
    failed += result.failed;

    await markBoardLabelSyncComplete({
      trelloBoardId: board.trelloBoardId,
      error: result.failed > 0 ? "Some configured labels failed to sync." : null,
    });
  }

  return { boards: boards.length, attempted, synced, failed };
}

export async function syncProjectLabelsForBoard(
  board: ManagedBoardSummary
): Promise<LabelSyncResult> {
  const [projects, departments] = await Promise.all([
    listActiveProjects(),
    listActiveDepartments(),
  ]);

  return syncConfiguredLabelsForBoardWithEntities({
    board,
    projects,
    departments,
  });
}

async function syncConfiguredLabelsForBoardWithEntities(input: {
  board: ManagedBoardSummary;
  projects: ProjectSummary[];
  departments: DepartmentSummary[];
}): Promise<LabelSyncResult> {
  const credentials = getTrelloCredentials();
  const [trelloLabels, trackedProjectLabels, trackedDepartmentLabels] =
    await Promise.all([
      listTrelloBoardLabels(input.board.trelloBoardId, credentials),
      listBoardProjectLabels(input.board.trelloBoardId),
      listBoardDepartmentLabels(input.board.trelloBoardId),
    ]);
  const trelloLabelsById = new Map(trelloLabels.map((label) => [label.id, label]));
  const trackedProjectsById = new Map(
    trackedProjectLabels.map((label) => [label.projectId, label])
  );
  const trackedDepartmentsById = new Map(
    trackedDepartmentLabels.map((label) => [label.departmentId, label])
  );
  let attempted = 0;
  let synced = 0;
  let failed = 0;

  for (const project of input.projects) {
    attempted += 1;

    try {
      await syncProjectLabel({
        board: input.board,
        project,
        trackedLabel: trackedProjectsById.get(project.id) ?? null,
        trelloLabelsById,
      });
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  for (const department of input.departments) {
    attempted += 1;

    try {
      await syncDepartmentLabel({
        board: input.board,
        department,
        trackedLabel: trackedDepartmentsById.get(department.id) ?? null,
        trelloLabelsById,
      });
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { boards: 1, attempted, synced, failed };
}

async function syncProjectLabel(input: {
  board: ManagedBoardSummary;
  project: ProjectSummary;
  trackedLabel: BoardProjectLabelSummary | null;
  trelloLabelsById: Map<string, TrelloLabel>;
}): Promise<void> {
  const { board, project, trackedLabel, trelloLabelsById } = input;

  try {
    const label = await upsertTrelloLabel({
      boardId: board.trelloBoardId,
      trackedLabelId: trackedLabel?.trelloLabelId ?? "",
      trelloLabelsById,
      name: project.labelText,
      color: project.projectColor,
    });

    await markBoardProjectLabelSynced({
      trelloBoardId: board.trelloBoardId,
      projectId: project.id,
      trelloLabelId: label.id,
      syncedLabelText: project.labelText,
      syncedColor: project.projectColor,
    });
  } catch (error) {
    await markBoardProjectLabelError({
      trelloBoardId: board.trelloBoardId,
      projectId: project.id,
      syncedLabelText: project.labelText,
      syncedColor: project.projectColor,
      error: getErrorMessage(error),
    });

    throw error;
  }
}

async function syncDepartmentLabel(input: {
  board: ManagedBoardSummary;
  department: DepartmentSummary;
  trackedLabel: BoardDepartmentLabelSummary | null;
  trelloLabelsById: Map<string, TrelloLabel>;
}): Promise<void> {
  const { board, department, trackedLabel, trelloLabelsById } = input;

  try {
    const label = await upsertTrelloLabel({
      boardId: board.trelloBoardId,
      trackedLabelId: trackedLabel?.trelloLabelId ?? "",
      trelloLabelsById,
      name: department.labelText,
      color: department.departmentColor,
    });

    await markBoardDepartmentLabelSynced({
      trelloBoardId: board.trelloBoardId,
      departmentId: department.id,
      trelloLabelId: label.id,
      syncedLabelText: department.labelText,
      syncedColor: department.departmentColor,
    });
  } catch (error) {
    await markBoardDepartmentLabelError({
      trelloBoardId: board.trelloBoardId,
      departmentId: department.id,
      syncedLabelText: department.labelText,
      syncedColor: department.departmentColor,
      error: getErrorMessage(error),
    });

    throw error;
  }
}

async function upsertTrelloLabel(input: {
  boardId: string;
  trackedLabelId: string;
  trelloLabelsById: Map<string, TrelloLabel>;
  name: string;
  color: string;
}): Promise<TrelloLabel> {
  const existingLabelId =
    input.trackedLabelId && !input.trackedLabelId.startsWith("sync-error-")
      ? input.trackedLabelId
      : "";

  return withTrelloRetry(() =>
    existingLabelId && input.trelloLabelsById.has(existingLabelId)
      ? updateTrelloLabel(
          {
            labelId: existingLabelId,
            name: input.name,
            color: input.color,
          },
          getTrelloCredentials()
        )
      : createTrelloLabel(
          {
            boardId: input.boardId,
            name: input.name,
            color: input.color,
          },
          getTrelloCredentials()
        )
  );
}

async function withTrelloRetry<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [700, 1500, 3000];

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === delays.length || !isRetryableTrelloError(error)) {
        throw error;
      }

      await delay(delays[attempt] ?? 0);
    }
  }

  return operation();
}

function isRetryableTrelloError(error: unknown): boolean {
  return (
    error instanceof TrelloApiError &&
    (error.status === 429 || (error.status >= 500 && error.status < 600))
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
