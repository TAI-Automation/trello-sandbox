export type LabelPriorityColor = "blue" | "green" | "yellow" | "orange" | "red";

export const labelPriorityConfig = {
  badgeRefreshSeconds: 1800,
  archivedCleanupAfterDays: 30,
};

export function priorityColor(priority: number): LabelPriorityColor {
  if (priority >= 9) {
    return "red";
  }

  if (priority >= 7) {
    return "orange";
  }

  if (priority >= 5) {
    return "yellow";
  }

  if (priority >= 3) {
    return "green";
  }

  return "blue";
}
