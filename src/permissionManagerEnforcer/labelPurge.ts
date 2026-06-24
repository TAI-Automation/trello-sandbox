import {
  deleteTrelloLabel,
  listTrelloBoardLabels,
} from "../trello/api.js";
import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import { retryTrelloRequest } from "../shared/trelloRetry.js";
import {
  listActiveDepartments,
  listActiveProjects,
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
      await retryTrelloRequest(() =>
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
  const [
    trelloLabels,
    projectLabels,
    departmentLabels,
    activeProjects,
    activeDepartments,
  ] = await Promise.all([
    listTrelloBoardLabels(trelloBoardId, getTrelloCredentials()),
    listBoardProjectLabels(trelloBoardId),
    listBoardDepartmentLabels(trelloBoardId),
    listActiveProjects(),
    listActiveDepartments(),
  ]);
  const configuredLabelsByKey = new Map<
    string,
    { name: string; color: string }
  >();
  const preferredLabelIdsByKey = new Map<string, string>();
  const trelloLabelsById = new Map(
    trelloLabels.map((label) => [label.id, label])
  );

  for (const project of activeProjects) {
    configuredLabelsByKey.set(
      labelKey(project.labelText, project.projectColor),
      {
        name: project.labelText,
        color: project.projectColor,
      }
    );
  }

  for (const department of activeDepartments) {
    configuredLabelsByKey.set(
      labelKey(department.labelText, department.departmentColor),
      {
        name: department.labelText,
        color: department.departmentColor,
      }
    );
  }

  for (const label of [...projectLabels, ...departmentLabels]) {
    const key = labelKey(label.syncedLabelText, label.syncedColor);

    if (
      configuredLabelsByKey.has(key) &&
      !label.trelloLabelId.startsWith("sync-error-")
    ) {
      preferredLabelIdsByKey.set(key, label.trelloLabelId);
    }
  }

  const preservedLabelIds = new Set<string>();

  for (const [key, configuredLabel] of configuredLabelsByKey) {
    const preferredLabel = trelloLabelsById.get(
      preferredLabelIdsByKey.get(key) ?? ""
    );
    const label =
      preferredLabel &&
      preferredLabel.name === configuredLabel.name &&
      preferredLabel.color === configuredLabel.color
        ? preferredLabel
        : trelloLabels.find(
            (trelloLabel) =>
              !preservedLabelIds.has(trelloLabel.id) &&
              trelloLabel.name === configuredLabel.name &&
              trelloLabel.color === configuredLabel.color
          );

    if (label) {
      preservedLabelIds.add(label.id);
    }
  }

  return { trelloLabels, preservedLabelIds };
}

function labelKey(name: string, color: string): string {
  return `${name}\u0000${color}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
