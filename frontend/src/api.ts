import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
  }
}

export interface RawResponse {
  status: number;
  etag: string | null;
  body: unknown;
}

function tokenStorage(): string | null {
  try {
    return localStorage.getItem("cairn.token");
  } catch {
    return null;
  }
}

export async function apiFetch(
  method: string,
  path: string,
  options: { body?: unknown; ifMatch?: string | null; auth?: boolean; raw?: boolean } = {},
): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.ifMatch) headers["if-match"] = options.ifMatch;
  if (options.auth !== false) {
    const token = tokenStorage();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const etag = res.headers.get("etag");
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: res.status, etag, body };
}

export async function api<T>(
  method: string,
  path: string,
  options: { body?: unknown; ifMatch?: string | null; auth?: boolean } = {},
): Promise<T> {
  const res = await apiFetch(method, path, options);
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const msg =
    (res.body && typeof res.body === "object" && "error" in res.body
      ? String((res.body as { error: unknown }).error)
      : null) ?? `HTTP ${res.status}`;
  throw new ApiError(msg, res.status, res.body);
}
