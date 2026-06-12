import { clearSessionCookie, deleteSession } from "../../_lib/auth";
import { handleError, json, verifySameOrigin } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  try {
    const rejected = verifySameOrigin(context.request);
    if (rejected) return rejected;
    await deleteSession(context.env, context.request);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(context.request) });
  } catch (error) {
    return handleError(error);
  }
}
