import type { AppConfig } from "../../config/env.js";
import type { LoadedMemberRestriction } from "../../core/permissions/store.js";
import { loadMemberRestriction } from "../../core/permissions/store.js";

export type CardMove = {
  sourceListId: string;
  sourceListName: string;
  destinationListId: string;
  destinationListName: string;
};

export type MoveRestriction = LoadedMemberRestriction & {
  direction: "out of" | "into";
  listId: string;
  listName: string;
};

export class PermissionRestrictionService {
  constructor(private readonly appConfig: AppConfig) {}

  async getMoveRestriction(
    memberId: string,
    move: CardMove,
    boardId: string
  ): Promise<MoveRestriction | null> {
    const memberRestrictions = await loadMemberRestriction(this.appConfig, memberId, [
      move.sourceListId,
      move.destinationListId,
    ], boardId);

    if (!memberRestrictions) {
      return null;
    }

    if (memberRestrictions.deniedListIds.has(move.sourceListId)) {
      return {
        ...memberRestrictions,
        direction: "out of",
        listId: move.sourceListId,
        listName: move.sourceListName,
      };
    }

    if (memberRestrictions.deniedListIds.has(move.destinationListId)) {
      return {
        ...memberRestrictions,
        direction: "into",
        listId: move.destinationListId,
        listName: move.destinationListName,
      };
    }

    return null;
  }
}
