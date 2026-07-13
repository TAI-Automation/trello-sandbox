import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import {
  addLabelToCard,
  listTrelloBoardLabels,
} from "../trello/api.js";
import { searchLabels, type LabelSearchResult } from "./fuzzy.js";

export async function searchBoardLabels(input: {
  boardId: string;
  query: string;
}): Promise<LabelSearchResult[]> {
  const labels = await listTrelloBoardLabels(
    input.boardId,
    getTrelloCredentials()
  );

  return searchLabels(labels, input.query);
}

export async function applyBoardLabelToCard(input: {
  cardId: string;
  boardId: string;
  trelloLabelId: string;
}): Promise<void> {
  const credentials = getTrelloCredentials();
  const labels = await listTrelloBoardLabels(input.boardId, credentials);
  const labelExistsOnBoard = labels.some(
    (label) => label.id === input.trelloLabelId
  );

  if (!labelExistsOnBoard) {
    throw new LabelNotFoundOnBoardError();
  }

  await addLabelToCard(input.cardId, input.trelloLabelId, credentials);
}

class LabelNotFoundOnBoardError extends Error {
  status = 404;

  constructor() {
    super("The requested Trello label was not found on this board.");
  }
}
