export type DepartmentRecord = {
  id: string;
  name: string;
  nameNormalized: string;
  labelText: string;
  departmentColor: string;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
