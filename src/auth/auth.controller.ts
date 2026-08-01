import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { config } from "../config";
import { clearSessionCookie, serializeSessionCookie } from "./auth.middleware";
import { clientKey, loginThrottle, sessionSecret } from "./runtime";
import { issueSession, verifyPassword } from "./session";

// Login is a plain form POST handled server-side (not an RR7 action) so the
// session secret and the password check stay in one place — the API — and the
// UI never needs either. Both endpoints are excluded from the /api prefix in
// main.ts so the form can post to /login.
//
// Redirect targets are validated to a single leading slash: `next` comes
// straight off the query string, and `//evil.example` is a protocol-relative
// URL that a naive redirect would happily follow off-site.
function safeNext(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  if (!s.startsWith("/") || s.startsWith("//")) return "/";
  return s;
}

@Controller()
export class AuthController {
  @Post("login")
  login(@Body() body: any, @Req() req: Request, @Res() res: Response): void {
    const key = clientKey(req);
    const next = safeNext(body?.next);

    if (loginThrottle.blocked(key)) {
      res.redirect(302, `/login?error=throttled&next=${encodeURIComponent(next)}`);
      return;
    }

    const password = typeof body?.password === "string" ? body.password : "";
    if (
      !verifyPassword(password, {
        password: config.auth.password,
        passwordHash: config.auth.passwordHash,
      })
    ) {
      loginThrottle.recordFailure(key);
      res.redirect(302, `/login?error=invalid&next=${encodeURIComponent(next)}`);
      return;
    }

    loginThrottle.reset(key);
    const token = issueSession(sessionSecret, config.auth.sessionTtlMs);
    res.setHeader("Set-Cookie", serializeSessionCookie(token, config.auth.sessionTtlMs));
    res.redirect(302, next);
  }

  // Stateless sessions can't be revoked server-side, so logout is exactly
  // "drop the cookie". A stolen cookie stays valid until it expires — that is
  // the trade this session design makes; rotate SESSION_SECRET to kill all.
  @Post("logout")
  logout(@Res() res: Response): void {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.redirect(302, "/login");
  }
}
