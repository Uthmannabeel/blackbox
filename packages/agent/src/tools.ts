import type { IMemoryService } from "@blackbox/memory";
import { mcpConfigured, mcpRunSql } from "./mcp.js";

/** A tool the agent can call: a Bedrock toolSpec + a handler. */
export interface AgentTool {
  spec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
  handler: (input: any) => Promise<string>;
}

export interface ToolContext {
  memory: IMemoryService;
  sessionId: string;
  /** The incident currently being worked, if any. Mutated as the agent opens one. */
  currentIncidentId: string | null;
}

/** Build the toolset, bound to the live memory service + session context. */
export function buildTools(ctx: ToolContext): AgentTool[] {
  const tools: AgentTool[] = [
    {
      spec: {
        name: "recall_similar_incidents",
        description:
          "Semantic search over past RESOLVED incidents. Use first on any new problem to check 'have we seen this before?' and learn what fixed it.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              situation: {
                type: "string",
                description: "Description of the current symptoms/problem.",
              },
              limit: { type: "number", description: "Max results (default 5)." },
            },
            required: ["situation"],
          },
        },
      },
      handler: async (input) => {
        const hits = await ctx.memory.recallSimilarIncidents(input.situation, input.limit ?? 5);
        if (hits.length === 0) return "No similar past incidents found.";
        return hits
          .map(
            (h, i) =>
              `#${i + 1} (distance ${h.distance.toFixed(3)}, region ${h.item.region}) ` +
              `[${h.item.severity}] ${h.item.title}\n  Summary: ${h.item.summary}\n  Resolution: ${h.item.resolution}`,
          )
          .join("\n\n");
      },
    },
    {
      spec: {
        name: "recall_runbooks",
        description:
          "Semantic search over remediation runbooks. Use to retrieve step-by-step procedures relevant to the current situation.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              situation: { type: "string" },
              limit: { type: "number" },
            },
            required: ["situation"],
          },
        },
      },
      handler: async (input) => {
        const hits = await ctx.memory.recallRunbooks(input.situation, input.limit ?? 3);
        if (hits.length === 0) return "No relevant runbooks found.";
        return hits
          .map(
            (h) =>
              `${h.item.title} (tags: ${h.item.tags.join(", ")})\n${h.item.body}`,
          )
          .join("\n\n");
      },
    },
    {
      spec: {
        name: "recall_memories",
        description:
          "Semantic search over the agent's own memory stream (past observations, actions, reflections). Use to stay consistent with what you already decided this incident.",
        inputSchema: {
          json: {
            type: "object",
            properties: { query: { type: "string" }, limit: { type: "number" } },
            required: ["query"],
          },
        },
      },
      handler: async (input) => {
        const hits = await ctx.memory.recallMemories(input.query, input.limit ?? 6);
        if (hits.length === 0) return "No relevant memories.";
        return hits
          .map((h) => `[${h.item.kind}] ${h.item.content}`)
          .join("\n");
      },
    },
    {
      spec: {
        name: "open_incident",
        description:
          "Open a new incident record when a real problem is confirmed. Returns the incident id and sets it as the current incident.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              service_id: { type: "string" },
              title: { type: "string" },
              summary: { type: "string" },
              severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"] },
            },
            required: ["service_id", "title", "summary", "severity"],
          },
        },
      },
      handler: async (input) => {
        const inc = await ctx.memory.recordIncident({
          serviceId: input.service_id,
          title: input.title,
          summary: input.summary,
          severity: input.severity,
        });
        ctx.currentIncidentId = inc.id;
        return `Opened incident ${inc.id} in region ${inc.region}.`;
      },
    },
    {
      spec: {
        name: "update_incident_state",
        description:
          "Persist the strongly-consistent live state of the current incident (phase, hypotheses, actions taken, next steps). Call whenever your understanding changes.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              phase: { type: "string", enum: ["triage", "diagnose", "mitigate", "resolve"] },
              hypotheses: { type: "array", items: { type: "string" } },
              actions_taken: { type: "array", items: { type: "string" } },
              next_steps: { type: "array", items: { type: "string" } },
            },
            required: ["phase"],
          },
        },
      },
      handler: async (input) => {
        if (!ctx.currentIncidentId) return "No current incident to update. Open one first.";
        await ctx.memory.updateIncidentState({
          incidentId: ctx.currentIncidentId,
          phase: input.phase,
          hypotheses: input.hypotheses ?? [],
          actionsTaken: input.actions_taken ?? [],
          nextSteps: input.next_steps ?? [],
        });
        return `Incident ${ctx.currentIncidentId} state updated (phase: ${input.phase}).`;
      },
    },
    {
      spec: {
        name: "resolve_incident",
        description:
          "Mark the current incident resolved and record the resolution so future recall can learn from it.",
        inputSchema: {
          json: {
            type: "object",
            properties: { resolution: { type: "string" } },
            required: ["resolution"],
          },
        },
      },
      handler: async (input) => {
        if (!ctx.currentIncidentId) return "No current incident to resolve.";
        await ctx.memory.resolveIncident(ctx.currentIncidentId, input.resolution);
        const id = ctx.currentIncidentId;
        return `Incident ${id} resolved and committed to episodic memory.`;
      },
    },
  ];

  // Only expose cluster introspection if the Managed MCP Server is configured.
  if (mcpConfigured()) {
    tools.push({
      spec: {
        name: "inspect_cluster",
        description:
          "Run a READ-ONLY SQL query against the live CockroachDB cluster via its Managed MCP Server. Use to inspect schema, indexes, cluster health, or running queries. SELECT/SHOW/EXPLAIN only.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              sql: { type: "string", description: "A read-only SQL statement." },
            },
            required: ["sql"],
          },
        },
      },
      handler: async (input) => {
        const sql = String(input.sql ?? "");
        if (!/^\s*(select|show|explain|with)\b/i.test(sql)) {
          return "Refused: inspect_cluster only runs read-only SELECT/SHOW/EXPLAIN/WITH.";
        }
        return mcpRunSql(sql);
      },
    });
  }

  return tools;
}
