// Minimal typed fetch for our /api/v1 envelope, for client components.
export type ApiError = { code: string; message: string; details?: unknown };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
    if (res.ok && body && "data" in body) return { ok: true, data: body.data as T };
    return {
      ok: false,
      error: body?.error ?? { code: "INTERNAL", message: `Request failed (${res.status}). Please try again.` },
    };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "No connection. Check your internet and try again." } };
  }
}
