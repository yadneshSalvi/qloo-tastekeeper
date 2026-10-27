/** Server-only HTTP boundary shared by the two provider adapters. */
export class ProviderResponseError extends Error {
  constructor() {
    super('The provider returned an invalid or oversized response.');
    this.name = 'ProviderResponseError';
  }
}

/** Bound even injected transports which do not honor AbortSignal themselves. */
export async function withinDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The operation may already have rejected synchronously before this call.
    // Consume that rejection even though the cancellation wins the race.
    void operation.catch(() => undefined);
    signal.throwIfAborted();
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

/** Neither response text nor JSON parse errors are allowed outside this boundary. */
export async function readProviderJson(
  response: Response,
  signal: AbortSignal,
  maxBytes = 131072,
): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    discardProviderBody(response);
    throw new ProviderResponseError();
  }
  if (!response.body) throw new ProviderResponseError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await withinDeadline(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ProviderResponseError();
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new ProviderResponseError();
    }
  } finally {
    // A broken stream's cancellation hook must not extend the workflow deadline.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function discardProviderBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}
