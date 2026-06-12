import { createSession, enforceAuthRateLimit, loginOrCreateUser, validateUsername } from "../../_lib/auth";
import { handleError, json, readJson, verifySameOrigin } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  try {
    const rejected = verifySameOrigin(context.request);
    if (rejected) return rejected;
    const limited = await enforceAuthRateLimit(context.env, context.request, 30, 15);
    if (limited) return limited;
    const { username = "", registrationCode = "" } = await readJson<{ username?: string; registrationCode?: string }>(context.request);
    const error = validateUsername(username);
    if (error) return json({ error }, 400);
    const { user, created } = await loginOrCreateUser(context.env, username, registrationCode);
    const cookie = await createSession(context.env, user.id, context.request);
    return json({ user, created }, created ? 201 : 200, { "set-cookie": cookie });
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTRATION_CODE_INVALID") {
      return json({ error: "新用户注册码不正确" }, 403);
    }
    return handleError(error);
  }
}
