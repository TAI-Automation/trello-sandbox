import {
  createTrelloLabel,
  deleteTrelloLabel,
  listTrelloBoardLabels,
  type TrelloLabel,
  updateTrelloLabel,
} from "../trello/api.js";
import { getTrelloCredentials } from "./permissions.js";
import {
  listActiveProjects,
  listBoardProjectLabels,
  listLabelSyncBoards,
  markBoardProjectLabelError,
  markBoardProjectLabelSynced,
  type BoardProjectLabelSummary,
  type ManagedBoardSummary,
  type ProjectSummary,
} from "./repository.js";

export type ProjectLabelSyncResult = {
  attempted: number;
  synced: number;
  failed: number;
};

export async function syncAllProjectLabels(): Promise<ProjectLabelSyncResult> {
  const [boards, projects] = await Promise.all([
    listLabelSyncBoards(),
    listActiveProjects(),
  ]);

  let attempted = 0;
  let synced = 0;
  let failed = 0;

  for (const board of boards) {
    const result = await syncProjectLabelsForBoardWithProjects(board, projects);

    attempted += result.attempted;
    synced += result.synced;
    failed += result.failed;
  }

  return { attempted, synced, failed };
}

export async function syncProjectLabelsForBoard(
  board: ManagedBoardSummary
): Promise<ProjectLabelSyncResult> {
  const projects = await listActiveProjects();

  return syncProjectLabelsForBoardWithProjects(board, projects);
}

async function syncProjectLabelsForBoardWithProjects(
  board: ManagedBoardSummary,
  projects: ProjectSummary[]
): Promise<ProjectLabelSyncResult> {
  const credentials = getTrelloCredentials();
  const [trelloLabels, trackedLabels] = await Promise.all([
    listTrelloBoardLabels(board.trelloBoardId, credentials),
    listBoardProjectLabels(board.trelloBoardId),
  ]);
  const trackedLabelIds = new Set(
    trackedLabels
      .map((label) => label.trelloLabelId)
      .filter((labelId) => !labelId.startsWith("sync-error-"))
  );
  const deletedLabelIds = new Set<string>();

  for (const label of trelloLabels) {
    if (
      isProjectLabelName(label.name) &&
      !trackedLabelIds.has(label.id)
    ) {
      try {
        await deleteTrelloLabel(label.id, credentials);
        deletedLabelIds.add(label.id);
      } catch {
        // Continue syncing managed labels even if cleanup of one rogue label fails.
      }
    }
  }

  const remainingTrelloLabels = trelloLabels.filter(
    (label) => !deletedLabelIds.has(label.id)
  );
  const trelloLabelsById = new Map(
    remainingTrelloLabels.map((label) => [label.id, label])
  );
  const trackedLabelsByProjectId = new Map(
    trackedLabels.map((label) => [label.projectId, label])
  );
  let attempted = 0;
  let synced = 0;
  let failed = 0;

  for (const project of projects) {
    attempted += 1;

    try {
      await syncProjectLabel({
        board,
        project,
        trackedLabel: trackedLabelsByProjectId.get(project.id) ?? null,
        trelloLabelsById,
      });
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { attempted, synced, failed };
}

async function syncProjectLabel(input: {
  board: ManagedBoardSummary;
  project: ProjectSummary;
  trackedLabel: BoardProjectLabelSummary | null;
  trelloLabelsById: Map<string, TrelloLabel>;
}): Promise<void> {
  const credentials = getTrelloCredentials();
  const { board, project, trackedLabel, trelloLabelsById } = input;

  try {
    const existingLabelId =
      trackedLabel?.trelloLabelId &&
      !trackedLabel.trelloLabelId.startsWith("sync-error-")
        ? trackedLabel.trelloLabelId
        : "";
    const label = existingLabelId && trelloLabelsById.has(existingLabelId)
      ? await updateTrelloLabel(
          {
            labelId: existingLabelId,
            name: project.labelText,
            color: project.departmentColor,
          },
          credentials
        )
      : await createTrelloLabel(
          {
            boardId: board.trelloBoardId,
            name: project.labelText,
            color: project.departmentColor,
          },
          credentials
        );

    await markBoardProjectLabelSynced({
      trelloBoardId: board.trelloBoardId,
      projectId: project.id,
      trelloLabelId: label.id,
      syncedLabelText: project.labelText,
      syncedColor: project.departmentColor,
    });
  } catch (error) {
    await markBoardProjectLabelError({
      trelloBoardId: board.trelloBoardId,
      projectId: project.id,
      syncedLabelText: project.labelText,
      syncedColor: project.departmentColor,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

function isProjectLabelName(name: string): boolean {
  return /^[^:\n]+:\s*[^:\n]+$/.test(name.trim());
}
