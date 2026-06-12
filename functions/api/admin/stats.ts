import { requireUser } from "../../_lib/auth";
import { handleError, json } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  try {
    const user = await requireUser(context.env, context.request);
    if (user instanceof Response) return user;
    if (!user.isAdmin) return json({ error: "无管理员权限" }, 403);
    const now = new Date().toISOString();
    const [users, sessions] = await Promise.all([
      context.env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
      context.env.DB.prepare("SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?").bind(now).first<{ count: number }>(),
    ]);
    return json({ totalUsers: users?.count ?? 0, activeSessions: sessions?.count ?? 0 });
  } catch (error) {
    return handleError(error);
  }
}
