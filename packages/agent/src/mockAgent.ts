import { createMemoryService, type IMemoryService, type Severity } from "@blackbox/memory";
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
