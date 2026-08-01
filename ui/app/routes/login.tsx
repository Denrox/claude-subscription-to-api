import type { Route } from "./+types/login";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/";
  return {
    error: url.searchParams.get("error"),
    next: next.startsWith("/") && !next.startsWith("//") ? next : "/",
  };
}

const MESSAGES: Record<string, string> = {
  invalid: "Wrong password.",
  throttled: "Too many attempts. Wait a few minutes and try again.",
};

export default function Login({ loaderData }: Route.ComponentProps) {
  const { error, next } = loaderData;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">Claude credentials</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to manage this host's Claude auth.</p>

        <form method="post" action="/login" className="mt-6 space-y-3">
          <input type="hidden" name="next" value={next} />
          <input
            type="password"
            name="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Password"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {MESSAGES[error] ?? "Sign-in failed."}
            </p>
          )}
          <button className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
