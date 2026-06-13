import { requireUser } from "../../_lib/auth";
import { handleError, json } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

type UserDataRow = {
  id: string;
  username: string;
  created_at: string;
  last_login_at: string | null;
  document_json: string | null;
  updated_at: string | null;
};

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  try {
    const user = await requireUser(context.env, context.request);
    if (user instanceof Response) return user;
    if (!user.isAdmin) return json({ error: "无管理员权限" }, 403);

    const result = await context.env.DB.prepare(
      `SELECT users.id, users.username, users.created_at, users.last_login_at,
              user_documents.document_json, user_documents.updated_at
       FROM users
       LEFT JOIN user_documents ON user_documents.user_id = users.id
       ORDER BY users.created_at ASC
       LIMIT 500`,
    ).all<UserDataRow>();

    const users = (result.results ?? []).map((row) => {
      let document: unknown = null;
      try {
        document = row.document_json ? JSON.parse(row.document_json) : null;
      } catch {
        document = { error: "用户数据 JSON 无法解析" };
      }
      return {
        id: row.id,
        username: row.username,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        updatedAt: row.updated_at,
        document,
      };
    });

    return json({ users });
  } catch (error) {
    return handleError(error);
  }
}
