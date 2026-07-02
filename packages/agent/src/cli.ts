import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, isMock } from "@blackbox/memory";
import { createAgent } from "./index.js";
import { mcpConfigured } from "./mcp.js";

/**
 * Interactive CLI to talk to the BlackBox agent. Usage: npm run agent:dev
 * Type an incident description; the agent recalls, reasons, and acts.
 */

// Load repo-root .env (Node >=20.6 built-in; no dependency needed).
try {
  const here = dirname(fileURLToPath(import.meta.url));
  (process as any).loadEnvFile?.(resolve(here, "../../../.env"));
} catch {
  /* .env optional if vars already in environment */
}

async function main() {
  const sessionId = randomUUID();
  const agent = createAgent({ sessionId });

  console.log("🛩️  BlackBox incident copilot");
  console.log(`   session ${sessionId}`);
  console.log(`   mode: ${isMock() ? "MOCK (offline)" : "live (Bedrock + CockroachDB)"}`);
  console.log(`   cluster introspection (MCP): ${mcpConfigured() ? "enabled" : "disabled"}`);
  console.log("   Type your incident, or 'exit' to quit.\n");

  const rl = createInterface({ input: stdin, output: stdout });

  // Async iteration handles both interactive TTYs and piped stdin: lines that
  // arrive while a turn is processing are buffered, and EOF ends the loop
  // cleanly (readline.question() throws ERR_USE_AFTER_CLOSE on piped EOF).
  process.stdout.write("you › ");
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) {
      process.stdout.write("you › ");
      continue;
    }
    if (line === "exit" || line === "quit") break;

    const { reply, events } = await agent.chat(line);

    for (const e of events) {
      if (e.type === "tool_call") console.log(`   ↳ 🔧 ${e.tool}(${JSON.stringify(e.input)})`);
      if (e.type === "tool_result") console.log(`   ↳ 📦 ${truncate(e.result ?? "", 200)}`);
    }
    console.log(`\nblackbox › ${reply}\n`);
    if (agent.currentIncidentId) {
      console.log(`   [active incident: ${agent.currentIncidentId}]\n`);
    }
    process.stdout.write("you › ");
  }

  rl.close();
  await closePool();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
