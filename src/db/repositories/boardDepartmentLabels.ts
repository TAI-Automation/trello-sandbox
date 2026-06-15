export type BoardDepartmentLabelSyncStatus = "pending" | "synced" | "error";

export type BoardDepartmentLabelRecord = {
  trelloBoardId: string;
  departmentId: string;
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
  syncStatus: BoardDepartmentLabelSyncStatus;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};
