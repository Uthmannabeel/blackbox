import {
  clusterHealth,
  isMock,
  standardTierHealthCheck,
  type IMemoryService,
} from "@blackbox/memory";
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

/** One piece of provenance the agent used to reach its answer. */
export interface Evidence {
  kind: "incident" | "runbook";
  id: string;
  title: string;
  region: string;
  distance: number;
}

export interface ToolContext {
  memory: IMemoryService;
  sessionId: string;
  /** The incident currently being worked, if any. Mutated as the agent opens one. */
  currentIncidentId: string | null;
  /** Provenance collected this turn — recalled memories that informed the answer. */
  evidence: Evidence[];
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
        for (const h of hits) {
          ctx.evidence.push({ kind: "incident", id: h.item.id, title: h.item.title, region: h.item.region, distance: h.distance });
        }
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
        for (const h of hits) {
          ctx.evidence.push({ kind: "runbook", id: h.item.id, title: h.item.title, region: h.item.region, distance: h.distance });
        }
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
        name: "list_services",
        description:
          "List the services in the fleet (name, team, home region). Use to identify which service an incident belongs to.",
        inputSchema: {
          json: { type: "object", properties: {} },
        },
      },
      handler: async () => {
        const services = await ctx.memory.listServices();
        if (services.length === 0) return "No services registered.";
        return services
          .map((s) => `${s.name} (team: ${s.ownerTeam ?? "?"}, region: ${s.region})`)
          .join("\n");
      },
    },
    {
      spec: {
        name: "open_incident",
        description:
          "Open a new incident record when a real problem is confirmed. Pass the SERVICE NAME (e.g. 'checkout-api') — it is resolved to the fleet record, created if new. Returns the incident id and sets it as the current incident.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              service: {
                type: "string",
                description: "Service name, e.g. 'checkout-api'.",
              },
              title: { type: "string" },
              summary: { type: "string" },
              severity: { type: "string", enum: ["SEV1", "SEV2", "SEV3", "SEV4"] },
            },
            required: ["service", "title", "summary", "severity"],
          },
        },
      },
      handler: async (input) => {
        // Resolve the human-friendly name to a real fleet record; never trust
        // the model to produce a valid UUID.
        const svc = await ctx.memory.resolveService(String(input.service));
        const inc = await ctx.memory.recordIncident({
          serviceId: svc.id,
          title: input.title,
          summary: input.summary,
          severity: input.severity,
        });
        ctx.currentIncidentId = inc.id;
        return `Opened incident ${inc.id} for service ${svc.name} in region ${inc.region}.`;
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
        const id = ctx.currentIncidentId;
        const resolution = String(input.resolution);
        await ctx.memory.resolveIncident(id, resolution);

        // THE LEARNING LOOP, gated: the distilled fix must pass the memory
        // hygiene layer (content gate, duplicate consolidation, contradiction
        // check) before it can influence future recall. An unfiltered write
        // path is how self-improving memories poison themselves.
        const incident = await ctx.memory.getIncident(id);
        const title = incident?.title ?? "untitled incident";
        const outcome = await ctx.memory.commitLearnedRunbook({
          incidentId: id,
          title: `Learned runbook: ${title}`,
          body: `Distilled from incident ${id} (${new Date().toISOString().slice(0, 10)}):\n${resolution}`,
          tags: ["learned", "auto-postmortem"],
        });

        // Positive feedback: runbooks recalled during this investigation
        // contributed to a real resolution — they earn confidence.
        const recalledRunbooks = [
          ...new Set(ctx.evidence.filter((e) => e.kind === "runbook").map((e) => e.id)),
        ];
        const reinforced = await ctx.memory.reinforceRunbooks(recalledRunbooks);

        await ctx.memory.remember({
          sessionId: ctx.sessionId,
          incidentId: id,
          kind: "reflection",
          content: `Resolved "${title}". Learned: ${resolution}`,
          importance: 0.9,
        });

        const learnLine =
          outcome.action === "merged"
            ? `The fix matched existing knowledge — hygiene layer consolidated it (${outcome.detail}).`
            : outcome.action === "rejected"
              ? `The distilled fix did NOT pass the memory hygiene gate (${outcome.detail}); nothing was committed to procedural memory.`
              : outcome.contradictsId
                ? `A learned runbook was committed on probation — it contradicts existing knowledge (${outcome.detail}).`
                : `A learned runbook passed the hygiene gate and was committed — future similar incidents will recall this fix.`;
        const reinforceLine =
          reinforced > 0
            ? ` ${reinforced} runbook(s) recalled during this incident were reinforced.`
            : "";
        return `Incident ${id} resolved and committed to episodic memory. ${learnLine}${reinforceLine}`;
      },
    },
  ];

  // Self-diagnosis: the agent's memory IS a CockroachDB cluster; let it
  // observe the health of its own brain. Not available in full-mock mode
  // (there is no cluster to observe).
  if (!isMock()) {
    tools.push({
      spec: {
        name: "diagnose_memory",
        description:
          "Inspect the health of your OWN memory layer (the CockroachDB cluster): per-region node liveness, survival goal, and total memories. Use when asked about your memory, or when a region may be down.",
        inputSchema: {
          json: { type: "object", properties: {} },
        },
      },
      handler: async () => {
        const h = await clusterHealth();
        const lines = h.regions.map((r) => {
          const status =
            r.liveNodes === r.totalNodes
              ? "healthy"
              : r.liveNodes === 0
                ? "REGION DOWN"
                : "degraded";
          return `  ${r.region}: ${r.liveNodes}/${r.totalNodes} nodes live — ${status}`;
        });
        const down = h.regions.filter((r) => r.liveNodes === 0).length;
        const verdict =
          down === 0
            ? "All regions healthy."
            : down === 1
              ? `One region is down, but survival goal '${h.survivalGoal}' means my memory remains fully readable and writable from surviving replicas.`
              : "Multiple regions down — memory availability may be at risk.";

        // Run the official CockroachDB Agent Skill health-check procedure for
        // this cluster's tier and cite it — the diagnosis follows a published,
        // vendor-maintained operational skill, not ad-hoc queries.
        let skillReport = "";
        try {
          const s = await standardTierHealthCheck();
          const checkLines = s.checks.map(
            (c) => `  ${c.ok ? "ok" : "FAIL"} ${c.name}: ${c.detail}`,
          );
          skillReport =
            `\nPer ${s.citation}:\n${checkLines.join("\n")}\n` +
            (s.allOk ? "All skill checks pass." : "Some skill checks did not pass — noted above.");
        } catch {
          skillReport = "\n(Skill-based health checks unavailable this turn.)";
        }

        return (
          `Memory-layer health (gateway: ${h.gatewayRegion}, survival goal: ${h.survivalGoal}, ` +
          `${h.totalMemories} memories):\n${lines.join("\n")}\n${verdict}${skillReport}`
        );
      },
    });
  }

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
        // Read-only is enforced two ways: mcpRunSql validates the statement
        // (single SELECT/WITH/SHOW/EXPLAIN, no embedded DML) before it leaves
        // the client, and it routes only to the MCP server's read-only tools.
        return mcpRunSql(String(input.sql ?? ""));
      },
    });
  }

  return tools;
}
