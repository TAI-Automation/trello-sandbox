import { TrelloApiError } from "../trello/api.js";

type RetryOptions = {
  delays?: number[];
  isRetryable?: (error: unknown) => boolean;
};

export async function retryTrelloRequest<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const delays = options.delays ?? [700, 1500, 3000];
  const isRetryable = options.isRetryable ?? isRetryableTrelloError;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === delays.length || !isRetryable(error)) {
        throw error;
      }

      await sleep(delays[attempt] ?? 0);
    }
  }

  return operation();
}

export function isRetryableTrelloError(error: unknown): boolean {
  return (
    error instanceof TrelloApiError &&
    (error.status === 429 || (error.status >= 500 && error.status < 600))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
