import express from "express";

import {
  listActiveProjects,
  listBoardProjectLabels,
  type BoardProjectLabelSummary,
  type ProjectSummary,
} from "../projectConfigurator/repository.js";
import {
  getTrelloCredentials,
  resolveProjectConfiguratorViewer,
  type ProjectConfiguratorViewer,
} from "../projectConfigurator/permissions.js";
import {
  createTrelloCard,
  fetchTrelloBoardLists,
  type TrelloCard,
  type TrelloList,
} from "../trello/api.js";

export const createCardRouter = express.Router();

type CreateCardProject = ProjectSummary & {
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
};

type CreateCardState = {
  viewer: ProjectConfiguratorViewer;
  projects: CreateCardProject[];
  lists: TrelloList[];
};

createCardRouter.post("/api/create-card/state", async (req, res, next) => {
  try {
    const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
    const trelloBoardId = readRequiredString(req.body, "trelloBoardId");
    const state = await getCreateCardState({
      trelloMemberId,
      trelloBoardId,
    });

    res.json(state);
  } catch (error) {
    next(error);
  }
});

createCardRouter.post("/api/create-card/cards", async (req, res, next) => {
  try {
    const trelloMemberId = readRequiredString(req.body, "trelloMemberId");
    const trelloBoardId = readRequiredString(req.body, "trelloBoardId");
    const listId = readRequiredString(req.body, "listId");
    const projectId = readRequiredString(req.body, "projectId");
    const name = readRequiredString(req.body, "name");

    if (name.length > 16384) {
      throw new BadRequestError("name is too long.");
    }

    const state = await getCreateCardState({
      trelloMemberId,
      trelloBoardId,
    });
    const list = state.lists.find((item) => item.id === listId);

    if (!list) {
      throw new BadRequestError(
        "The selected starting list is not available on this board."
      );
    }

    const project = state.projects.find((item) => item.id === projectId);

    if (!project) {
      throw new BadRequestError(
        "The selected project does not have a synced label on this board."
      );
    }

    const card = await createTrelloCard(
      {
        listId: list.id,
        name,
        labelIds: [project.trelloLabelId],
      },
      getTrelloCredentials()
    );

    res.status(201).json({
      card: mapCreatedCard(card),
      project,
      list,
    });
  } catch (error) {
    next(error);
  }
});

async function getCreateCardState(input: {
  trelloMemberId: string;
  trelloBoardId: string;
}): Promise<CreateCardState> {
  const [viewer, projects, boardLabels, lists] = await Promise.all([
    resolveProjectConfiguratorViewer(input.trelloMemberId),
    listActiveProjects(),
    listBoardProjectLabels(input.trelloBoardId),
    fetchTrelloBoardLists(input.trelloBoardId, getTrelloCredentials()),
  ]);
  const projectLabelByProjectId = new Map(
    boardLabels
      .filter((label) => label.syncStatus === "synced")
      .map((label) => [label.projectId, label])
  );
  const syncedProjects = projects.flatMap((project) => {
    const label = projectLabelByProjectId.get(project.id);

    return label ? [mapCreateCardProject(project, label)] : [];
  });

  return {
    viewer,
    projects: syncedProjects,
    lists,
  };
}

function mapCreateCardProject(
  project: ProjectSummary,
  label: BoardProjectLabelSummary
): CreateCardProject {
  return {
    ...project,
    trelloLabelId: label.trelloLabelId,
    syncedLabelText: label.syncedLabelText,
    syncedColor: label.syncedColor,
  };
}

function mapCreatedCard(card: TrelloCard) {
  return {
    id: card.id,
    idBoard: card.idBoard,
    idList: card.idList,
    idLabels: card.idLabels,
    name: card.name ?? "",
    url: card.url ?? "",
  };
}

function readRequiredString(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`${key} must be a non-empty string.`);
  }

  return value.trim();
}

class BadRequestError extends Error {
  status = 400;
}
