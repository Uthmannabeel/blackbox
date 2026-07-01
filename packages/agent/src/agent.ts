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
   the live database when useful.
3. When a real incident is confirmed, open_incident, then keep update_incident_state
   current as you move through triage -> diagnose -> mitigate -> resolve.
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

  /** Handle one operator message; returns the final reply plus a trace of events. */
  async chat(userMessage: string, maxSteps = 8): Promise<AgentResult> {
    const events: AgentEvent[] = [];

    // Persist the operator turn to durable memory.
    await this.memory.remember({
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

        await this.memory.remember({
          sessionId: this.ctx.sessionId,
          incidentId: this.ctx.currentIncidentId,
          kind: "agent_msg",
          content: reply || "(no text)",
          importance: 0.6,
        });
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

        // Record significant actions as durable memory.
        if (tool && name !== "recall_memories") {
          await this.memory.remember({
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

    return {
      reply: "Reached step limit without a final answer. Consider narrowing the request.",
      events,
    };
  }
}
