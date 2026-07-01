import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { createMemoryService, type IMemoryService } from "@blackbox/memory";
import { buildTools, type AgentTool, type ToolContext } from "./tools.js";

const SYSTEM_PROMPT = `You are BlackBox, an expert SRE incident-response copilot.

Your memory lives in CockroachDB and survives outages. Work like a senior on-call:
1. On any new problem, FIRST recall_similar_incidents and recall_runbooks — never
   start from scratch if institutional memory can help.
2. Reason explicitly about hypotheses; use inspect_cluster to check facts against
   the live database when useful, and list_services to identify the fleet.
3. When a real incident is confirmed, open_incident with the SERVICE NAME (e.g.
   'checkout-api'), then keep update_incident_state current as you move through
   triage -> diagnose -> mitigate -> resolve.
4. When fixed, resolve_incident with a crisp resolution so the fix becomes memory
   for next time.

Be concise and decisive. Cite which past incident or runbook informed your advice.`;

export interface AgentEvent {
  type: "text" | "tool_call" | "tool_result";
  text?: string;
  tool?: string;
  input?: unknown;
  result?: string;
}

export interface AgentResult {
  reply: string;
  events: AgentEvent[];
}

/** Common surface implemented by both the real and mock agents. */
export interface Agent {
  readonly currentIncidentId: string | null;
  chat(userMessage: string, maxSteps?: number): Promise<AgentResult>;
}

/**
 * The BlackBox agent: a reason <-> recall <-> act loop over Bedrock Converse
 * with tool use. Conversation turns are also written to durable memory so the
 * agent remembers across sessions and across region failures.
 */
export class BlackBoxAgent implements Agent {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly memory: IMemoryService;
  private readonly ctx: ToolContext;
  private readonly tools: AgentTool[];
  private readonly toolConfig: ToolConfiguration;
  private readonly history: Message[] = [];

  constructor(opts: { sessionId: string; incidentId?: string | null; memory?: IMemoryService }) {
    this.client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
    this.modelId = process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6-v1:0";
    this.memory = opts.memory ?? createMemoryService();
    this.ctx = {
      memory: this.memory,
      sessionId: opts.sessionId,
      currentIncidentId: opts.incidentId ?? null,
    };
    this.tools = buildTools(this.ctx);
    this.toolConfig = {
      tools: this.tools.map((t) => ({ toolSpec: t.spec })),
    } as ToolConfiguration;
  }

  get currentIncidentId(): string | null {
    return this.ctx.currentIncidentId;
  }

  /**
   * Queue a durable-memory write without blocking the reasoning loop — each
   * write costs a Bedrock embedding round-trip, so serializing them inside the
   * loop would add seconds of latency per turn. flushWrites() awaits them all
   * before chat() returns (required for Lambda's freeze semantics).
   */
  private pendingWrites: Promise<unknown>[] = [];

  private recordMemory(input: Parameters<IMemoryService["remember"]>[0]): void {
    this.pendingWrites.push(
      this.memory.remember(input).catch((err) => {
        console.error("[agent] memory write failed:", (err as Error).message);
      }),
    );
  }

  private async flushWrites(): Promise<void> {
    await Promise.allSettled(this.pendingWrites);
    this.pendingWrites = [];
  }

  /**
   * Cap the in-flight Bedrock conversation. Trims whole turns from the front
   * (a turn boundary is a user message containing plain text — tool results
   * are user-role but text-less), so toolUse/toolResult pairs stay intact.
   */
  private trimHistory(maxMessages = 30): void {
    if (this.history.length <= maxMessages) return;
    let i = this.history.length - maxMessages;
    while (i < this.history.length) {
      const m = this.history[i];
      if (
        m?.role === "user" &&
        m.content?.some((c) => typeof (c as { text?: unknown }).text === "string")
      ) {
        break;
      }
      i++;
    }
    this.history.splice(0, i);
  }

  /** Handle one operator message; returns the final reply plus a trace of events. */
  async chat(userMessage: string, maxSteps = 8): Promise<AgentResult> {
    const events: AgentEvent[] = [];

    this.trimHistory();

    // Persist the operator turn to durable memory (non-blocking).
    this.recordMemory({
      sessionId: this.ctx.sessionId,
      incidentId: this.ctx.currentIncidentId,
      kind: "user_msg",
      content: userMessage,
      importance: 0.6,
    });

    this.history.push({ role: "user", content: [{ text: userMessage }] });

    for (let step = 0; step < maxSteps; step++) {
      const res = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          system: [{ text: SYSTEM_PROMPT }],
          messages: this.history,
          toolConfig: this.toolConfig,
          inferenceConfig: { maxTokens: 1500, temperature: 0.2 },
        }),
      );

      const message = res.output?.message;
      if (message) this.history.push(message);

      const blocks: ContentBlock[] = message?.content ?? [];
      for (const b of blocks) {
        if (b.text) events.push({ type: "text", text: b.text });
      }

      if (res.stopReason !== "tool_use") {
        const reply = blocks
          .map((b) => b.text)
          .filter(Boolean)
          .join("\n")
          .trim();

        this.recordMemory({
          sessionId: this.ctx.sessionId,
          incidentId: this.ctx.currentIncidentId,
          kind: "agent_msg",
          content: reply || "(no text)",
          importance: 0.6,
        });
        await this.flushWrites();
        return { reply, events };
      }

      // Execute every requested tool and feed results back.
      const toolResults: ContentBlock[] = [];
      for (const b of blocks) {
        if (!b.toolUse) continue;
        const { toolUseId, name, input } = b.toolUse;
        if (!toolUseId || !name) continue;
        events.push({ type: "tool_call", tool: name, input });

        const tool = this.tools.find((t) => t.spec.name === name);
        let output: string;
        try {
          output = tool
            ? await tool.handler(input ?? {})
            : `Unknown tool: ${name}`;
        } catch (err) {
          output = `Tool ${name} failed: ${(err as Error).message}`;
        }
        events.push({ type: "tool_result", tool: name, result: output });

        // Record significant actions as durable memory (non-blocking).
        if (tool && name !== "recall_memories") {
          this.recordMemory({
            sessionId: this.ctx.sessionId,
            incidentId: this.ctx.currentIncidentId,
            kind: name.startsWith("recall") || name === "inspect_cluster" ? "observation" : "action",
            content: `${name}(${JSON.stringify(input)}) -> ${output.slice(0, 500)}`,
            importance: name.startsWith("recall") ? 0.4 : 0.8,
          });
        }

        toolResults.push({
          toolResult: {
            toolUseId,
            content: [{ text: output }],
          },
        });
      }

      this.history.push({ role: "user", content: toolResults });
    }

    await this.flushWrites();
    return {
      reply: "Reached step limit without a final answer. Consider narrowing the request.",
      events,
    };
  }
}
