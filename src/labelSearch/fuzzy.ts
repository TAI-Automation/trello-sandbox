import type { TrelloLabel } from "../trello/api.js";

export type LabelSearchResult = {
  trelloLabelId: string;
  name: string;
  color: string;
  score: number;
  matchedReason: string;
};

type ScoredLabel = LabelSearchResult & {
  normalizedName: string;
};

const MAX_RESULTS = 20;

export function searchLabels(
  labels: TrelloLabel[],
  query: string
): LabelSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return labels
      .slice(0, 8)
      .map((label) => mapResult(label, 0, "Start typing to search labels"));
  }

  return labels
    .map((label) => scoreLabel(label, normalizedQuery))
    .filter((result) => result.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.normalizedName.localeCompare(right.normalizedName);
    })
    .slice(0, MAX_RESULTS)
    .map(({ normalizedName: _normalizedName, ...result }) => result);
}

function scoreLabel(label: TrelloLabel, normalizedQuery: string): ScoredLabel {
  const normalizedName = normalizeSearchText(label.name);

  if (!normalizedName) {
    return { ...mapResult(label, 0, "Blank label name"), normalizedName };
  }

  if (normalizedName === normalizedQuery) {
    return { ...mapResult(label, 100, "Exact match"), normalizedName };
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return { ...mapResult(label, 90, "Starts with search"), normalizedName };
  }

  if (normalizedName.includes(normalizedQuery)) {
    return { ...mapResult(label, 75, "Contains search"), normalizedName };
  }

  const overlap = wordOverlap(normalizedName, normalizedQuery);

  if (overlap > 0) {
    return {
      ...mapResult(label, 55 + Math.round(overlap * 15), "Word overlap"),
      normalizedName,
    };
  }

  const similarity = characterSimilarity(normalizedName, normalizedQuery);

  if (similarity >= 0.35) {
    return {
      ...mapResult(
        label,
        20 + Math.round(similarity * 25),
        "Character similarity"
      ),
      normalizedName,
    };
  }

  return { ...mapResult(label, 0, "No match"), normalizedName };
}

function mapResult(
  label: TrelloLabel,
  score: number,
  matchedReason: string
): LabelSearchResult {
  return {
    trelloLabelId: label.id,
    name: typeof label.name === "string" ? label.name : "",
    color: typeof label.color === "string" ? label.color : "",
    score,
    matchedReason,
  };
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function wordOverlap(name: string, query: string): number {
  const nameWords = new Set(splitWords(name));
  const queryWords = splitWords(query);

  if (queryWords.length === 0) {
    return 0;
  }

  const matchedWords = queryWords.filter((word) => nameWords.has(word));

  return matchedWords.length / queryWords.length;
}

function splitWords(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter(Boolean);
}

function characterSimilarity(name: string, query: string): number {
  const nameChars = new Set(name.replace(/\s+/g, ""));
  const queryChars = Array.from(new Set(query.replace(/\s+/g, "")));

  if (queryChars.length === 0) {
    return 0;
  }

  const matchedChars = queryChars.filter((char) => nameChars.has(char));

  return matchedChars.length / queryChars.length;
}
