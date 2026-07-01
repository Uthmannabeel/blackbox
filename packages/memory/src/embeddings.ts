import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Embeddings via Amazon Bedrock — Titan Text Embeddings v2 (1024 dimensions),
 * matching the VECTOR(1024) columns in db/schema.sql.
 *
 * One AWS service (Bedrock) powers both embeddings (here) and reasoning (the
 * agent package). Swap BEDROCK_EMBED_MODEL_ID to use Cohere embeddings instead.
 */
const EMBED_DIM = 1024;

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  }
  return client;
}

export async function embed(text: string): Promise<number[]> {
  const modelId = process.env.BEDROCK_EMBED_MODEL_ID ?? "amazon.titan-embed-text-v2:0";

  const body = JSON.stringify({
    inputText: text,
    dimensions: EMBED_DIM,
    normalize: true, // unit vectors -> cosine distance is well-behaved
  });

  const res = await getClient().send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body,
    }),
  );

  const payload = JSON.parse(new TextDecoder().decode(res.body)) as {
    embedding: number[];
  };

  if (!payload.embedding || payload.embedding.length !== EMBED_DIM) {
    throw new Error(
      `Bedrock returned ${payload.embedding?.length ?? 0} dims, expected ${EMBED_DIM}`,
    );
  }
  return payload.embedding;
}

export { EMBED_DIM };
