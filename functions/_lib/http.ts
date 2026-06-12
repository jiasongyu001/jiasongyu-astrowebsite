import type { FunctionContext } from "./types";

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new Error("请求格式必须为 JSON");
  return request.json() as Promise<T>;
}

export function verifySameOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin || origin === new URL(request.url).origin) return null;
  return json({ error: "请求来源验证失败" }, 403);
}

export function handleError(error: unknown): Response {
  console.error(error);
  const message = error instanceof Error ? error.message : "服务器发生未知错误";
  return json({ error: message }, 500);
}

export type Handler = (context: FunctionContext) => Promise<Response>;
