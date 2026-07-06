import Link from "next/link";
import { RecorderStrip } from "./components/RecorderStrip";
import { LiveStat } from "./components/LiveStat";

const REPO = "https://github.com/Uthmannabeel/blackbox";

export default function Landing() {
  return (
    <>
      <nav className="nav">
        <div className="wrap nav-inner">
          <div className="brand">
            <span className="mark">
              Black<b>Box</b>
            </span>
            <span className="sub">incident memory</span>
          </div>
          <div className="nav-links">
            <a href="#how" className="hide-sm">
              How it works
            </a>
            <a href="#why" className="hide-sm">
              Why CockroachDB
            </a>
            <a href="#proof" className="hide-sm">
              Survivability
            </a>
            <a href={REPO}>GitHub</a>
            <Link href="/console" className="btn btn-primary btn-sm">
              Open console
            </Link>
          </div>
        </div>
      </nav>

      {/* hero */}
      <header className="hero">
        <div className="wrap">
          <div className="eyebrow">CockroachDB &times; AWS — agentic memory</div>
          <h1>Incident memory that survives the outage it&rsquo;s diagnosing.</h1>
          <p className="lede">
            BlackBox is an SRE incident-response agent. Every past incident, runbook, and decision
            it records lives in CockroachDB — globally distributed, strongly consistent, and pinned
            to its home region. When a region fails mid-incident, the agent keeps recalling and keeps
            reasoning. Like a flight recorder, its memory is built to outlast the crash.
          </p>
          <div className="hero-cta">
            <Link href="/console" className="btn btn-primary">
              Open the live console
            </Link>
            <a href="#proof" className="btn btn-ghost">
              See it survive a region failure
            </a>
          </div>
          <LiveStat />
          <div style={{ marginTop: 40 }}>
            <RecorderStrip />
          </div>
        </div>
      </header>

      {/* built on */}
      <section style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Built on
          </div>
          <div className="builton">
            <span className="chip">CockroachDB Cloud</span>
            <span className="chip">Distributed Vector Indexing (C-SPANN)</span>
            <span className="chip">Managed MCP Server</span>
            <span className="chip">AWS Bedrock — Claude</span>
            <span className="chip">Titan Text Embeddings v2</span>
            <span className="chip">Next.js · TypeScript</span>
          </div>
        </div>
      </section>

      {/* problem */}
      <section>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The problem</div>
            <h2>Most agent memory fails exactly when you need it.</h2>
            <p>
              An incident copilot is only trustworthy if its memory is available during a failure,
              consistent across regions, and compliant with where data is allowed to live. Bolt a
              vector store onto a cache onto a state store and none of those hold when a region goes
              dark. BlackBox treats agent memory as what it actually is — a distributed-systems
              problem — and solves it with one database.
            </p>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">How it works</div>
            <h2>A reason &harr; recall &harr; act loop over durable memory.</h2>
            <p>
              The agent runs on Claude via Amazon Bedrock. Every turn it recalls before it reasons,
              acts through typed tools, and writes what it learns back to memory — so the next
              incident starts where the last one ended.
            </p>
          </div>
          <div className="grid grid-4">
            <div className="card step">
              <div className="n">01 · episodic</div>
              <h3>Incidents</h3>
              <p>What happened, when, and how it was resolved — embedded for semantic recall.</p>
            </div>
            <div className="card step">
              <div className="n">02 · procedural</div>
              <h3>Runbooks</h3>
              <p>How to fix classes of problem. Resolutions distil into new runbooks automatically.</p>
            </div>
            <div className="card step">
              <div className="n">03 · working</div>
              <h3>Thought stream</h3>
              <p>The agent&rsquo;s own observations, actions, and reflections, importance-weighted.</p>
            </div>
            <div className="card step">
              <div className="n">04 · transactional</div>
              <h3>Live state</h3>
              <p>Phase, hypotheses, and next steps for an in-flight incident — strongly consistent.</p>
            </div>
          </div>
        </div>
      </section>

      {/* why cockroachdb */}
      <section id="why">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Why CockroachDB</div>
            <h2>Not a vector store you could swap for anything.</h2>
            <p>
              BlackBox is designed around the capabilities only CockroachDB brings together in one
              system of record.
            </p>
          </div>
          <div className="why">
            <div className="why-row">
              <div>
                <code>REGIONAL BY ROW</code>
              </div>
              <div>
                <div className="cap">Data residency, by row.</div>
                <p>
                  Each memory is pinned to its home region. An EU incident&rsquo;s data physically
                  stays in the EU, and local reads stay fast — one logical database, per-row
                  domiciling.
                </p>
              </div>
            </div>
            <div className="why-row">
              <div>
                <code>SURVIVE REGION FAILURE</code>
              </div>
              <div>
                <div className="cap">Memory that outlives the outage.</div>
                <p>
                  Lose an entire cloud region and the agent&rsquo;s memory stays readable and
                  writable from surviving replicas, with no data loss. The reason this runs here and
                  not on a single-region vector store.
                </p>
              </div>
            </div>
            <div className="why-row">
              <div>
                <code>VECTOR INDEX (C-SPANN)</code>
              </div>
              <div>
                <div className="cap">Distributed semantic recall.</div>
                <p>
                  Region-prefixed vector indexes keep each region&rsquo;s k-means tree co-located
                  with its data. &ldquo;Have we seen this before?&rdquo; over thousands of incidents,
                  answered locally and survivably.
                </p>
              </div>
            </div>
            <div className="why-row">
              <div>
                <code>Managed MCP Server</code>
              </div>
              <div>
                <div className="cap">The agent can read its own database.</div>
                <p>
                  Through CockroachDB&rsquo;s Managed MCP Server, the agent runs read-only SQL
                  against the live cluster it operates — inspecting schema, health, and its own
                  memory during reasoning.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* survivability proof */}
      <section id="proof">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The proof</div>
            <h2>We killed the primary region with the memory loaded.</h2>
            <p>
              On a nine-node, three-region cluster, we drained every node in the database&rsquo;s
              primary region while thousands of memories were in place. Recall kept answering.
              Writes homed in the dead region kept committing. Nothing was lost.
            </p>
          </div>
          <div className="metrics">
            <div className="metric">
              <div className="v">3 / 3</div>
              <div className="l">regions serving before failure</div>
            </div>
            <div className="metric">
              <div className="v">100%</div>
              <div className="l">memories readable with the primary region down</div>
            </div>
            <div className="metric">
              <div className="v">0</div>
              <div className="l">rows lost — writes to the dead region committed</div>
            </div>
          </div>
          <div className="codeblock" aria-label="Query plan showing the distributed vector index">
            <span className="c"># EXPLAIN — recall is served by the distributed vector index, per region</span>
            <br />
            &bull; vector search
            <br />
            &nbsp;&nbsp;table: incidents@<span className="hl">incidents_embedding_idx</span>
            <br />
            &nbsp;&nbsp;prefix spans: [/&lsquo;aws-ap-south-1&rsquo;] [/&lsquo;aws-eu-west-1&rsquo;]
            [/&lsquo;aws-us-east-1&rsquo;]
          </div>
        </div>
      </section>

      {/* agentic */}
      <section>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">More than retrieval</div>
            <h2>Memory that compounds — and an agent that can triage itself.</h2>
          </div>
          <div className="grid grid-3">
            <div className="card">
              <div className="k">Learning loop</div>
              <h3>It gets smarter per incident</h3>
              <p>
                Resolving an incident distils the fix into a new runbook. The next similar incident
                recalls the solution the agent just learned — not a chat log, compounding memory.
              </p>
            </div>
            <div className="card">
              <div className="k">Self-diagnosis</div>
              <h3>It knows the health of its own memory</h3>
              <p>
                The agent&rsquo;s memory is a CockroachDB cluster, and it can inspect that
                cluster&rsquo;s region health mid-outage — reporting which regions are down and why
                its memory is still intact.
              </p>
            </div>
            <div className="card">
              <div className="k">Production-shaped</div>
              <h3>Tested, guarded, observable</h3>
              <p>
                Read-only MCP access, parameterised SQL, rate limiting, security headers, and a real
                test suite. Every tool call is an inspectable event.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* cta */}
      <section>
        <div className="wrap" style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(1.8rem, 1.3rem + 1.6vw, 2.6rem)", maxWidth: "20ch", margin: "0 auto" }}>
            Watch an agent remember through a region failure.
          </h2>
          <div className="hero-cta" style={{ justifyContent: "center", marginTop: 28 }}>
            <Link href="/console" className="btn btn-primary">
              Open the live console
            </Link>
            <a href={REPO} className="btn btn-ghost">
              Read the source
            </a>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot-inner">
          <div>
            <div className="brand" style={{ marginBottom: 8 }}>
              <span className="mark">
                Black<b>Box</b>
              </span>
            </div>
            <div>Built for the CockroachDB &times; AWS &ldquo;Build with Agentic Memory&rdquo; hackathon. Apache-2.0.</div>
          </div>
          <div className="foot-links">
            <Link href="/console">Console</Link>
            <a href={REPO}>GitHub</a>
            <a href={`${REPO}/blob/main/ARCHITECTURE.md`}>Architecture</a>
            <a href={`${REPO}/blob/main/FEEDBACK.md`}>Feedback</a>
          </div>
        </div>
      </footer>
    </>
  );
}
