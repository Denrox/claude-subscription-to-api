import type { Config } from "@react-router/dev/config";

// SSR on: loaders/actions run inside the same Node process as the API and call
// it over loopback, so the browser never talks to the API directly and the
// session cookie is the only credential in play.
export default {
  ssr: true,
} satisfies Config;
