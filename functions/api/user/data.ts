import { requireUser } from "../../_lib/auth";
import { handleError, json, readJson, verifySameOrigin } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

const MAX_DOCUMENT_BYTES = 250_000;

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  try {
    const user = await requireUser(context.env, context.request);
    if (user instanceof Response) return user;
    const row = await context.env.DB.prepare("SELECT document_json, updated_at FROM user_documents WHERE user_id = ?")
      .bind(user.id).first<{ document_json: string; updated_at: string }>();
    return json({
      document: row ? JSON.parse(row.document_json) : {
        version: 1,
        cameraFields: [],
        cameraEntries: [],
        favoriteTargets: [],
        cameraCandidateTargets: [],
        mapState: null,
      },
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPut(context: FunctionContext): Promise<Response> {
  try {
    const rejected = verifySameOrigin(context.request);
    if (rejected) return rejected;
    const user = await requireUser(context.env, context.request);
    if (user instanceof Response) return user;
    const body = await readJson<{ document?: unknown }>(context.request);
    const documentJson = JSON.stringify(body.document);
    if (!body.document || documentJson.length > MAX_DOCUMENT_BYTES) return json({ error: "用户数据无效或过大" }, 400);
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO user_documents (user_id, document_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at`,
    ).bind(user.id, documentJson, now).run();
    return json({ ok: true, updatedAt: now });
  } catch (error) {
    return handleError(error);
  }
}
