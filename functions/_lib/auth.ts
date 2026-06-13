import { json } from "./http";
import type { Env } from "./types";

const SESSION_COOKIE = "jsyastro_session";
const SESSION_DAYS = 30;

export type AuthUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
};

type UserRow = {
  id: string;
  username: string;
  username_key: string;
  created_at: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function enforceAuthRateLimit(
  env: Env,
  request: Request,
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
    `INSERT INTO auth_rate_limits (key_hash, action, window_start, attempts, updated_at) VALUES (?, 'username-login', ?, 1, ?)
     ON CONFLICT(key_hash, action, window_start) DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at`,
  ).bind(keyHash, windowStart, now).run();
  const row = await env.DB.prepare(
    "SELECT attempts FROM auth_rate_limits WHERE key_hash = ? AND action = 'username-login' AND window_start = ?",
  ).bind(keyHash, windowStart).first<{ attempts: number }>();
  if ((row?.attempts ?? 0) > limit) {
    return json({ error: "尝试次数过多，请稍后再试" }, 429, { "retry-after": String(windowMinutes * 60) });
  }
  return null;
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function normalizeUsername(username: string): { display: string; key: string } {
  const display = username.trim().replace(/\s+/g, " ");
  return { display, key: display.toLocaleLowerCase("zh-CN") };
}

export function validateUsername(username: string): string | null {
  const { display } = normalizeUsername(username);
  if (display.length < 2 || display.length > 32) return "用户名长度需要为 2–32 个字符";
  if (/[\u0000-\u001f\u007f]/.test(display)) return "用户名包含无效字符";
  return null;
}

export async function loginOrCreateUser(
  env: Env,
  username: string,
  registrationCode: string,
): Promise<{ user: AuthUser; created: boolean }> {
  const { display, key } = normalizeUsername(username);
  let row = await env.DB.prepare("SELECT id, username, username_key, created_at FROM users WHERE username_key = ?")
    .bind(key).first<UserRow>();
  let created = false;
  const now = new Date().toISOString();

  if (!row) {
    if (!env.REGISTRATION_CODE || registrationCode !== env.REGISTRATION_CODE) {
      throw new Error("REGISTRATION_CODE_INVALID");
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, username, username_key, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, display, key, now, now).run();
    row = await env.DB.prepare("SELECT id, username, username_key, created_at FROM users WHERE username_key = ?")
      .bind(key).first<UserRow>();
    if (!row) throw new Error("无法创建用户");
    created = row.id === id;
    if (created) {
      await env.DB.prepare(
        "INSERT INTO user_documents (user_id, document_json, updated_at) VALUES (?, ?, ?)",
      ).bind(row.id, JSON.stringify({
        version: 1,
        cameraFields: [],
        cameraEntries: [],
        favoriteTargets: [],
        cameraCandidateTargets: [],
        mapState: null,
      }), now).run();
    }
  }

  await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, row.id).run();
  return {
    user: { id: row.id, username: row.username, isAdmin: isAdminUsername(env, row.username_key), createdAt: row.created_at },
    created,
  };
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
    `SELECT users.id, users.username, users.username_key, users.created_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  ).bind(hash, new Date().toISOString()).first<UserRow>();
  if (!row) return null;
  return { id: row.id, username: row.username, isAdmin: isAdminUsername(env, row.username_key), createdAt: row.created_at };
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

function isAdminUsername(env: Env, usernameKey: string): boolean {
  return Boolean(env.ADMIN_USERNAME && normalizeUsername(env.ADMIN_USERNAME).key === usernameKey);
}
