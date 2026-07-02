import {
  clusterHealth,
  createMemoryService,
  isMock,
  type IMemoryService,
  type Severity,
} from "@blackbox/memory";
import type { Agent, AgentEvent, AgentResult } from "./agent.js";

/**
 * Offline, scripted stand-in for BlackBoxAgent. It exercises the *real* memory
 * layer (recall + writes) but replaces Bedrock reasoning with deterministic
 * synthesis, so the full UX runs without any cloud credentials.
 */
export class MockAgent implements Agent {
  private readonly memory: IMemoryService;
  private readonly sessionId: string;
  private _incidentId: string | null = null;

  constructor(opts: { sessionId: string; memory?: IMemoryService }) {
    this.sessionId = opts.sessionId;
    this.memory = opts.memory ?? createMemoryService();
  }

  get currentIncidentId(): string | null {
    return this._incidentId;
  }

  async chat(userMessage: string): Promise<AgentResult> {
    const events: AgentEvent[] = [];

    await this.memory.remember({
      sessionId: this.sessionId,
      incidentId: this._incidentId,
      kind: "user_msg",
      content: userMessage,
      importance: 0.6,
    });

    // Self-diagnosis path: questions about the agent's own memory health.
    if (
      !isMock() &&
      /\b(your memory|memory (ok|okay|health|layer)|region (down|outage|offline)|are you (ok|okay|healthy)|diagnose)\b/i.test(
        userMessage,
      )
    ) {
      events.push({ type: "tool_call", tool: "diagnose_memory", input: {} });
      try {
        const h = await clusterHealth();
        const lines = h.regions.map((r) => {
          const status =
            r.liveNodes === r.totalNodes ? "healthy" : r.liveNodes === 0 ? "REGION DOWN" : "degraded";
          return `• ${r.region}: ${r.liveNodes}/${r.totalNodes} nodes live — ${status}`;
        });
        const down = h.regions.filter((r) => r.liveNodes === 0);
        const verdict =
          down.length === 0
            ? "All regions healthy — my memory is fully replicated."
            : `⚠️ ${down.map((d) => d.region).join(", ")} is DOWN — but my survival goal is '${h.survivalGoal}', so all ${h.totalMemories} memories remain readable and writable from surviving replicas. I never lost a thing.`;
        const reply = `**Memory self-diagnosis** (gateway: ${h.gatewayRegion}):\n${lines.join("\n")}\n\n${verdict}`;
        events.push({ type: "tool_result", tool: "diagnose_memory", result: "health snapshot" });
        await this.memory.remember({
          sessionId: this.sessionId,
          incidentId: this._incidentId,
          kind: "observation",
          content: `diagnose_memory -> ${verdict}`,
          importance: 0.8,
        });
        return { reply, events };
      } catch (err) {
        return {
          reply: `⚠️ Could not reach my memory layer for diagnosis: ${(err as Error).message}`,
          events,
        };
      }
    }

    // Resolution path: the operator reports the fix — close the incident and
    // run the LEARNING LOOP (same behavior as the real agent's tool handler).
    if (
      this._incidentId &&
      /\b(resolved?|fixed|mark (it|this).*(resolved|fixed)|mitigated)\b/i.test(userMessage)
    ) {
      const id = this._incidentId;
      const resolution = userMessage;
      events.push({ type: "tool_call", tool: "resolve_incident", input: { resolution } });
      await this.memory.resolveIncident(id, resolution);
      const incident = await this.memory.getIncident(id);
      const title = incident?.title ?? "untitled incident";
      await this.memory.upsertRunbook({
        title: `Learned runbook: ${title}`,
        body: `Distilled from incident ${id}:\n${resolution}`,
        tags: ["learned", "auto-postmortem"],
      });
      await this.memory.remember({
        sessionId: this.sessionId,
        incidentId: id,
        kind: "reflection",
        content: `Resolved "${title}". Learned: ${resolution}`,
        importance: 0.9,
      });
      events.push({
        type: "tool_result",
        tool: "resolve_incident",
        result: `resolved ${id}; learned runbook distilled`,
      });
      this._incidentId = null;
      const reply =
        `✅ **Incident resolved** and committed to episodic memory.\n\n` +
        `📚 **Learning loop:** I distilled the fix into a new runbook — *"Learned runbook: ${title}"*. ` +
        `The next time something similar happens, I'll recall exactly what fixed it this time.`;
      await this.memory.remember({
        sessionId: this.sessionId,
        kind: "agent_msg",
        content: reply,
        importance: 0.6,
      });
      return { reply, events };
    }

    // 1. Recall similar past incidents.
    events.push({ type: "tool_call", tool: "recall_similar_incidents", input: { situation: userMessage } });
    const incidents = await this.memory.recallSimilarIncidents(userMessage, 3);
    events.push({
      type: "tool_result",
      tool: "recall_similar_incidents",
      result: incidents.map((h) => h.item.title).join("; ") || "none",
    });

    // 2. Recall relevant runbooks.
    events.push({ type: "tool_call", tool: "recall_runbooks", input: { situation: userMessage } });
    const runbooks = await this.memory.recallRunbooks(userMessage, 2);
    events.push({
      type: "tool_result",
      tool: "recall_runbooks",
      result: runbooks.map((h) => h.item.title).join("; ") || "none",
    });

    const top = incidents[0]?.item;
    const rb = runbooks[0]?.item;
    const severity = guessSeverity(userMessage);

    // 3. Open an incident — resolve the service by name, like the real agent.
    const services = await this.memory.listServices();
    const named = services.find((s) => userMessage.toLowerCase().includes(s.name));
    const svc = named ?? (await this.memory.resolveService("unknown-service"));

    events.push({
      type: "tool_call",
      tool: "open_incident",
      input: { service: svc.name, severity },
    });
    const inc = await this.memory.recordIncident({
      serviceId: svc.id,
      title: firstLine(userMessage),
      summary: userMessage,
      severity,
    });
    this._incidentId = inc.id;
    events.push({ type: "tool_result", tool: "open_incident", result: `opened ${inc.id} in ${inc.region}` });

    // 4. Persist live state.
    const hypotheses = top ? [`Likely same class as: "${top.title}"`] : ["Novel pattern; gather more signal."];
    const nextSteps = rb ? rb.body.split(". ").slice(0, 3).map((s) => s.trim()).filter(Boolean) : ["Collect metrics/logs."];
    events.push({ type: "tool_call", tool: "update_incident_state", input: { phase: "diagnose" } });
    await this.memory.updateIncidentState({
      incidentId: inc.id,
      phase: "diagnose",
      hypotheses,
      actionsTaken: [],
      nextSteps,
    });
    events.push({ type: "tool_result", tool: "update_incident_state", result: "state saved (phase: diagnose)" });

    // 5. Synthesize a reply from recalled memory.
    const reply = this.synthesize(userMessage, severity, top, rb, incidents[0]?.distance);

    await this.memory.remember({
      sessionId: this.sessionId,
      incidentId: this._incidentId,
      kind: "agent_msg",
      content: reply,
      importance: 0.6,
    });

    return { reply, events };
  }

  private synthesize(
    msg: string,
    severity: Severity,
    top: { title: string; resolution: string | null; region: string } | undefined,
    rb: { title: string; body: string } | undefined,
    distance?: number,
  ): string {
    const lines: string[] = [];
    lines.push(`**Triage (${severity}).** Opened an incident and recorded live state to durable memory.`);
    if (top) {
      const conf = distance !== undefined ? ` (similarity ${(1 - distance / 2).toFixed(2)})` : "";
      lines.push(
        `\n📼 **Institutional memory${conf}:** this closely matches a past incident — *"${top.title}"* (memory pinned to ${top.region}).`,
      );
      if (top.resolution) lines.push(`What fixed it last time: ${top.resolution}`);
    } else {
      lines.push("\n📼 No close match in past incidents — treating as a novel pattern.");
    }
    if (rb) {
      lines.push(`\n📖 **Applicable runbook — ${rb.title}:**\n${rb.body}`);
    }
    lines.push(
      "\n_(mock mode — reasoning is scripted; with Bedrock configured the agent generates this live.)_",
    );
    return lines.join("\n");
  }
}

function firstLine(s: string): string {
  return (s.split(/[.\n]/)[0] ?? s).slice(0, 120);
}

function guessSeverity(s: string): Severity {
  const t = s.toLowerCase();
  if (/(down|outage|cannot|can't|login fail|data loss|payment)/.test(t)) return "SEV1";
  if (/(spike|latency|error|5xx|timeout|maxed)/.test(t)) return "SEV2";
  return "SEV3";
}
