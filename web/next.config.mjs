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
    // Baseline production security headers. The CSP is intentionally moderate
    // (Next's app router needs inline/eval for hydration); tighten to a
    // per-request nonce before a real production launch.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
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
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
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
