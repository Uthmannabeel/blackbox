import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Survivability — we killed the primary region",
  description:
    "On a nine-node, three-region cluster we drained the primary region with thousands of memories loaded. Recall kept answering; writes kept committing; nothing was lost.",
};

export default function Survivability() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="eyebrow">The proof</div>
          <h1>We killed the primary region. The memory survived.</h1>
          <p className="lede">
            Survivability is easy to claim and hard to show. So we built a nine-node, three-region
            cluster and drained every node in the database&rsquo;s primary region while thousands of
            memories were in place — then asked the agent to keep working.
          </p>
        </div>
      </header>

      <section className="bordered">
        <div className="wrap">
          <div className="metrics">
            <div className="metric">
              <div className="v">3 / 3</div>
              <div className="l">regions serving before the drill</div>
            </div>
            <div className="metric">
              <div className="v">100%</div>
              <div className="l">memories readable with the primary region down</div>
            </div>
            <div className="metric">
              <div className="v">0</div>
              <div className="l">rows lost — writes to the dead region still committed</div>
            </div>
          </div>
        </div>
      </section>

      {/* what happened */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The drill</div>
            <h2>What actually happened.</h2>
          </div>
          <div className="grid grid-3">
            <div className="card step">
              <div className="n">Before</div>
              <h3>Thousands of memories, three regions</h3>
              <p>Incidents, runbooks, and the agent&rsquo;s thought stream distributed evenly across us-east, eu-west, and ap-south, each pinned to its home region.</p>
            </div>
            <div className="card step">
              <div className="n">During</div>
              <h3>Primary region drained</h3>
              <p>Every node in the primary region taken offline. Reads of rows homed there kept answering from surviving replicas; recall never returned an error.</p>
            </div>
            <div className="card step">
              <div className="n">And writes</div>
              <h3>New memory to a dead region</h3>
              <p>A memory homed in the downed region was written and committed — quorum reached from the two surviving regions. Zero data loss on restore.</p>
            </div>
          </div>
        </div>
      </section>

      {/* explain */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The evidence</div>
            <h2>Recall is served by the distributed vector index.</h2>
            <p>
              The query plan shows a vector search over the C-SPANN index, fanning across a prefix
              span per region — distributed approximate nearest-neighbour, not a full scan.
            </p>
          </div>
          <pre className="codeblock" style={{ margin: 0 }}>
{`> EXPLAIN SELECT id FROM incidents ORDER BY embedding <-> $1 LIMIT 5;

  • top-k  (k: 5)
  └── • lookup join  (incidents@incidents_pkey)
      └── • vector search
            table: incidents@incidents_embedding_idx
            prefix spans: [/'aws-ap-south-1'] [/'aws-eu-west-1'] [/'aws-us-east-1']`}
          </pre>
          <p className="muted" style={{ marginTop: 16, fontSize: 13.5, fontFamily: "var(--font-mono)" }}>
            Reproducible from the repo: a scripted `cockroach demo --demo-locality` rig with a driver
            that drains real nodes on command.
          </p>
        </div>
      </section>

      {/* honesty */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The fine print</div>
            <h2>What&rsquo;s real, stated plainly.</h2>
            <p>
              Per-node kill is demonstrated on a local nine-node rig, where raw node liveness is
              observable. On managed CockroachDB Cloud, node-level control isn&rsquo;t exposed to
              tenants — there, survivability is a property of the database configuration
              (<code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>SURVIVE REGION FAILURE</code>),
              and the console&rsquo;s failure drill runs a live exclusion query to show surviving
              regions still answer. Both are shown; neither is faked.
            </p>
          </div>
          <div className="hero-cta">
            <Link href="/console" className="btn btn-primary">
              Run the failure drill yourself
            </Link>
            <a href="https://github.com/Uthmannabeel/blackbox/tree/main/infra/chaos" className="btn btn-ghost">
              Read the chaos rig
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
