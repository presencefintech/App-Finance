export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Appel JSON vers /api/v1. Lève ApiError avec le code métier renvoyé par handler(). */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const method = init.method ?? 'GET';
  // Une clé par action utilisateur : un double clic ou une coupure réseau ne dupliquent jamais une opération.
  if (method !== 'GET' && !headers['Idempotency-Key']) headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null;
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? 'Erreur inattendue', res.status);
  }
  return data as T;
}
