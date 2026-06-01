import {
  listActiveProjects,
  listBoardProjectLabels,
  type ProjectSummary,
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

  job.totalCards = cards.length;

  for (const card of cards) {
    const project = findCardProject(card, projectById, projectIdByLabelId);

    if (!project) {
      job.skipped += 1;
      continue;
    }

    job.matchedCards += 1;

    try {
      const value = formatProjectManagers(project.projectManagers);

      await retryRateLimited(async () => {
        if (value) {
          await setTrelloCardTextCustomField(
            {
              cardId: card.id,
              customFieldId: customField.id,
              value,
            },
            credentials
          );
        } else {
          await clearTrelloCardCustomField(
            {
              cardId: card.id,
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
        cardId: card.id,
        error: getErrorMessage(error),
      });
    }

    await sleep(150);
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
  const project = findCardProject(
    input.card,
    new Map(projects.map((item) => [item.id, item])),
    new Map(
      labels
        .filter((label) => label.syncStatus === "synced")
        .map((label) => [label.trelloLabelId, label.projectId])
    )
  );

  if (!project) {
    return false;
  }

  const value = formatProjectManagers(project.projectManagers);

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

function findCardProject(
  card: TrelloCard,
  projectById: Map<string, ProjectSummary>,
  projectIdByLabelId: Map<string, string>
): ProjectSummary | null {
  for (const labelId of card.idLabels) {
    const projectId = projectIdByLabelId.get(labelId);
    const project = projectId ? projectById.get(projectId) : undefined;

    if (project) {
      return project;
    }
  }

  return null;
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
