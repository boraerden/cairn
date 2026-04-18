import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyHandlerV2,
} from "aws-lambda";
import type { CairnFeatureCollection, UserRecord, UserRole } from "@cairn/types";

type Result = APIGatewayProxyStructuredResultV2;
import {
  authHeader,
  findUser,
  hashPassword,
  issueToken,
  loadUsers,
  saveUsers,
  verifyPassword,
  verifyToken,
} from "./auth.js";
import { readMapDoc, writeMapDoc } from "./map-doc.js";
import { presignRead, presignUpload, type PresignRequest } from "./media.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,if-match",
  "access-control-expose-headers": "etag",
};

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Result {
  return {
    statusCode: status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function text(status: number, body: string, extraHeaders: Record<string, string> = {}): Result {
  return { statusCode: status, headers: { ...CORS, "content-type": "text/plain", ...extraHeaders }, body };
}

function parseBody<T>(event: APIGatewayProxyEventV2): T {
  if (!event.body) return {} as T;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  return JSON.parse(raw) as T;
}

interface AuthPrincipal {
  email: string;
  role: UserRole;
}

function isResult(x: AuthPrincipal | Result): x is Result {
  return "statusCode" in x;
}

async function requireAuth(event: APIGatewayProxyEventV2, roles?: UserRole[]): Promise<AuthPrincipal | Result> {
  const token = authHeader((event.headers ?? {}) as Record<string, string | undefined>);
  if (!token) return json(401, { error: "missing Authorization header" });
  try {
    const claims = await verifyToken(token);
    if (roles && !roles.includes(claims.role)) return json(403, { error: "forbidden" });
    return { email: claims.email, role: claims.role };
  } catch {
    return json(401, { error: "invalid token" });
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") return text(204, "", CORS);

  try {
    if (method === "POST" && path === "/login") return await handleLogin(event);

    if (method === "GET" && path === "/map") return await handleGetMap(event);
    if (method === "PUT" && path === "/map") return await handlePutMap(event);

    if (method === "POST" && path === "/media/presign") return await handlePresign(event);
    if (method === "GET" && path.startsWith("/media/")) return await handleMediaGet(event, path);

    if (method === "GET" && path === "/admin/users") return await handleAdminList(event);
    if (method === "POST" && path === "/admin/users") return await handleAdminCreate(event);
    if (method === "DELETE" && path.startsWith("/admin/users/")) return await handleAdminDelete(event, path);

    return json(404, { error: "not found", path, method });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("handler error", err);
    return json(500, { error: message });
  }
};

async function handleLogin(event: APIGatewayProxyEventV2): Promise<Result> {
  const { email, password } = parseBody<{ email?: string; password?: string }>(event);
  if (!email || !password) return json(400, { error: "email and password required" });
  const user = await findUser(email);
  if (!user) return json(401, { error: "invalid credentials" });
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return json(401, { error: "invalid credentials" });
  const token = await issueToken(user);
  return json(200, { token, role: user.role, email: user.email });
}

async function handleGetMap(event: APIGatewayProxyEventV2): Promise<Result> {
  const auth = await requireAuth(event);
  if (isResult(auth)) return auth;
  const { collection, etag } = await readMapDoc();
  const headers: Record<string, string> = etag ? { etag } : {};
  return json(200, collection, headers);
}

async function handlePutMap(event: APIGatewayProxyEventV2): Promise<Result> {
  const auth = await requireAuth(event);
  if (isResult(auth)) return auth;
  const ifMatch = (event.headers?.["if-match"] ?? event.headers?.["If-Match"] ?? null) as string | null;
  const body = parseBody<CairnFeatureCollection>(event);
  if (body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    return json(400, { error: "body must be a FeatureCollection" });
  }
  const result = await writeMapDoc(body, ifMatch ? ifMatch.replace(/"/g, "") : null);
  if (result.conflict) {
    return json(409, { error: "conflict", current: result.current?.collection }, { etag: result.current?.etag ?? "" });
  }
  return json(200, { ok: true }, { etag: result.etag });
}

async function handlePresign(event: APIGatewayProxyEventV2): Promise<Result> {
  const auth = await requireAuth(event);
  if (isResult(auth)) return auth;
  const req = parseBody<PresignRequest>(event);
  try {
    const res = await presignUpload(req);
    return json(200, res);
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleMediaGet(event: APIGatewayProxyEventV2, path: string): Promise<Result> {
  const auth = await requireAuth(event);
  if (isResult(auth)) return auth;
  const key = decodeURIComponent(path.slice("/media/".length));
  try {
    const url = await presignRead(key);
    return json(200, { url });
  } catch (err) {
    return json(400, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAdminList(event: APIGatewayProxyEventV2): Promise<Result> {
  const auth = await requireAuth(event, ["admin"]);
  if (isResult(auth)) return auth;
  const { users } = await loadUsers();
  return json(
    200,
    users.map((u) => ({ email: u.email, role: u.role, createdAt: u.createdAt })),
  );
}

async function handleAdminCreate(event: APIGatewayProxyEventV2): Promise<Result> {
  const auth = await requireAuth(event, ["admin"]);
  if (isResult(auth)) return auth;
  const { email, password, role } = parseBody<{ email?: string; password?: string; role?: UserRole }>(event);
  if (!email || !password) return json(400, { error: "email and password required" });
  const finalRole: UserRole = role === "admin" ? "admin" : "editor";
  const { users } = await loadUsers();
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return json(409, { error: "user already exists" });
  }
  const passwordHash = await hashPassword(password);
  const record: UserRecord = {
    email,
    passwordHash,
    role: finalRole,
    createdAt: new Date().toISOString(),
  };
  await saveUsers([...users, record]);
  return json(201, { email: record.email, role: record.role, createdAt: record.createdAt });
}

async function handleAdminDelete(event: APIGatewayProxyEventV2, path: string): Promise<Result> {
  const auth = await requireAuth(event, ["admin"]);
  if (isResult(auth)) return auth;
  const email = decodeURIComponent(path.slice("/admin/users/".length));
  if (auth.email.toLowerCase() === email.toLowerCase()) {
    return json(400, { error: "cannot delete your own account" });
  }
  const { users } = await loadUsers();
  const next = users.filter((u) => u.email.toLowerCase() !== email.toLowerCase());
  if (next.length === users.length) return json(404, { error: "user not found" });
  await saveUsers(next);
  return json(200, { ok: true });
}
