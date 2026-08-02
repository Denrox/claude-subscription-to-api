import { Form, Link, useNavigation } from "react-router";
import { apiGet, apiSend } from "~/lib/api.server";
import type { Route } from "./+types/home";

interface Status {
  credentials: {
    exists: boolean;
    path: string;
    hasTokens: boolean | null;
    hasRefreshToken: boolean | null;
    expiresAt: number | null;
    expired: boolean | null;
    subscriptionType: string | null;
    scopes: string[] | null;
    updatedAt: number | null;
  };
  cliConfig: {
    exists: boolean;
    path: string;
    hasCompletedOnboarding: boolean | null;
    account: string | null;
    updatedAt: number | null;
  };
  refresh: {
    last: RefreshResult | null;
    recent: RefreshResult[];
    running: boolean;
    intervalMs: number;
    nextRunAt: number | null;
  };
  home: string;
}

interface RefreshResult {
  at: number;
  trigger: string;
  ok: boolean;
  rotated: boolean;
  expiresAtBefore: number | null;
  expiresAtAfter: number | null;
  durationMs: number;
  error: string | null;
}

const CREDS_PLACEHOLDER = JSON.stringify(
  {
    claudeAiOauth: {
      accessToken: "sk-ant-oat01-…",
      refreshToken: "sk-ant-ort01-…",
      expiresAt: 0,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
    },
  },
  null,
  2,
);

const CONFIG_PLACEHOLDER = `{
  "hasCompletedOnboarding": true,
  "oauthAccount": { "emailAddress": "you@example.com" },
  …paste the full contents of your ~/.claude.json…
}`;

export function meta() {
  return [{ title: "Claude credentials" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return { status: await apiGet<Status>(request, "/api/claude/status") };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "refresh") {
    const res = await apiSend(request, "/api/claude/refresh", "POST");
    if (!res.ok) return { intent, error: await res.text() };
    const result = (await res.json()) as RefreshResult;
    return result.ok
      ? {
          intent,
          message: result.rotated ? "Tokens rotated." : "The CLI answered. No rotation was needed.",
        }
      : { intent, error: result.error ?? "Ping failed." };
  }

  const path = intent === "cli-config" ? "/api/claude/cli-config" : "/api/claude/credentials";
  const raw = String(form.get("json") ?? "").trim();
  if (!raw) return { intent, error: "Paste the JSON first." };
  try {
    JSON.parse(raw);
  } catch (err) {
    return { intent, error: `Invalid JSON: ${(err as Error).message}` };
  }
  const res = await apiSend(request, path, "PUT", raw);
  if (!res.ok) return { intent, error: await res.text() };
  return { intent, message: "Saved." };
}

function fmt(ts: number | null | undefined): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function since(ts: number | null | undefined): string {
  if (!ts) return "-";
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
  return (
    <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
  );
}

function Note({ error, message }: { error?: string; message?: string }) {
  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm whitespace-pre-wrap text-red-700">
        {error}
      </p>
    );
  }
  if (message) {
    return <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>;
  }
  return null;
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { credentials, cliConfig, refresh, home } = loaderData.status;
  const pick = (intent: string) => (actionData?.intent === intent ? actionData : undefined);

  return (
    <div className="mx-auto max-w-3xl p-6 sm:p-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Claude credentials</h1>
          <p className="mt-1 text-sm text-slate-500">
            Written straight into <code className="font-mono">{home}</code>, so an SSH session on
            this host uses the same auth. This page never shows them back.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/tokens"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            API tokens
          </Link>
          <Form method="post" action="/logout">
            <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Sign out
            </button>
          </Form>
        </div>
      </header>

      <section className="mt-8 rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Keep-alive</h2>
            <p className="mt-1 text-sm text-slate-500">
              Runs the CLI every {Math.round(refresh.intervalMs / 60000)} min so it rotates its own
              tokens. The app does not do the OAuth exchange itself. Two refreshers working on the
              same file are what leaves the tokens blank.
            </p>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="refresh" />
            <button
              disabled={busy}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? "Working…" : "Refresh now"}
            </button>
          </Form>
        </div>
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm text-slate-600">
          <dt className="text-slate-400">Last ping</dt>
          <dd>
            {refresh.last ? (
              <>
                {since(refresh.last.at)} ({refresh.last.trigger}){" "}
                {refresh.last.ok ? (
                  <Badge tone="good">{refresh.last.rotated ? "rotated" : "ok"}</Badge>
                ) : (
                  <Badge tone="bad">failed</Badge>
                )}
              </>
            ) : (
              "never"
            )}
          </dd>
          <dt className="text-slate-400">Next ping</dt>
          <dd>{fmt(refresh.nextRunAt)}</dd>
        </dl>
        {refresh.last?.error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm whitespace-pre-wrap text-red-700">
            {refresh.last.error}
          </p>
        )}
        <div className="mt-3">
          <Note error={pick("refresh")?.error} message={pick("refresh")?.message} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-slate-800">
          Credentials{" "}
          <code className="font-mono text-sm font-normal text-slate-500">{credentials.path}</code>
        </h2>
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-4 text-sm">
          {credentials.exists ? (
            <>
              {credentials.hasTokens === false && (
                <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-red-700">
                  <span className="font-medium">Not logged in.</span> The file is here, but its
                  token fields are empty, so every run fails until you log in again. This does not
                  repair itself. Run{" "}
                  <code className="font-mono text-xs">claude setup-token</code> on a machine you
                  trust, and upload the result below.
                </p>
              )}
              {credentials.hasRefreshToken === false && credentials.hasTokens && (
                <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                  No refresh token, so the keep-alive ping cannot extend this session. It stops at
                  the expiry below.
                </p>
              )}
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-slate-600">
                <dt className="text-slate-400">Status</dt>
                <dd>
                  present
                  {credentials.hasTokens === false && <Badge tone="bad">no tokens</Badge>}
                </dd>
                <dt className="text-slate-400">Plan</dt>
                <dd>{credentials.subscriptionType ?? "-"}</dd>
                <dt className="text-slate-400">Expires</dt>
                <dd>
                  {fmt(credentials.expiresAt)}
                  {credentials.expired === true && <Badge tone="bad">expired</Badge>}
                  {credentials.expired === false && <Badge tone="good">valid</Badge>}
                </dd>
                <dt className="text-slate-400">File updated</dt>
                <dd>{since(credentials.updatedAt)}</dd>
                <dt className="text-slate-400">Scopes</dt>
                <dd className="font-mono text-xs">{credentials.scopes?.join(", ") ?? "-"}</dd>
              </dl>
            </>
          ) : (
            <p className="text-slate-500">No credentials file, so the CLI is not logged in.</p>
          )}
        </div>
        <Form method="post" className="mt-3 space-y-3">
          <input type="hidden" name="intent" value="credentials" />
          <textarea
            name="json"
            spellCheck={false}
            placeholder={CREDS_PLACEHOLDER}
            className="h-56 w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-sm leading-relaxed placeholder:text-slate-300 focus:border-slate-500 focus:outline-none"
          />
          <Note error={pick("credentials")?.error} message={pick("credentials")?.message} />
          <button
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Upload credentials"}
          </button>
        </Form>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-slate-800">
          CLI config{" "}
          <code className="font-mono text-sm font-normal text-slate-500">{cliConfig.path}</code>
        </h2>
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-4 text-sm">
          {cliConfig.exists ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-slate-600">
              <dt className="text-slate-400">Status</dt>
              <dd>present</dd>
              <dt className="text-slate-400">Onboarded</dt>
              <dd>
                {cliConfig.hasCompletedOnboarding === null
                  ? "-"
                  : String(cliConfig.hasCompletedOnboarding)}
              </dd>
              <dt className="text-slate-400">Account</dt>
              <dd>{cliConfig.account ?? "-"}</dd>
              <dt className="text-slate-400">File updated</dt>
              <dd>{since(cliConfig.updatedAt)}</dd>
            </dl>
          ) : (
            <p className="text-slate-500">
              No config file, so the CLI can start its first-time onboarding. Upload your{" "}
              <code className="font-mono">~/.claude.json</code> to avoid this.
            </p>
          )}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">
            Replace ~/.claude.json
          </summary>
          <Form method="post" className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="cli-config" />
            <textarea
              name="json"
              spellCheck={false}
              placeholder={CONFIG_PLACEHOLDER}
              className="h-56 w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-sm leading-relaxed placeholder:text-slate-300 focus:border-slate-500 focus:outline-none"
            />
            <Note error={pick("cli-config")?.error} message={pick("cli-config")?.message} />
            <button
              disabled={busy}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Upload config"}
            </button>
          </Form>
        </details>
      </section>

      {refresh.recent.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-800">Recent pings</h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
            {refresh.recent.map((r) => (
              <li key={r.at} className="flex items-baseline gap-3 px-4 py-2">
                <span className="w-40 shrink-0 text-slate-500">{fmt(r.at)}</span>
                <span className="w-16 shrink-0 text-slate-400">{r.trigger}</span>
                <span className="flex-1 text-slate-600">
                  {r.ok ? (r.rotated ? "rotated" : "no rotation") : (r.error ?? "failed")}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {Math.round(r.durationMs / 100) / 10}s
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
