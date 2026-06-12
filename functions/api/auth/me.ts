import { currentUser } from "../../_lib/auth";
import { handleError, json } from "../../_lib/http";
import type { FunctionContext } from "../../_lib/types";

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  try {
    return json({ user: await currentUser(context.env, context.request) });
  } catch (error) {
    return handleError(error);
  }
}
