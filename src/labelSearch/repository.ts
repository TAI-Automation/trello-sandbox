import { getTrelloCredentials } from "../projectConfigurator/permissions.js";
import { listTrelloBoardLabels } from "../trello/api.js";
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
