import {
  deleteTrelloLabel,
  listTrelloBoardLabels,
  TrelloApiError,
} from "../trello/api.js";
import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import {
  listBoardDepartmentLabels,
  listBoardProjectLabels,
} from "../projectConfigurator/repository.js";

export type LegacyLabelPurgePreview = {
  totalLabels: number;
  preserved: number;
  purgeable: number;
};

export type LegacyLabelPurgeResult = LegacyLabelPurgePreview & {
  deleted: number;
  failed: number;
};

export async function previewLegacyLabelPurge(
  trelloBoardId: string
): Promise<LegacyLabelPurgePreview> {
  const { trelloLabels, preservedLabelIds } =
    await getLegacyLabelPurgeContext(trelloBoardId);
  const purgeable = trelloLabels.filter(
    (label) => !preservedLabelIds.has(label.id)
  ).length;

  return {
    totalLabels: trelloLabels.length,
    preserved: trelloLabels.length - purgeable,
    purgeable,
  };
}

export async function purgeLegacyLabels(
  trelloBoardId: string
): Promise<LegacyLabelPurgeResult> {
  const { trelloLabels, preservedLabelIds } =
    await getLegacyLabelPurgeContext(trelloBoardId);
  const purgeableLabels = trelloLabels.filter(
    (label) => !preservedLabelIds.has(label.id)
  );
  let deleted = 0;
  let failed = 0;

  for (const label of purgeableLabels) {
    try {
      await withTrelloRetry(() =>
        deleteTrelloLabel(label.id, getTrelloCredentials())
      );
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.log("permission-manager-enforcer legacy label purge failed", {
        trelloBoardId,
        trelloLabelId: label.id,
        labelName: label.name,
        error: getErrorMessage(error),
      });
    }

    await delay(250);
  }

  return {
    totalLabels: trelloLabels.length,
    preserved: trelloLabels.length - purgeableLabels.length,
    purgeable: purgeableLabels.length,
    deleted,
    failed,
  };
}

async function getLegacyLabelPurgeContext(trelloBoardId: string) {
  const [trelloLabels, projectLabels, departmentLabels] = await Promise.all([
    listTrelloBoardLabels(trelloBoardId, getTrelloCredentials()),
    listBoardProjectLabels(trelloBoardId),
    listBoardDepartmentLabels(trelloBoardId),
  ]);
  const preservedLabelIds = new Set(
    [...projectLabels, ...departmentLabels]
      .map((label) => label.trelloLabelId)
      .filter((labelId) => !labelId.startsWith("sync-error-"))
  );

  return { trelloLabels, preservedLabelIds };
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
