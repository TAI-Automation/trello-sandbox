export type ProjectRecord = {
  id: string;
  departmentId: string;
  name: string;
  nameNormalized: string;
  labelText: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
