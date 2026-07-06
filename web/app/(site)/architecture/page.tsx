import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Architecture — why CockroachDB",
  description:
    "Regional-by-row survivable memory, distributed vector indexing, and one system of record — the capabilities BlackBox is designed around.",
};

function Arrow() {
  return (
    <div className="dconn" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v16M6 14l6 6 6-6" />
      </svg>
    </div>
  );
}

export default function Architecture() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="eyebrow">Architecture</div>
          <h1>Not a vector store you could swap for anything.</h1>
          <p className="lede">
            BlackBox is designed around capabilities only CockroachDB brings together in a single
            system of record. This is the answer to the question every judge asks: why this database?
          </p>
        </div>
      </header>

      {/* spec table */}
      <section className="bordered">
        <div className="wrap">
          <div className="spec">
            <div className="spec-row">
              <div><code>REGIONAL BY ROW</code></div>
              <div>
                <div className="cap">Data residency, by row.</div>
                <p>Each memory is pinned to its home region via <code>crdb_region</code>. An EU incident&rsquo;s data physically stays in the EU; local reads stay fast. One logical database, per-row domiciling — no second system.</p>
              </div>
            </div>
            <div className="spec-row">
              <div><code>SURVIVE REGION FAILURE</code></div>
              <div>
                <div className="cap">Memory that outlives the outage.</div>
                <p>Lose an entire cloud region and the memory database stays readable and writable from surviving replicas, strongly consistent, with no data loss. The reason this runs here and not on a single-region vector store.</p>
              </div>
            </div>
            <div className="spec-row">
              <div><code>VECTOR INDEX — C-SPANN</code></div>
              <div>
                <div className="cap">Distributed approximate nearest-neighbour.</div>
                <p>Region-prefixed vector indexes keep each region&rsquo;s k-means tree co-located with its data. Semantic recall over thousands of incidents, answered locally and survivably, using pgvector-compatible operators.</p>
              </div>
            </div>
            <div className="spec-row">
              <div><code>Managed MCP Server</code></div>
              <div>
                <div className="cap">The agent reads its own database.</div>
                <p>A managed endpoint exposes read-only SQL over the Model Context Protocol. The agent introspects the live cluster it operates — schema, health, running queries, its own memory counts.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* diagram */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">System</div>
            <h2>How the pieces fit.</h2>
          </div>
          <div className="diagram">
            <div className="dnode">
              <span className="dlabel">Operator</span>
              <span><span className="dtitle">Console</span> &middot; <span className="ddesc">Next.js — chat, incident timeline, survivability panel</span></span>
            </div>
            <Arrow />
            <div className="dnode">
              <span className="dlabel">Agent</span>
              <span><span className="dtitle">Reason &harr; recall &harr; act loop</span> &middot; <span className="ddesc">Claude on Amazon Bedrock, typed tool use</span></span>
            </div>
            <Arrow />
            <div className="dnode">
              <span className="dlabel">Embeddings</span>
              <span><span className="dtitle">Titan Text Embeddings v2</span> &middot; <span className="ddesc">1024-dim vectors for every memory</span></span>
            </div>
            <Arrow />
            <div className="dnode recorder-node">
              <span className="dlabel">Memory</span>
              <span>
                <span className="dtitle">CockroachDB Cloud — 3 regions</span> &middot;{" "}
                <span className="ddesc">REGIONAL BY ROW &middot; SURVIVE REGION FAILURE &middot; distributed vector indexes. Introspected by the agent via the Managed MCP Server.</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* schema */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The schema</div>
            <h2>The whole idea, in one table definition.</h2>
            <p>
              Every memory table looks like this: a region-partitioned primary key, a 1024-dim vector
              column, and a distributed vector index prefixed by region.
            </p>
          </div>
          <pre className="codeblock" style={{ margin: 0 }}>
{`ALTER DATABASE blackbox SURVIVE REGION FAILURE;

CREATE TABLE incidents (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    service_id   UUID NOT NULL,
    title        STRING NOT NULL,
    summary      STRING NOT NULL,
    resolution   STRING,
    embedding    VECTOR(1024),              -- Titan v2
    crdb_region  crdb_internal_region NOT NULL
                 DEFAULT gateway_region()::crdb_internal_region,
    CONSTRAINT incidents_pkey PRIMARY KEY (crdb_region, id),
    -- distributed ANN index, co-located per region
    VECTOR INDEX incidents_embedding_idx (crdb_region, embedding)
) LOCALITY REGIONAL BY ROW;`}
          </pre>
        </div>
      </section>

      {/* why not X */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">The comparison</div>
            <h2>Why not a dedicated vector database?</h2>
          </div>
          <div className="compare">
            <div className="them">
              <div className="head">A bolted-together stack</div>
              <ul>
                <li>Vector DB + cache + relational state store to keep in sync</li>
                <li>Single-region, or eventual consistency across regions</li>
                <li>Data residency needs a separate database per region</li>
                <li>An outage takes the agent&rsquo;s memory with it</li>
                <li>Live state and recalled memory can disagree mid-incident</li>
              </ul>
            </div>
            <div className="us">
              <div className="head">BlackBox on CockroachDB</div>
              <ul>
                <li>One system of record — vectors and transactional state together</li>
                <li>Strongly consistent across three regions</li>
                <li>Residency is a per-row property, not a deployment</li>
                <li>Survives a full region loss with zero data loss</li>
                <li>The agent can query its own memory to verify itself</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* production readiness */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Production readiness</div>
            <h2>Built like it will be operated.</h2>
          </div>
          <div className="grid grid-3">
            <div className="card">
              <div className="k">Security</div>
              <h3>Guarded by default</h3>
              <p>Read-only, statement-checked MCP access; parameterised SQL throughout; TLS to the cluster; least-privilege SQL user.</p>
            </div>
            <div className="card">
              <div className="k">Reliability</div>
              <h3>Fails soft</h3>
              <p>Exponential backoff on embedding throttles; idempotent writes; the agent is stateless — all durable state lives in CockroachDB.</p>
            </div>
            <div className="card">
              <div className="k">Observability</div>
              <h3>Every action is an event</h3>
              <p>Each tool call and result is inspectable; every memory is queryable; a real test suite covers recall, the loop, and rate limiting.</p>
            </div>
          </div>
          <div style={{ marginTop: 28 }}>
            <Link href="/survivability" className="btn btn-primary">
              See the survivability test
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
