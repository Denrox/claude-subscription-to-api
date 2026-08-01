// Server-only helpers that call the API. The API lives in the same process on
// the same port, so this is a loopback call — but it still goes through the
// auth middleware, which is why the browser's Cookie header is forwarded: the
// loader authenticates as the user whose request it is serving, nothing more.
const API_BASE = process.env.INTERNAL_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;

function forward(request: Request, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return { ...init, headers };
}

// A 401 here means the session died between the document request and this
// fetch. Throwing a redirect sends the browser to the login page instead of
// rendering an error boundary full of nulls.
export async function apiGet<T>(request: Request, path: string): Promise<T> {
  const res = await fetch(API_BASE + path, forward(request));
  if (res.status === 401) throw new Response(null, { status: 302, headers: { Location: "/login" } });
  if (!res.ok) throw new Response(await res.text(), { status: res.status });
  return (await res.json()) as T;
}

// Mutations return the raw Response: the caller decides how to render a 400,
// whose body is the validation message the API produced.
export function apiSend(
  request: Request,
  path: string,
  method: "PUT" | "POST",
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
