import Link from "next/link";
import { RecorderStrip } from "../components/RecorderStrip";
import { LiveStat } from "../components/LiveStat";

export default function Home() {
  return (
    <>
      {/* hero */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">CockroachDB &times; AWS — agentic memory</div>
            <h1 style={{ marginTop: 16 }}>Incident memory that survives the outage.</h1>
            <p className="lede">
              BlackBox is an SRE incident-response agent. Every incident, runbook, and decision it
              records lives in CockroachDB — globally distributed, strongly consistent, pinned to its
              home region. When a region fails mid-incident, the agent keeps recalling and keeps
              reasoning.
            </p>
            <div className="hero-cta">
              <Link href="/console" className="btn btn-primary">
                Open the live console
              </Link>
              <Link href="/survivability" className="btn btn-ghost">
                See it survive a region failure
              </Link>
            </div>
            <LiveStat />
          </div>
          <div>
            <RecorderStrip />
          </div>
        </div>
      </header>

      {/* built on */}
      <section className="bordered" style={{ paddingTop: 36, paddingBottom: 36 }}>
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Built on
          </div>
          <div className="builton">
            <span className="chip">CockroachDB Cloud</span>
            <span className="chip">Distributed Vector Indexing</span>
            <span className="chip">Managed MCP Server</span>
            <span className="chip">AWS Bedrock — Claude</span>
            <span className="chip">Titan Text Embeddings v2</span>
            <span className="chip">Next.js · TypeScript</span>
          </div>
        </div>
      </section>

      {/* the idea */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The idea</div>
            <h2>Agent memory is a distributed-systems problem.</h2>
            <p>
              An incident copilot is only trustworthy if its memory is available during a failure,
              consistent across regions, and compliant with where data may live. Bolt a vector store
              onto a cache onto a state store and none of that holds when a region goes dark. BlackBox
              solves it with one system of record.
            </p>
          </div>
          <div className="grid grid-3">
            <div className="card">
              <div className="k">Available</div>
              <h3>Survives region failure</h3>
              <p>
                Lose an entire cloud region and the agent&rsquo;s memory stays readable and writable
                from surviving replicas, with no data loss.
              </p>
            </div>
            <div className="card">
              <div className="k">Consistent</div>
              <h3>One system of record</h3>
              <p>
                Vector memory and strongly-consistent live incident state in the same database — no
                stitching, no split-brain during a crisis.
              </p>
            </div>
            <div className="card">
              <div className="k">Compliant</div>
              <h3>Region-pinned by row</h3>
              <p>
                Each memory is domiciled in its home region. An EU incident&rsquo;s data physically
                stays in the EU — data residency without a second database.
              </p>
            </div>
          </div>
          <div style={{ marginTop: 28 }}>
            <Link href="/architecture" className="btn btn-ghost">
              Why CockroachDB, in depth
            </Link>
          </div>
        </div>
      </section>

      {/* what it does */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">What it does</div>
            <h2>Recall before it reasons. Remember what it learns.</h2>
            <p>
              The agent runs on Claude via Amazon Bedrock, driving a typed reason &harr; recall &harr;
              act loop over durable memory — and it gets sharper with every incident it resolves.
            </p>
          </div>
          <div className="grid grid-3">
            <div className="card">
              <div className="k">Recall</div>
              <h3>Institutional memory</h3>
              <p>Semantic search over every past incident and runbook, in milliseconds, per region.</p>
            </div>
            <div className="card">
              <div className="k">Learn</div>
              <h3>Compounding runbooks</h3>
              <p>Each resolution distils into a new runbook the next similar incident will recall.</p>
            </div>
            <div className="card">
              <div className="k">Introspect</div>
              <h3>Reads its own cluster</h3>
              <p>Through the Managed MCP Server, the agent inspects the very database it runs on.</p>
            </div>
          </div>
          <div style={{ marginTop: 28 }}>
            <Link href="/product" className="btn btn-ghost">
              How the agent works
            </Link>
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="bordered cta-band">
        <div className="wrap">
          <h2>Watch an agent remember through a region failure.</h2>
          <div className="hero-cta" style={{ justifyContent: "center", marginTop: 26 }}>
            <Link href="/console" className="btn btn-primary">
              Open the live console
            </Link>
            <a href="https://github.com/Uthmannabeel/blackbox" className="btn btn-ghost">
              Read the source
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
