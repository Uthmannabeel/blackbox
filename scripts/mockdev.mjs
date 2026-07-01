// Launch the web app in offline mock mode (no CockroachDB/Bedrock needed).
// Cross-platform: sets BLACKBOX_MOCK, then runs the Next.js dev server.
import { spawn } from "node:child_process";

process.env.BLACKBOX_MOCK = "1";

const child = spawn("npm", ["run", "dev", "-w", "@blackbox/web"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
