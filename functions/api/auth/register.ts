import { createSession, createUser, enforceAuthRateLimit, validateCredentials } from "../../_lib/auth";
import { handleError, json, readJson, verifySameOrigin } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  try {
    const rejected = verifySameOrigin(context.request);
    if (rejected) return rejected;
    const limited = await enforceAuthRateLimit(context.env, context.request, "register", 5, 60);
    if (limited) return limited;
    const { email = "", password = "" } = await readJson<{ email?: string; password?: string }>(context.request);
    const error = validateCredentials(email, password);
    if (error) return json({ error }, 400);
    const user = await createUser(context.env, email, password);
    const cookie = await createSession(context.env, user.id, context.request);
    return json({ user }, 201, { "set-cookie": cookie });
  } catch (error) {
    if (error instanceof Error && error.message === "该邮箱已注册") return json({ error: error.message }, 409);
    return handleError(error);
  }
}
