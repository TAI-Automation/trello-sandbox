import type { ProjectManagerSummary } from "../../projectConfigurator/repository.js";

export function formatProjectManagers(
  projectManagers: ProjectManagerSummary[]
): string {
  return projectManagers
    .map((manager) => manager.displayName.trim())
    .filter((name) => name.length > 0)
    .join(", ");
}
