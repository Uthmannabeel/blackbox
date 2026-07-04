// Diagnostic: verify AWS credentials, Titan embeddings, and Claude Converse
// access on Bedrock. Safe to re-run anytime:  node scripts/check-bedrock.mjs
import { loadEnv, embed } from "../packages/memory/dist/index.js";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

loadEnv();

let ok = true;

// 1. Titan embeddings (also proves the credentials work at all)
try {
  const v = await embed("bedrock connectivity check");
  console.log(`✓ Titan embeddings OK (${v.length} dims)`);
} catch (err) {
  ok = false;
  console.error(`✗ Titan embeddings failed: ${err.name}: ${err.message}`);
}

// 2. Claude via Converse — retry with the regional inference profile if the
//    bare model ID rejects on-demand invocation.
const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});
const base = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-sonnet-4-6";
const candidates = [base, base.startsWith("us.") ? null : `us.${base}`].filter(Boolean);

let claudeOk = false;
for (const modelId of candidates) {
  try {
    const res = await client.send(
      new ConverseCommand({
        modelId,
        messages: [
          { role: "user", content: [{ text: "Reply with exactly: BLACKBOX ONLINE" }] },
        ],
        inferenceConfig: { maxTokens: 20 },
      }),
    );
    const text = res.output?.message?.content?.map((c) => c.text).join("") ?? "";
    console.log(`✓ Claude OK via "${modelId}" → ${text.trim()}`);
    if (modelId !== base) {
      console.log(`  ACTION: set BEDROCK_MODEL_ID="${modelId}" in .env`);
    }
    claudeOk = true;
    break;
  } catch (err) {
    console.error(`✗ "${modelId}" → ${err.name}: ${err.message}`);
  }
}

process.exit(ok && claudeOk ? 0 : 1);
