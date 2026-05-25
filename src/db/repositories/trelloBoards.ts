export type TrelloBoardRecord = {
  trelloBoardId: string;
  boardName: string;
  enforcementEnabled: boolean;
  labelSyncEnabled: boolean;
  trelloWebhookId: string | null;
  webhookActive: boolean;
  lastLabelSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};
