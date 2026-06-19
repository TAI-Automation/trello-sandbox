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
  weakOnly: boolean;
};

const MAX_RESULTS = 20;

export function searchLabels(
  labels: TrelloLabel[],
  query: string
): LabelSearchResult[] {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return labels
      .slice(0, 8)
      .map((label) => mapResult(label, 0, "Start typing to search labels"));
  }

  const scored = labels
    .map((label) => scoreLabel(label, normalizedQuery))
    .filter((result) => result.score > 0)
    .sort(sortScoredLabels);
  const hasStrongMatches = scored.some((result) => !result.weakOnly);

  return scored
    .filter(
      (result) => !hasStrongMatches || !result.weakOnly || result.score >= 50
    )
    .slice(0, MAX_RESULTS)
    .map(
      ({ normalizedName: _normalizedName, weakOnly: _weakOnly, ...result }) =>
        result
    );
}

function sortScoredLabels(left: ScoredLabel, right: ScoredLabel): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.normalizedName.localeCompare(right.normalizedName);
}

function scoreLabel(label: TrelloLabel, normalizedQuery: string): ScoredLabel {
  const normalizedName = normalizeText(label.name);

  if (!normalizedName) {
    return {
      ...mapResult(label, 0, "Blank label name"),
      normalizedName,
      weakOnly: false,
    };
  }

  const labelTokens = tokenize(normalizedName);
  const queryTokens = tokenize(normalizedQuery);
  const querySingularTokens = queryTokens.map(singularize);
  const labelSingularTokens = labelTokens.map(singularize);

  // Full phrase equality is the strongest signal.
  if (normalizedName === normalizedQuery) {
    return buildScoredLabel(label, normalizedName, 100, "Exact full label match");
  }

  // Single-token searches should strongly prefer exact label words.
  if (hasExactTokenMatch(labelTokens, queryTokens)) {
    return buildScoredLabel(label, normalizedName, 90, "Exact token match");
  }

  // Singularized tokens let "errors" match "Error" and "controls" match "Control".
  if (hasExactTokenMatch(labelSingularTokens, querySingularTokens)) {
    return buildScoredLabel(
      label,
      normalizedName,
      85,
      "Plural/singular token match"
    );
  }

  // Prefix matching catches partial typing without requiring full words.
  if (normalizedName.startsWith(normalizedQuery)) {
    return buildScoredLabel(label, normalizedName, 80, "Starts with search");
  }

  const tokenPrefixScore = tokenPrefixMatch(labelTokens, queryTokens);

  if (tokenPrefixScore > 0) {
    return buildScoredLabel(
      label,
      normalizedName,
      tokenPrefixScore,
      "Token starts with search"
    );
  }

  // Phrase containment handles labels that include the typed phrase verbatim.
  if (normalizedName.includes(normalizedQuery)) {
    return buildScoredLabel(label, normalizedName, 75, "Phrase contains search");
  }

  // Word overlap is order-insensitive for searches like "drivers doc".
  const overlap = wordOverlap(labelSingularTokens, querySingularTokens);

  if (overlap > 0) {
    return buildScoredLabel(
      label,
      normalizedName,
      55 + Math.round(overlap * 15),
      "Word overlap"
    );
  }

  // Edit distance catches small typos and repeated-letter mistakes.
  if (hasTypoCloseTokenMatch(labelSingularTokens, querySingularTokens)) {
    return buildScoredLabel(label, normalizedName, 65, "Typo-close token match");
  }

  const similarity = characterSimilarity(normalizedName, normalizedQuery);

  // Weak character similarity is deliberately capped below token/typo matches.
  if (similarity >= 0.5) {
    return buildScoredLabel(
      label,
      normalizedName,
      Math.min(45, 20 + Math.round(similarity * 25)),
      "Weak character similarity",
      true
    );
  }

  return {
    ...mapResult(label, 0, "No match"),
    normalizedName,
    weakOnly: false,
  };
}

function buildScoredLabel(
  label: TrelloLabel,
  normalizedName: string,
  score: number,
  matchedReason: string,
  weakOnly = false
): ScoredLabel {
  return {
    ...mapResult(label, score, matchedReason),
    normalizedName,
    weakOnly,
  };
}

function hasExactTokenMatch(
  labelTokens: string[],
  queryTokens: string[]
): boolean {
  if (queryTokens.length === 0) {
    return false;
  }

  const labelTokenSet = new Set(labelTokens);

  return queryTokens.every((token) => labelTokenSet.has(token));
}

function tokenPrefixMatch(labelTokens: string[], queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const matchedCount = queryTokens.filter((queryToken) =>
    labelTokens.some(
      (labelToken) =>
        labelToken.startsWith(queryToken) || queryToken.startsWith(labelToken)
    )
  ).length;

  return matchedCount === queryTokens.length
    ? 80
    : matchedCount > 0
      ? 70
      : 0;
}

function hasTypoCloseTokenMatch(
  labelTokens: string[],
  queryTokens: string[]
): boolean {
  if (queryTokens.length === 0) {
    return false;
  }

  return queryTokens.every((queryToken) =>
    labelTokens.some((labelToken) => areTypoClose(labelToken, queryToken))
  );
}

function areTypoClose(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }

  const compactLeft = collapseRepeatedLetters(left);
  const compactRight = collapseRepeatedLetters(right);
  const shorterLength = Math.min(compactLeft.length, compactRight.length);
  const allowedDistance =
    shorterLength <= 4 ? 1 : shorterLength <= 8 ? 2 : 3;

  return editDistance(compactLeft, compactRight) <= allowedDistance;
}

function editDistance(left: string, right: string): number {
  const distances: number[] = Array.from(
    { length: right.length + 1 },
    (_value, index) => index
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = distances[0];
    distances[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const current = distances[rightIndex];
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      distances[rightIndex] = Math.min(
        distances[rightIndex] + 1,
        distances[rightIndex - 1] + 1,
        previous + substitutionCost
      );
      previous = current;
    }
  }

  return distances[right.length];
}

function collapseRepeatedLetters(value: string): string {
  return value.replace(/([a-z0-9])\1+/g, "$1");
}

function singularize(token: string): string {
  if (token.length <= 3 || !token.endsWith("s")) {
    return token;
  }

  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("ses") || token.endsWith("xes") || token.endsWith("zes")) {
    return token.slice(0, -2);
  }

  return token.slice(0, -1);
}

function tokenize(value: string): string[] {
  return normalizeText(value).split(" ").filter(Boolean);
}

function normalizeText(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlap(labelTokens: string[], queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const labelTokenSet = new Set(labelTokens);
  const matchedWords = queryTokens.filter((word) => labelTokenSet.has(word));

  return matchedWords.length / queryTokens.length;
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
