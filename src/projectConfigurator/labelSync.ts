import {
  createTrelloLabel,
  listTrelloBoardLabels,
  type TrelloLabel,
  updateTrelloLabel,
} from "../trello/api.js";
import { getTrelloCredentials } from "./permissions.js";
import {
  getBoardProjectLabel,
  listActiveProjects,
  listLabelSyncBoards,
  markBoardProjectLabelError,
  markBoardProjectLabelSynced,
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
    for (const project of projects) {
      attempted += 1;

      try {
        await syncProjectLabel(board, project);
        synced += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { attempted, synced, failed };
}

export async function syncProjectLabelsForBoard(
  board: ManagedBoardSummary
): Promise<ProjectLabelSyncResult> {
  const projects = await listActiveProjects();
  let attempted = 0;
  let synced = 0;
  let failed = 0;

  for (const project of projects) {
    attempted += 1;

    try {
      await syncProjectLabel(board, project);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { attempted, synced, failed };
}

async function syncProjectLabel(
  board: ManagedBoardSummary,
  project: ProjectSummary
): Promise<void> {
  const credentials = getTrelloCredentials();
  const existing = await getBoardProjectLabel({
    trelloBoardId: board.trelloBoardId,
    projectId: project.id,
  });

  try {
    const existingLabelId =
      existing?.trelloLabelId &&
      !existing.trelloLabelId.startsWith("sync-error-")
        ? existing.trelloLabelId
        : "";
    const label = existingLabelId
      ? await updateTrelloLabel(
          {
            labelId: existingLabelId,
            name: project.labelText,
            color: project.departmentColor,
          },
          credentials
        )
      : await reuseOrCreateTrelloLabel(board, project, credentials);

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

async function reuseOrCreateTrelloLabel(
  board: ManagedBoardSummary,
  project: ProjectSummary,
  credentials: ReturnType<typeof getTrelloCredentials>
): Promise<TrelloLabel> {
  return (
    (await findReusableTrelloLabel(board, project, credentials)) ??
    (await createTrelloLabel(
      {
        boardId: board.trelloBoardId,
        name: project.labelText,
        color: project.departmentColor,
      },
      credentials
    ))
  );
}

async function findReusableTrelloLabel(
  board: ManagedBoardSummary,
  project: ProjectSummary,
  credentials: ReturnType<typeof getTrelloCredentials>
): Promise<TrelloLabel | null> {
  const labels = await listTrelloBoardLabels(board.trelloBoardId, credentials);
  const expectedName = project.labelText.trim().toLowerCase();
  const expectedColor = project.departmentColor.trim().toLowerCase();

  return (
    labels.find(
      (label) =>
        label.name.trim().toLowerCase() === expectedName &&
        String(label.color || "").trim().toLowerCase() === expectedColor
    ) ?? null
  );
}
