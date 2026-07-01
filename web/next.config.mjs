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
};

export default nextConfig;
