import { json } from "./http";
import type { Env } from "./types";

const SESSION_COOKIE = "jsyastro_session";
const SESSION_DAYS = 30;
// Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 iterations.
const PASSWORD_ITERATIONS = 100_000;

export type AuthUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  created_at: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = base64ToBytes(left);
  const b = base64ToBytes(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function enforceAuthRateLimit(
  env: Env,
  request: Request,
  action: "login" | "register",
  limit: number,
  windowMinutes: number,
): Promise<Response | null> {
  const address = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "local";
  const keyHash = await sha256(address);
  const windowMs = windowMinutes * 60_000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO auth_rate_limits (key_hash, action, window_start, attempts, updated_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(key_hash, action, window_start) DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at`,
  ).bind(keyHash, action, windowStart, now).run();
  const row = await env.DB.prepare(
    "SELECT attempts FROM auth_rate_limits WHERE key_hash = ? AND action = ? AND window_start = ?",
  ).bind(keyHash, action, windowStart).first<{ attempts: number }>();
  if ((row?.attempts ?? 0) > limit) {
    return json({ error: "尝试次数过多，请稍后再试" }, 429, { "retry-after": String(windowMinutes * 60) });
  }
  return null;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateCredentials(email: string, password: string): string | null {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) return "请输入有效邮箱";
  if (password.length < 10 || password.length > 128) return "密码长度需要为 10–128 个字符";
  return null;
}

export async function createUser(env: Env, email: string, password: string): Promise<AuthUser> {
  const normalized = normalizeEmail(email);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(normalized).first();
  if (existing) throw new Error("该邮箱已注册");

  const id = crypto.randomUUID();
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const passwordHash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, password_iterations, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, normalized, passwordHash, bytesToBase64(salt), PASSWORD_ITERATIONS, now, now),
    env.DB.prepare(
      "INSERT INTO user_documents (user_id, document_json, updated_at) VALUES (?, ?, ?)",
    ).bind(id, JSON.stringify({ version: 1, cameraFields: [], favoriteTargets: [], mapState: null }), now),
  ]);
  return { id, email: normalized, isAdmin: isAdminEmail(env, normalized), createdAt: now };
}

export async function verifyUser(env: Env, email: string, password: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(normalized).first<UserRow>();
  if (!row) return null;
  const hash = await derivePassword(password, base64ToBytes(row.password_salt), row.password_iterations);
  if (!constantTimeEqual(hash, row.password_hash)) return null;
  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  return { id: row.id, email: row.email, isAdmin: isAdminEmail(env, row.email), createdAt: row.created_at };
}

export async function createSession(env: Env, userId: string, request: Request): Promise<string> {
  const token = randomToken();
  const hash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(hash, userId, now.toISOString(), expires.toISOString()).run();
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export async function currentUser(env: Env, request: Request): Promise<AuthUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, users.created_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  ).bind(hash, new Date().toISOString()).first<{ id: string; email: string; created_at: string }>();
  if (!row) return null;
  return { id: row.id, email: row.email, isAdmin: isAdminEmail(env, row.email), createdAt: row.created_at };
}

export async function requireUser(env: Env, request: Request): Promise<AuthUser | Response> {
  const user = await currentUser(env, request);
  return user ?? json({ error: "请先登录" }, 401);
}

export async function deleteSession(env: Env, request: Request): Promise<void> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

function isAdminEmail(env: Env, email: string): boolean {
  return Boolean(env.ADMIN_EMAIL && normalizeEmail(env.ADMIN_EMAIL) === normalizeEmail(email));
}
