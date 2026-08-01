import { Form, Link, useNavigation } from "react-router";
import { apiGet, apiSend } from "~/lib/api.server";
import type { Route } from "./+types/tokens";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  expired: boolean;
  active: boolean;
}

export function meta() {
  return [{ title: "API tokens" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return await apiGet<{ tokens: ApiToken[] }>(request, "/api/tokens");
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "revoke" || intent === "delete") {
    const id = String(form.get("id") ?? "");
    if (!id) return { error: "Missing token id." };
    const path = intent === "revoke" ? `/api/tokens/${id}/revoke` : `/api/tokens/${id}`;
    const res = await apiSend(request, path, intent === "revoke" ? "POST" : "DELETE");
    if (!res.ok) return { error: await res.text() };
    return { message: intent === "revoke" ? "Token revoked." : "Token deleted." };
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Give the token a name so you can recognise it later." };
  const expiresInDays = String(form.get("expiresInDays") ?? "").trim();

  const res = await apiSend(
    request,
    "/api/tokens",
    "POST",
    JSON.stringify({ name, expiresInDays: expiresInDays ? Number(expiresInDays) : null }),
  );
  if (!res.ok) return { error: await res.text() };
  const created = (await res.json()) as ApiToken & { token: string };
  return { created };
}

function fmt(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function since(ts: number | null | undefined): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Badge({ tone, children }: { tone: "good" | "bad" | "warn"; children: React.ReactNode }) {
  const cls = {
    good: "bg-green-100 text-green-700",
    bad: "bg-red-100 text-red-700",
    warn: "bg-amber-100 text-amber-700",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export default function Tokens({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { tokens } = loaderData;
  const created = actionData && "created" in actionData ? actionData.created : undefined;
  const error = actionData && "error" in actionData ? actionData.error : undefined;
  const message = actionData && "message" in actionData ? actionData.message : undefined;

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">API tokens</h1>
          <p className="mt-1 text-sm text-slate-500">
            A token authenticates calls to <code className="font-mono">/v1/messages</code>, which
            runs this host's Claude CLI and answers in the Claude API's response shape. See{" "}
            <a className="underline hover:text-slate-700" href="/docs">
              the API docs
            </a>
            .
          </p>
        </div>
        <Link
          to="/"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Credentials
        </Link>
      </header>

      {created && (
        <section className="mt-8 rounded-md border border-green-300 bg-green-50 p-4">
          <h2 className="text-base font-semibold text-green-900">
            Token created — copy it now
          </h2>
          <p className="mt-1 text-sm text-green-800">
            This is the only time it is shown. Nothing can read it back afterwards.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-green-200 bg-white p-3 font-mono text-sm text-slate-800">
            {created.token}
          </pre>
          <p className="mt-3 text-xs text-green-900">
            Use it as <code className="font-mono">x-api-key</code> (or{" "}
            <code className="font-mono">Authorization: Bearer …</code>), and point the Anthropic SDK
            at this host with <code className="font-mono">base_url</code>.
          </p>
        </section>
      )}

      <section className="mt-8 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-800">New token</h2>
        <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex-1">
            <span className="block text-xs text-slate-500">Name</span>
            <input
              name="name"
              placeholder="laptop"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </label>
          <label>
            <span className="block text-xs text-slate-500">Expires in (days)</span>
            <input
              name="expiresInDays"
              type="number"
              min={1}
              max={3650}
              placeholder="never"
              className="mt-1 w-32 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </label>
          <button
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Working…" : "Create token"}
          </button>
        </Form>
        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm whitespace-pre-wrap text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-slate-800">Existing tokens</h2>
        {tokens.length === 0 ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No tokens yet. Until one exists, <code className="font-mono">/v1/messages</code> rejects
            every request.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{token.name}</span>
                    {token.active ? (
                      <Badge tone="good">active</Badge>
                    ) : token.revokedAt ? (
                      <Badge tone="bad">revoked</Badge>
                    ) : (
                      <Badge tone="warn">expired</Badge>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-400">{token.prefix}…</div>
                  <div className="mt-1 text-xs text-slate-500">
                    created {fmt(token.createdAt)} · last used {since(token.lastUsedAt)} · expires{" "}
                    {token.expiresAt ? fmt(token.expiresAt) : "never"}
                  </div>
                </div>
                <div className="flex gap-2">
                  {token.active && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="revoke" />
                      <input type="hidden" name="id" value={token.id} />
                      <button
                        disabled={busy}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </Form>
                  )}
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={token.id} />
                    <button
                      disabled={busy}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
