import { createSession, enforceAuthRateLimit, validateCredentials, verifyUser } from "../../_lib/auth";
import { handleError, json, readJson, verifySameOrigin } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  try {
    const rejected = verifySameOrigin(context.request);
    if (rejected) return rejected;
    const limited = await enforceAuthRateLimit(context.env, context.request, "login", 20, 15);
    if (limited) return limited;
    const { email = "", password = "" } = await readJson<{ email?: string; password?: string }>(context.request);
    const error = validateCredentials(email, password);
    if (error) return json({ error }, 400);
    const user = await verifyUser(context.env, email, password);
    if (!user) return json({ error: "邮箱或密码不正确" }, 401);
    const cookie = await createSession(context.env, user.id, context.request);
    return json({ user }, 200, { "set-cookie": cookie });
  } catch (error) {
    return handleError(error);
  }
}
