import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Claude credentials</title>
        <Meta />
        <Links />
      </head>
      <body className="min-h-full bg-slate-50 text-slate-900">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "";
  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    detail = typeof error.data === "string" ? error.data : JSON.stringify(error.data);
  } else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <main className="p-8">
      <div className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-red-50 p-6">
        <h1 className="text-lg font-semibold text-red-800">{title}</h1>
        {detail && <pre className="mt-3 whitespace-pre-wrap text-sm text-red-700">{detail}</pre>}
      </div>
    </main>
  );
}
