import type {
  LoadedMemberRestriction,
  PermissionsState,
} from "../../core/permissions/store.js";
import {
  getFileMtimeMs,
  loadPermissionsState,
} from "../../core/permissions/store.js";

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
  private permissionsState: PermissionsState;

  constructor(private readonly permissionsPath: string) {
    this.permissionsState = loadPermissionsState(permissionsPath);
  }

  getMoveRestriction(memberId: string, move: CardMove): MoveRestriction | null {
    const permissions = this.getCurrentPermissions();
    const memberRestrictions = permissions.get(memberId);

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

  reload(): void {
    this.permissionsState = loadPermissionsState(this.permissionsPath);
  }

  private getCurrentPermissions(): PermissionsState["permissions"] {
    const currentMtimeMs = getFileMtimeMs(this.permissionsPath);

    if (currentMtimeMs !== this.permissionsState.mtimeMs) {
      this.reload();
    }

    return this.permissionsState.permissions;
  }
}
