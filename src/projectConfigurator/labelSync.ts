import { getDbPool } from "../db/client.js";
import { retryTrelloRequest } from "../shared/trelloRetry.js";
import {
  createTrelloLabel,
  listTrelloBoardLabels,
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

export type LabelSyncJobResult = LabelSyncResult & {
  phase: "starting" | "syncing" | "done";
  processed: number;
  currentBoardName: string | null;
  done: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type LabelSyncPhase = LabelSyncJobResult["phase"];

type LabelSyncTask = {
  boardId: string;
  boardName: string;
  kind: "project" | "department";
  entityId: string;
  name: string;
  color: string;
};

type LabelSyncJobRow = {
  job_key: string;
  current_board_id: string | null;
  phase: LabelSyncPhase;
  total_boards: number;
  total_labels: number;
  synced: number;
  failed: number;
  done: boolean;
  error: string | null;
  tasks: LabelSyncTask[];
  next_task_index: number;
  board_failures: Record<string, number>;
  started_at: Date;
  finished_at: Date | null;
};

type LabelSyncBoardContext = {
  trelloLabelsById: Map<string, TrelloLabel>;
  trackedProjectsById: Map<string, BoardProjectLabelSummary>;
  trackedDepartmentsById: Map<string, BoardDepartmentLabelSummary>;
};

const LABEL_SYNC_JOB_KEY = "configured-labels";
const LABEL_SYNC_CHUNK_SIZE = 12;

export async function startLabelSyncJob(
  currentBoardId?: string
): Promise<LabelSyncJobResult> {
  const existing = await getStoredLabelSyncJob();

  if (existing && !existing.done) {
    return mapLabelSyncJob(existing);
  }

  await upsertLabelSyncJob({
    currentBoardId: currentBoardId ?? null,
    phase: "starting",
    totalBoards: 0,
    totalLabels: 0,
    synced: 0,
    failed: 0,
    done: false,
    error: null,
    tasks: [],
    nextTaskIndex: 0,
    boardFailures: {},
    finishedAt: null,
  });

  try {
    await initializeLabelSyncJob(currentBoardId);
  } catch (error) {
    await markLabelSyncJobFailed(getErrorMessage(error));
  }

  const job = await getStoredLabelSyncJob();

  if (!job) {
    throw new Error("Label sync job was not created.");
  }

  return mapLabelSyncJob(job);
}

export async function getLabelSyncJob(): Promise<LabelSyncJobResult | null> {
  const job = await getStoredLabelSyncJob();

  if (!job) {
    return null;
  }

  if (!job.done && job.phase === "syncing") {
    await processLabelSyncChunk(job);
    const updatedJob = await getStoredLabelSyncJob();
    return updatedJob ? mapLabelSyncJob(updatedJob) : null;
  }

  return mapLabelSyncJob(job);
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

async function initializeLabelSyncJob(
  currentBoardId?: string
): Promise<void> {
  const [boards, projects, departments] = await Promise.all([
    listLabelSyncBoards(currentBoardId),
    listActiveProjects(),
    listActiveDepartments(),
  ]);
  const tasks = boards.flatMap((board) => [
    ...projects.map((project): LabelSyncTask => ({
      boardId: board.trelloBoardId,
      boardName: board.boardName,
      kind: "project",
      entityId: project.id,
      name: project.labelText,
      color: project.projectColor,
    })),
    ...departments.map((department): LabelSyncTask => ({
      boardId: board.trelloBoardId,
      boardName: board.boardName,
      kind: "department",
      entityId: department.id,
      name: department.labelText,
      color: department.departmentColor,
    })),
  ]);
  const done = tasks.length === 0;

  await upsertLabelSyncJob({
    currentBoardId: currentBoardId ?? null,
    phase: done ? "done" : "syncing",
    totalBoards: boards.length,
    totalLabels: tasks.length,
    synced: 0,
    failed: 0,
    done,
    error: null,
    tasks,
    nextTaskIndex: 0,
    boardFailures: {},
    finishedAt: done ? new Date() : null,
  });

  if (done) {
    await Promise.all(
      boards.map((board) =>
        markBoardLabelSyncComplete({
          trelloBoardId: board.trelloBoardId,
          error: null,
        })
      )
    );
  }
}

async function processLabelSyncChunk(job: LabelSyncJobRow): Promise<void> {
  const chunk = job.tasks.slice(
    job.next_task_index,
    job.next_task_index + LABEL_SYNC_CHUNK_SIZE
  );

  if (chunk.length === 0) {
    await finishLabelSyncJob();
    return;
  }

  const boardFailures = { ...job.board_failures };
  const contexts = new Map<string, LabelSyncBoardContext>();
  let synced = 0;
  let failed = 0;

  for (const task of chunk) {
    try {
      const context =
        contexts.get(task.boardId) ?? (await getLabelSyncBoardContext(task.boardId));

      contexts.set(task.boardId, context);
      await syncLabelTask(task, context);
      synced += 1;
    } catch (error) {
      failed += 1;
      boardFailures[task.boardId] = (boardFailures[task.boardId] ?? 0) + 1;
      await markLabelTaskError(task, getErrorMessage(error)).catch(() => undefined);
      console.log("project-configurator label sync failed", {
        trelloBoardId: task.boardId,
        kind: task.kind,
        entityId: task.entityId,
        labelName: task.name,
        error: getErrorMessage(error),
      });
    }
  }

  const nextTaskIndex = job.next_task_index + chunk.length;
  const done = nextTaskIndex >= job.tasks.length;

  await markCompletedBoards(job.tasks, job.next_task_index, nextTaskIndex, boardFailures);
  await updateLabelSyncJobProgress({
    synced,
    failed,
    nextTaskIndex,
    boardFailures,
    done,
  });
}

async function getLabelSyncBoardContext(
  trelloBoardId: string
): Promise<LabelSyncBoardContext> {
  const [trelloLabels, trackedProjectLabels, trackedDepartmentLabels] =
    await Promise.all([
      listTrelloBoardLabels(trelloBoardId, getTrelloCredentials()),
      listBoardProjectLabels(trelloBoardId),
      listBoardDepartmentLabels(trelloBoardId),
    ]);

  return {
    trelloLabelsById: new Map(trelloLabels.map((label) => [label.id, label])),
    trackedProjectsById: new Map(
      trackedProjectLabels.map((label) => [label.projectId, label])
    ),
    trackedDepartmentsById: new Map(
      trackedDepartmentLabels.map((label) => [label.departmentId, label])
    ),
  };
}

async function syncLabelTask(
  task: LabelSyncTask,
  context: LabelSyncBoardContext
): Promise<void> {
  if (task.kind === "project") {
    await syncProjectLabel({
      boardId: task.boardId,
      projectId: task.entityId,
      name: task.name,
      color: task.color,
      trackedLabel: context.trackedProjectsById.get(task.entityId) ?? null,
      trelloLabelsById: context.trelloLabelsById,
    });
    return;
  }

  await syncDepartmentLabel({
    boardId: task.boardId,
    departmentId: task.entityId,
    name: task.name,
    color: task.color,
    trackedLabel: context.trackedDepartmentsById.get(task.entityId) ?? null,
    trelloLabelsById: context.trelloLabelsById,
  });
}

async function markLabelTaskError(
  task: LabelSyncTask,
  error: string
): Promise<void> {
  if (task.kind === "project") {
    await markBoardProjectLabelError({
      trelloBoardId: task.boardId,
      projectId: task.entityId,
      syncedLabelText: task.name,
      syncedColor: task.color,
      error,
    });
    return;
  }

  await markBoardDepartmentLabelError({
    trelloBoardId: task.boardId,
    departmentId: task.entityId,
    syncedLabelText: task.name,
    syncedColor: task.color,
    error,
  });
}

async function markCompletedBoards(
  tasks: LabelSyncTask[],
  previousTaskIndex: number,
  nextTaskIndex: number,
  boardFailures: Record<string, number>
): Promise<void> {
  const completedBoardIds = new Set<string>();

  for (let index = previousTaskIndex; index < nextTaskIndex; index += 1) {
    const task = tasks[index];
    const nextTask = tasks[index + 1];

    if (task && (!nextTask || nextTask.boardId !== task.boardId)) {
      completedBoardIds.add(task.boardId);
    }
  }

  await Promise.all(
    [...completedBoardIds].map((trelloBoardId) =>
      markBoardLabelSyncComplete({
        trelloBoardId,
        error:
          (boardFailures[trelloBoardId] ?? 0) > 0
            ? "Some configured labels failed to sync."
            : null,
      })
    )
  );
}

async function syncConfiguredLabelsForBoardWithEntities(input: {
  board: ManagedBoardSummary;
  projects: ProjectSummary[];
  departments: DepartmentSummary[];
}): Promise<LabelSyncResult> {
  const context = await getLabelSyncBoardContext(input.board.trelloBoardId);
  let attempted = 0;
  let synced = 0;
  let failed = 0;

  for (const project of input.projects) {
    attempted += 1;

    try {
      await syncProjectLabel({
        boardId: input.board.trelloBoardId,
        projectId: project.id,
        name: project.labelText,
        color: project.projectColor,
        trackedLabel: context.trackedProjectsById.get(project.id) ?? null,
        trelloLabelsById: context.trelloLabelsById,
      });
      synced += 1;
    } catch (error) {
      failed += 1;
      await markBoardProjectLabelError({
        trelloBoardId: input.board.trelloBoardId,
        projectId: project.id,
        syncedLabelText: project.labelText,
        syncedColor: project.projectColor,
        error: getErrorMessage(error),
      });
    }
  }

  for (const department of input.departments) {
    attempted += 1;

    try {
      await syncDepartmentLabel({
        boardId: input.board.trelloBoardId,
        departmentId: department.id,
        name: department.labelText,
        color: department.departmentColor,
        trackedLabel: context.trackedDepartmentsById.get(department.id) ?? null,
        trelloLabelsById: context.trelloLabelsById,
      });
      synced += 1;
    } catch (error) {
      failed += 1;
      await markBoardDepartmentLabelError({
        trelloBoardId: input.board.trelloBoardId,
        departmentId: department.id,
        syncedLabelText: department.labelText,
        syncedColor: department.departmentColor,
        error: getErrorMessage(error),
      });
    }
  }

  return { boards: 1, attempted, synced, failed };
}

async function syncProjectLabel(input: {
  boardId: string;
  projectId: string;
  name: string;
  color: string;
  trackedLabel: BoardProjectLabelSummary | null;
  trelloLabelsById: Map<string, TrelloLabel>;
}): Promise<void> {
  const label = await upsertTrelloLabel({
    boardId: input.boardId,
    trackedLabelId: input.trackedLabel?.trelloLabelId ?? "",
    trelloLabelsById: input.trelloLabelsById,
    name: input.name,
    color: input.color,
  });

  input.trelloLabelsById.set(label.id, label);
  await markBoardProjectLabelSynced({
    trelloBoardId: input.boardId,
    projectId: input.projectId,
    trelloLabelId: label.id,
    syncedLabelText: input.name,
    syncedColor: input.color,
  });
}

async function syncDepartmentLabel(input: {
  boardId: string;
  departmentId: string;
  name: string;
  color: string;
  trackedLabel: BoardDepartmentLabelSummary | null;
  trelloLabelsById: Map<string, TrelloLabel>;
}): Promise<void> {
  const label = await upsertTrelloLabel({
    boardId: input.boardId,
    trackedLabelId: input.trackedLabel?.trelloLabelId ?? "",
    trelloLabelsById: input.trelloLabelsById,
    name: input.name,
    color: input.color,
  });

  input.trelloLabelsById.set(label.id, label);
  await markBoardDepartmentLabelSynced({
    trelloBoardId: input.boardId,
    departmentId: input.departmentId,
    trelloLabelId: label.id,
    syncedLabelText: input.name,
    syncedColor: input.color,
  });
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
  const existingLabel =
    existingLabelId && input.trelloLabelsById.has(existingLabelId)
      ? input.trelloLabelsById.get(existingLabelId)
      : findTrelloLabelByName(input.trelloLabelsById, input.name);

  if (
    existingLabel &&
    existingLabel.name === input.name &&
    existingLabel.color === input.color
  ) {
    return existingLabel;
  }

  return retryTrelloRequest(() =>
    existingLabel
      ? updateTrelloLabel(
          {
            labelId: existingLabel.id,
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

function findTrelloLabelByName(
  trelloLabelsById: Map<string, TrelloLabel>,
  name: string
): TrelloLabel | undefined {
  return [...trelloLabelsById.values()].find((label) => label.name === name);
}

async function upsertLabelSyncJob(input: {
  currentBoardId: string | null;
  phase: LabelSyncPhase;
  totalBoards: number;
  totalLabels: number;
  synced: number;
  failed: number;
  done: boolean;
  error: string | null;
  tasks: LabelSyncTask[];
  nextTaskIndex: number;
  boardFailures: Record<string, number>;
  finishedAt: Date | null;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into label_sync_jobs (
        job_key,
        current_board_id,
        phase,
        total_boards,
        total_labels,
        synced,
        failed,
        done,
        error,
        tasks,
        next_task_index,
        board_failures,
        started_at,
        finished_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, now(), $13, now())
      on conflict (job_key) do update
      set current_board_id = excluded.current_board_id,
          phase = excluded.phase,
          total_boards = excluded.total_boards,
          total_labels = excluded.total_labels,
          synced = excluded.synced,
          failed = excluded.failed,
          done = excluded.done,
          error = excluded.error,
          tasks = excluded.tasks,
          next_task_index = excluded.next_task_index,
          board_failures = excluded.board_failures,
          started_at = now(),
          finished_at = excluded.finished_at,
          updated_at = now()
    `,
    [
      LABEL_SYNC_JOB_KEY,
      input.currentBoardId,
      input.phase,
      input.totalBoards,
      input.totalLabels,
      input.synced,
      input.failed,
      input.done,
      input.error,
      JSON.stringify(input.tasks),
      input.nextTaskIndex,
      JSON.stringify(input.boardFailures),
      input.finishedAt,
    ]
  );
}

async function updateLabelSyncJobProgress(input: {
  synced: number;
  failed: number;
  nextTaskIndex: number;
  boardFailures: Record<string, number>;
  done: boolean;
}): Promise<void> {
  await getDbPool().query(
    `
      update label_sync_jobs
      set synced = synced + $2,
          failed = failed + $3,
          next_task_index = $4,
          phase = case when $5 then 'done' else 'syncing' end,
          done = $5,
          board_failures = $6::jsonb,
          finished_at = case when $5 then now() else null end,
          updated_at = now()
      where job_key = $1
    `,
    [
      LABEL_SYNC_JOB_KEY,
      input.synced,
      input.failed,
      input.nextTaskIndex,
      input.done,
      JSON.stringify(input.boardFailures),
    ]
  );
}

async function markLabelSyncJobFailed(error: string): Promise<void> {
  await getDbPool().query(
    `
      update label_sync_jobs
      set phase = 'done',
          done = true,
          error = $2,
          finished_at = now(),
          updated_at = now()
      where job_key = $1
    `,
    [LABEL_SYNC_JOB_KEY, error]
  );
}

async function finishLabelSyncJob(): Promise<void> {
  await getDbPool().query(
    `
      update label_sync_jobs
      set phase = 'done',
          done = true,
          finished_at = now(),
          updated_at = now()
      where job_key = $1
    `,
    [LABEL_SYNC_JOB_KEY]
  );
}

async function getStoredLabelSyncJob(): Promise<LabelSyncJobRow | null> {
  const result = await getDbPool().query<LabelSyncJobRow>(
    `
      select
        job_key,
        current_board_id,
        phase,
        total_boards,
        total_labels,
        synced,
        failed,
        done,
        error,
        tasks,
        next_task_index,
        board_failures,
        started_at,
        finished_at
      from label_sync_jobs
      where job_key = $1
    `,
    [LABEL_SYNC_JOB_KEY]
  );

  return result.rows[0] ?? null;
}

function mapLabelSyncJob(row: LabelSyncJobRow): LabelSyncJobResult {
  const currentTask = row.tasks[row.next_task_index] ?? null;

  return {
    phase: row.phase,
    boards: row.total_boards,
    attempted: row.total_labels,
    processed: row.next_task_index,
    synced: row.synced,
    failed: row.failed,
    currentBoardName: currentTask?.boardName ?? null,
    done: row.done,
    error: row.error,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
