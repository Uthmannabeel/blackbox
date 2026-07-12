import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the monorepo root (a stray lockfile in the home dir confuses inference).
  outputFileTracingRoot: repoRoot,
  // The agent + memory packages are ESM workspace deps compiled to dist.
  transpilePackages: ["@blackbox/agent", "@blackbox/memory"],
  // pg and the AWS SDK are server-only; keep them out of the client bundle.
  serverExternalPackages: ["pg", "@aws-sdk/client-bedrock-runtime"],

  async headers() {
    // Baseline production security headers.
    //
    // 'unsafe-inline' remains for scripts because the pages are statically
    // prerendered (no per-request nonce is possible without forcing every page
    // to render dynamically, which would defeat the static home page) and
    // Next's App Router emits inline hydration scripts. 'unsafe-eval' is NOT
    // needed by Next 15 production hydration, so it's dropped — it's the more
    // dangerous of the two. No user-derived data is ever written into a script
    // context (there is no dangerouslySetInnerHTML of user input), so the
    // residual XSS surface is minimal. style-src keeps 'unsafe-inline' for the
    // inline styles the components use.
    // fonts.googleapis/gstatic are allowed for the IBM Plex webfont link.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
