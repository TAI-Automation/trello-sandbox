export type MemberRecord = {
  trelloMemberId: string;
  displayName: string;
  username: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
