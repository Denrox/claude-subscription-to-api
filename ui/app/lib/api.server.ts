const API_BASE = process.env.INTERNAL_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;

function forward(request: Request, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return { ...init, headers };
}

export async function apiGet<T>(request: Request, path: string): Promise<T> {
  const res = await fetch(API_BASE + path, forward(request));
  if (res.status === 401) throw new Response(null, { status: 302, headers: { Location: "/login" } });
  if (!res.ok) throw new Response(await res.text(), { status: res.status });
  return (await res.json()) as T;
}

export function apiSend(
  request: Request,
  path: string,
  method: "PUT" | "POST" | "DELETE",
  body?: string,
): Promise<Response> {
  return fetch(
    API_BASE + path,
    forward(request, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body,
    }),
  );
}
