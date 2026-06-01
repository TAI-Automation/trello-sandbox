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

type MutableApplyResult = ProjectManagerFieldApplyResult;

const jobs = new Map<string, MutableApplyResult>();

export function getProjectManagerFieldApplyJob(
  boardId: string
): ProjectManagerFieldApplyResult | null {
  return jobs.get(boardId) ?? null;
}

export function startProjectManagerFieldApplyJob(
  boardId: string
): ProjectManagerFieldApplyResult {
  const existing = jobs.get(boardId);

  if (existing && !existing.done) {
    return existing;
  }

  const job: MutableApplyResult = {
    boardId,
    totalCards: 0,
    matchedCards: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    done: false,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  jobs.set(boardId, job);
  void applyProjectManagerFields(boardId, job).catch((error: unknown) => {
    job.error = getErrorMessage(error);
    job.done = true;
    job.finishedAt = new Date().toISOString();
  });

  return job;
}

async function applyProjectManagerFields(
  boardId: string,
  job: MutableApplyResult
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
  const updates = cards.flatMap((card) => {
    const projectManagers = findCardProjectManagers(
      card,
      projectById,
      projectIdByLabelId
    );

    return projectManagers
      ? [
          {
            card,
            value: formatProjectManagers(projectManagers),
          },
        ]
      : [];
  });

  job.totalCards = cards.length;
  job.matchedCards = updates.length;
  job.skipped = cards.length - updates.length;

  for (const update of updates) {
    try {
      const currentValue = getCardTextCustomFieldValue(
        update.card,
        customField.id
      );

      if (currentValue === update.value || (!currentValue && !update.value)) {
        job.unchanged += 1;
        continue;
      }

      await retryRateLimited(async () => {
        if (update.value) {
          await setTrelloCardTextCustomField(
            {
              cardId: update.card.id,
              customFieldId: customField.id,
              value: update.value,
            },
            credentials
          );
        } else if (currentValue !== null) {
          await clearTrelloCardCustomField(
            {
              cardId: update.card.id,
              customFieldId: customField.id,
            },
            credentials
          );
        }
      });
      job.updated += 1;
    } catch (error) {
      job.failed += 1;
      console.log("project-manager-field apply failed", {
        boardId,
        cardId: update.card.id,
        error: getErrorMessage(error),
      });
    }

    await sleep(50);
  }

  job.done = true;
  job.finishedAt = new Date().toISOString();
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
