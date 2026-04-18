import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { JwtClaims, UserRecord, UserRole } from "@cairn/types";
import { env, S3_KEYS } from "./env.js";
import { getObjectText, putObjectText } from "./s3.js";

const encoder = new TextEncoder();

async function secretKey(): Promise<Uint8Array> {
  return encoder.encode(env.JWT_SECRET);
}

export async function loadUsers(): Promise<{ users: UserRecord[]; etag: string | null }> {
  const obj = await getObjectText(S3_KEYS.users);
  if (!obj) return { users: [], etag: null };
  const parsed = JSON.parse(obj.body) as UserRecord[];
  return { users: parsed, etag: obj.etag };
}

export async function saveUsers(users: UserRecord[]): Promise<void> {
  await putObjectText(S3_KEYS.users, JSON.stringify(users, null, 2));
}

export async function findUser(email: string): Promise<UserRecord | undefined> {
  const { users } = await loadUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function issueToken(user: UserRecord): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.email)
    .setIssuedAt(now)
    .setExpirationTime(now + env.JWT_TTL_SECONDS)
    .sign(await secretKey());
}

export async function verifyToken(token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, await secretKey());
  const role = payload.role as UserRole;
  if (!payload.sub || !payload.email || !role) throw new Error("invalid token claims");
  return {
    sub: payload.sub,
    email: payload.email as string,
    role,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
}

export function authHeader(headers: Record<string, string | undefined>): string | null {
  const raw = headers["authorization"] ?? headers["Authorization"];
  if (!raw) return null;
  const [scheme, value] = raw.split(" ");
  if (scheme !== "Bearer" || !value) return null;
  return value;
}
