import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Product — how the BlackBox agent works",
  description:
    "A typed reason–recall–act loop over four kinds of durable memory, with a learning loop and cluster self-introspection.",
};

export default function Product() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="eyebrow">Product</div>
          <h1>An agent that recalls before it reasons.</h1>
          <p className="lede">
            BlackBox runs on Claude via Amazon Bedrock and drives a typed reason &harr; recall &harr;
            act loop. Every turn it consults memory, acts through guarded tools, and writes what it
            learns back — so the next incident starts where the last one ended.
          </p>
        </div>
      </header>

      {/* the loop */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The loop</div>
            <h2>Reason, recall, act — then remember.</h2>
          </div>
          <div className="grid grid-4">
            <div className="card step">
              <div className="n">01</div>
              <h3>Recall</h3>
              <p>On any new signal, the agent searches similar past incidents and relevant runbooks before forming a hypothesis.</p>
            </div>
            <div className="card step">
              <div className="n">02</div>
              <h3>Reason</h3>
              <p>It weighs hypotheses against recalled evidence and, when useful, queries the live cluster to check facts.</p>
            </div>
            <div className="card step">
              <div className="n">03</div>
              <h3>Act</h3>
              <p>It opens an incident, tracks transactional state through triage &rarr; diagnose &rarr; mitigate &rarr; resolve.</p>
            </div>
            <div className="card step">
              <div className="n">04</div>
              <h3>Remember</h3>
              <p>Every observation, action, and resolution is written to durable memory, region-pinned, for next time.</p>
            </div>
          </div>
        </div>
      </section>

      {/* memory surfaces */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Memory model</div>
            <h2>Four memory surfaces, one database.</h2>
            <p>
              The full CoALA taxonomy — episodic, procedural/semantic, and working memory — plus
              transactional live state, each a table in CockroachDB, each{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>REGIONAL BY ROW</code>.
            </p>
          </div>
          <div className="grid grid-2">
            <div className="card">
              <div className="k">Episodic</div>
              <h3>incidents</h3>
              <p>What happened, when, and how it was resolved. Embedded with Titan v2 for semantic recall over the whole fleet.</p>
            </div>
            <div className="card">
              <div className="k">Procedural / semantic</div>
              <h3>runbooks</h3>
              <p>
                How to fix classes of problem. Distilled fixes enter through a hygiene gate —
                filtered, deduplicated, contradiction-checked, and confidence-scored — never
                appended blindly.
              </p>
            </div>
            <div className="card">
              <div className="k">Working / long-term</div>
              <h3>agent_memory</h3>
              <p>The agent&rsquo;s own observations, actions, and reflections — importance-weighted so recall favors what mattered.</p>
            </div>
            <div className="card">
              <div className="k">Transactional</div>
              <h3>incident_state</h3>
              <p>Phase, hypotheses, and next steps for an in-flight incident. Strongly consistent, never split-brain.</p>
            </div>
          </div>
        </div>
      </section>

      {/* differentiators */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Beyond retrieval</div>
            <h2>What makes it agentic, not a RAG demo.</h2>
          </div>
          <div className="grid grid-2">
            <div className="card">
              <div className="k">Learning loop</div>
              <h3>It compounds</h3>
              <p>
                Resolve an incident and the fix becomes a runbook. Throw a similar incident minutes
                later and the agent recalls exactly what worked — memory that grows, not a transcript.
              </p>
            </div>
            <div className="card">
              <div className="k">Memory hygiene</div>
              <h3>It audits its own writes</h3>
              <p>
                One bad write can poison a self-improving memory. Learned fixes pass a gate —
                content filter, duplicate consolidation, contradiction check — then earn confidence
                through reinforcement or decay out. Every decision lands in an auditable ledger.
              </p>
            </div>
            <div className="card">
              <div className="k">Self-diagnosis</div>
              <h3>It triages itself</h3>
              <p>
                The agent&rsquo;s memory is a CockroachDB cluster. It can inspect that cluster&rsquo;s
                region health and explain, mid-outage, why its memory is still intact.
              </p>
            </div>
            <div className="card">
              <div className="k">MCP introspection</div>
              <h3>It reads its own database</h3>
              <p>
                Through the CockroachDB Managed MCP Server it runs read-only SQL against the live
                cluster — schema, health, running queries, memory counts.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* tools */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Tool surface</div>
            <h2>Typed tools, not a bash prompt.</h2>
            <p>
              Every capability is a schema-validated tool the harness can gate, render, and audit.
              Cluster access is read-only by construction.
            </p>
          </div>
          <div className="spec">
            {[
              ["recall_similar_incidents", "Semantic search over resolved incidents — the first move on any new problem."],
              ["recall_runbooks", "Retrieve remediation procedures relevant to the current situation."],
              ["open_incident", "Record a confirmed incident by service name, resolved to the fleet registry."],
              ["update_incident_state", "Persist the transactional phase, hypotheses, and next steps."],
              ["resolve_incident", "Close out with a resolution — and distil it into a learned runbook."],
              ["inspect_cluster", "Run read-only SQL against the live cluster via the Managed MCP Server."],
              ["diagnose_memory", "Report per-region health of the agent's own memory layer."],
            ].map(([name, desc]) => (
              <div className="spec-row" key={name}>
                <div>
                  <code>{name}</code>
                </div>
                <div>
                  <p style={{ marginTop: 0 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 28 }}>
            <Link href="/console" className="btn btn-primary">
              Try the agent live
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
