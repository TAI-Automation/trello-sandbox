const RECENT_REVERSAL_TTL_MS = 60_000;

type RecentReversal = {
  targetListId: string;
  expiresAt: number;
};

const recentReversals = new Map<string, RecentReversal>();

export function rememberReversal(cardId: string, targetListId: string): void {
  recentReversals.set(cardId, {
    targetListId,
    expiresAt: Date.now() + RECENT_REVERSAL_TTL_MS,
  });
}

export function shouldIgnoreRecentReversal(
  cardId: string,
  currentListId: string
): boolean {
  const recentReversal = recentReversals.get(cardId);

  if (!recentReversal) {
    return false;
  }

  if (Date.now() > recentReversal.expiresAt) {
    recentReversals.delete(cardId);
    return false;
  }

  if (recentReversal.targetListId !== currentListId) {
    return false;
  }

  recentReversals.delete(cardId);
  return true;
}
