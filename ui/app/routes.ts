import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // GET only — the form posts to Nest's POST /login, which owns the password
  // check and the cookie.
  route("login", "routes/login.tsx"),
] satisfies RouteConfig;
