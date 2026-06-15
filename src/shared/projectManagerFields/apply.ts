import { getDbPool } from "../../db/client.js";
import {
  listActiveProjects,
  listBoardProjectLabels,
  type ProjectSummary,
  type ProjectManagerSummary,
} from "../../projectConfigurator/repository.js";
import { getTrelloCredentials } from "../../projectConfigurator/permissions.js";
import {
  clearTrelloCardCustomField,
  listTrelloBoardCards,
  setTrelloCardTextCustomField,
  TrelloApiError,
  type TrelloCard,
} from "../../trello/api.js";
import { ensureProjectManagerCustomField } from "./customField.js";
import { formatProjectManagers } from "./format.js";

export type ProjectManagerFieldApplyResult = {
  boardId: string;
  phase: "starting" | "scanning" | "applying" | "done";
  totalCards: number;
  matchedCards: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  done: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type ApplyPhase = ProjectManagerFieldApplyResult["phase"];

type StoredUpdate = {
  cardId: string;
  currentValue: string | null;
  value: string;
};

type ApplyJobRow = {
  board_id: string;
  phase: ApplyPhase;
  total_cards: number;
  matched_cards: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  done: boolean;
  error: string | null;
  custom_field_id: string | null;
  updates: StoredUpdate[];
  next_update_index: number;
  started_at: Date;
  finished_at: Date | null;
};

const APPLY_CONCURRENCY = 4;
const APPLY_CHUNK_SIZE = 24;

export async function getProjectManagerFieldApplyJob(
  boardId: string
): Promise<ProjectManagerFieldApplyResult | null> {
  const job = await getStoredApplyJob(boardId);

  if (!job || job.done) {
    return job ? mapApplyJob(rowWithoutInternalFields(job)) : null;
  }

  if (job.phase === "applying") {
    await processProjectManagerFieldApplyChunk(job);
    return getProjectManagerFieldApplyJob(boardId);
  }

  return mapApplyJob(rowWithoutInternalFields(job));
}

export async function startProjectManagerFieldApplyJob(
  boardId: string
): Promise<ProjectManagerFieldApplyResult> {
  const existing = await getStoredApplyJob(boardId);

  if (existing && !existing.done) {
    return mapApplyJob(rowWithoutInternalFields(existing));
  }

  await upsertApplyJob({
    boardId,
    phase: "scanning",
    totalCards: 0,
    matchedCards: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    done: false,
    error: null,
    customFieldId: null,
    updates: [],
    nextUpdateIndex: 0,
    finishedAt: null,
  });

  try {
    await initializeProjectManagerFieldApplyJob(boardId);
  } catch (error) {
    await markApplyJobFailed(boardId, getErrorMessage(error));
  }

  const job = await getStoredApplyJob(boardId);

  if (!job) {
    throw new Error("Project manager field apply job was not created.");
  }

  return mapApplyJob(rowWithoutInternalFields(job));
}

async function initializeProjectManagerFieldApplyJob(
  boardId: string
): Promise<void> {
  const credentials = getTrelloCredentials();
  const [customField, cards, projects, labels] = await Promise.all([
    ensureProjectManagerCustomField(boardId, credentials),
    listTrelloBoardCards(boardId, credentials),
    listActiveProjects(),
    listBoardProjectLabels(boardId),
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const projectIdByLabelId = new Map(
    labels
      .filter((label) => label.syncStatus === "synced")
      .map((label) => [label.trelloLabelId, label.projectId])
  );
  const updates: StoredUpdate[] = [];
  let unchanged = 0;

  for (const card of cards) {
    const projectManagers = findCardProjectManagers(
      card,
      projectById,
      projectIdByLabelId
    );

    if (!projectManagers) {
      continue;
    }

    const value = formatProjectManagers(projectManagers);
    const currentValue = getCardTextCustomFieldValue(card, customField.id);

    if (currentValue === value || (!currentValue && !value)) {
      unchanged += 1;
      continue;
    }

    updates.push({
      cardId: card.id,
      currentValue,
      value,
    });
  }

  await updateInitializedApplyJob({
    boardId,
    customFieldId: customField.id,
    totalCards: cards.length,
    matchedCards: updates.length + unchanged,
    skipped: cards.length - updates.length - unchanged,
    unchanged,
    updates,
  });
}

async function processProjectManagerFieldApplyChunk(
  job: ApplyJobRow
): Promise<void> {
  const customFieldId = job.custom_field_id;

  if (!customFieldId) {
    await markApplyJobFailed(job.board_id, "Project manager custom field is missing.");
    return;
  }

  const chunk = job.updates.slice(
    job.next_update_index,
    job.next_update_index + APPLY_CHUNK_SIZE
  );

  if (chunk.length === 0) {
    await finishApplyJob(job.board_id);
    return;
  }

  const credentials = getTrelloCredentials();
  let updated = 0;
  let failed = 0;

  await runWithConcurrency(chunk, APPLY_CONCURRENCY, async (update) => {
    try {
      await retryRateLimited(async () => {
        if (update.value) {
          await setTrelloCardTextCustomField(
            {
              cardId: update.cardId,
              customFieldId,
              value: update.value,
            },
            credentials
          );
        } else if (update.currentValue !== null) {
          await clearTrelloCardCustomField(
            {
              cardId: update.cardId,
              customFieldId,
            },
            credentials
          );
        }
      });
      updated += 1;
    } catch (error) {
      failed += 1;
      console.log("project-manager-field apply failed", {
        boardId: job.board_id,
        cardId: update.cardId,
        error: getErrorMessage(error),
      });
    }
  });

  const nextUpdateIndex = job.next_update_index + chunk.length;
  const done = nextUpdateIndex >= job.updates.length;

  await getDbPool().query(
    `
      update project_manager_field_apply_jobs
      set updated = updated + $2,
          failed = failed + $3,
          next_update_index = $4,
          phase = case when $5 then 'done' else 'applying' end,
          done = $5,
          finished_at = case when $5 then now() else null end,
          updated_at = now()
      where board_id = $1
    `,
    [job.board_id, updated, failed, nextUpdateIndex, done]
  );
}

export async function applyProjectManagerFieldToCard(input: {
  boardId: string;
  card: TrelloCard;
}): Promise<boolean> {
  const credentials = getTrelloCredentials();
  const [customField, projects, labels] = await Promise.all([
    ensureProjectManagerCustomField(input.boardId, credentials),
    listActiveProjects(),
    listBoardProjectLabels(input.boardId),
  ]);
  const projectManagers = findCardProjectManagers(
    input.card,
    new Map(projects.map((item) => [item.id, item])),
    new Map(
      labels
        .filter((label) => label.syncStatus === "synced")
        .map((label) => [label.trelloLabelId, label.projectId])
    )
  );

  if (!projectManagers) {
    return false;
  }

  const value = formatProjectManagers(projectManagers);

  if (value) {
    await setTrelloCardTextCustomField(
      {
        cardId: input.card.id,
        customFieldId: customField.id,
        value,
      },
      credentials
    );
  } else {
    await clearTrelloCardCustomField(
      {
        cardId: input.card.id,
        customFieldId: customField.id,
      },
      credentials
    );
  }

  return true;
}

function findCardProjectManagers(
  card: TrelloCard,
  projectById: Map<string, ProjectSummary>,
  projectIdByLabelId: Map<string, string>
): ProjectManagerSummary[] | null {
  const managers: ProjectManagerSummary[] = [];
  const seenMemberIds = new Set<string>();
  let hasProject = false;

  for (const labelId of card.idLabels) {
    const projectId = projectIdByLabelId.get(labelId);
    const project = projectId ? projectById.get(projectId) : undefined;

    if (!project) {
      continue;
    }

    hasProject = true;

    for (const manager of project.projectManagers) {
      if (seenMemberIds.has(manager.trelloMemberId)) {
        continue;
      }

      seenMemberIds.add(manager.trelloMemberId);
      managers.push(manager);
    }
  }

  return hasProject ? managers : null;
}

function getCardTextCustomFieldValue(
  card: TrelloCard,
  customFieldId: string
): string | null {
  const item = card.customFieldItems?.find(
    (customFieldItem) => customFieldItem.idCustomField === customFieldId
  );
  const text = item?.value?.text;

  return typeof text === "string" ? text : null;
}

async function upsertApplyJob(input: {
  boardId: string;
  phase: ApplyPhase;
  totalCards: number;
  matchedCards: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  done: boolean;
  error: string | null;
  customFieldId: string | null;
  updates: StoredUpdate[];
  nextUpdateIndex: number;
  finishedAt: Date | null;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into project_manager_field_apply_jobs (
        board_id,
        phase,
        total_cards,
        matched_cards,
        updated,
        unchanged,
        skipped,
        failed,
        done,
        error,
        custom_field_id,
        updates,
        next_update_index,
        started_at,
        finished_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, now(), $14, now())
      on conflict (board_id) do update
      set phase = excluded.phase,
          total_cards = excluded.total_cards,
          matched_cards = excluded.matched_cards,
          updated = excluded.updated,
          unchanged = excluded.unchanged,
          skipped = excluded.skipped,
          failed = excluded.failed,
          done = excluded.done,
          error = excluded.error,
          custom_field_id = excluded.custom_field_id,
          updates = excluded.updates,
          next_update_index = excluded.next_update_index,
          started_at = now(),
          finished_at = excluded.finished_at,
          updated_at = now()
    `,
    [
      input.boardId,
      input.phase,
      input.totalCards,
      input.matchedCards,
      input.updated,
      input.unchanged,
      input.skipped,
      input.failed,
      input.done,
      input.error,
      input.customFieldId,
      JSON.stringify(input.updates),
      input.nextUpdateIndex,
      input.finishedAt,
    ]
  );
}

async function updateInitializedApplyJob(input: {
  boardId: string;
  customFieldId: string;
  totalCards: number;
  matchedCards: number;
  skipped: number;
  unchanged: number;
  updates: StoredUpdate[];
}): Promise<void> {
  const done = input.updates.length === 0;

  await getDbPool().query(
    `
      update project_manager_field_apply_jobs
      set phase = $2,
          total_cards = $3,
          matched_cards = $4,
          skipped = $5,
          unchanged = $6,
          custom_field_id = $7,
          updates = $8::jsonb,
          next_update_index = 0,
          done = $9,
          finished_at = case when $9 then now() else null end,
          updated_at = now()
      where board_id = $1
    `,
    [
      input.boardId,
      done ? "done" : "applying",
      input.totalCards,
      input.matchedCards,
      input.skipped,
      input.unchanged,
      input.customFieldId,
      JSON.stringify(input.updates),
      done,
    ]
  );
}

async function markApplyJobFailed(
  boardId: string,
  error: string
): Promise<void> {
  await getDbPool().query(
    `
      update project_manager_field_apply_jobs
      set phase = 'done',
          done = true,
          error = $2,
          finished_at = now(),
          updated_at = now()
      where board_id = $1
    `,
    [boardId, error]
  );
}

async function finishApplyJob(boardId: string): Promise<void> {
  await getDbPool().query(
    `
      update project_manager_field_apply_jobs
      set phase = 'done',
          done = true,
          finished_at = now(),
          updated_at = now()
      where board_id = $1
    `,
    [boardId]
  );
}

async function getStoredApplyJob(
  boardId: string
): Promise<ApplyJobRow | null> {
  const result = await getDbPool().query<ApplyJobRow>(
    `
      select
        board_id,
        phase,
        total_cards,
        matched_cards,
        updated,
        unchanged,
        skipped,
        failed,
        done,
        error,
        custom_field_id,
        updates,
        next_update_index,
        started_at,
        finished_at
      from project_manager_field_apply_jobs
      where board_id = $1
    `,
    [boardId]
  );

  return result.rows[0] ?? null;
}

function rowWithoutInternalFields(
  row: ApplyJobRow
): Omit<ApplyJobRow, "custom_field_id" | "updates" | "next_update_index"> {
  return row;
}

function mapApplyJob(
  row: Omit<ApplyJobRow, "custom_field_id" | "updates" | "next_update_index">
): ProjectManagerFieldApplyResult {
  return {
    boardId: row.board_id,
    phase: row.phase,
    totalCards: row.total_cards,
    matchedCards: row.matched_cards,
    updated: row.updated,
    unchanged: row.unchanged,
    skipped: row.skipped,
    failed: row.failed,
    done: row.done,
    error: row.error,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;

        if (item !== undefined) {
          await worker(item);
        }
      }
    })
  );
}

async function retryRateLimited(action: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      if (!(error instanceof TrelloApiError) || error.status !== 429) {
        throw error;
      }

      await sleep(1000 * (attempt + 1));
    }
  }

  await action();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
