export type BoardProjectLabelSyncStatus = "pending" | "synced" | "error";

export type BoardProjectLabelRecord = {
  trelloBoardId: string;
  projectId: string;
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
  syncStatus: BoardProjectLabelSyncStatus;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};
