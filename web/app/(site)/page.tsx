import Link from "next/link";
import { RecorderStrip } from "../components/RecorderStrip";
import { LiveStat } from "../components/LiveStat";
import { CapabilityBento } from "../components/CapabilityBento";

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

      {/* capabilities */}
      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Capabilities</div>
            <h2>Agent memory is a distributed-systems problem.</h2>
            <p>
              An incident copilot is only trustworthy if its memory is available during a failure,
              consistent across regions, and compliant with where data may live. Bolt a vector store
              onto a cache onto a state store and none of that holds when a region goes dark.
              BlackBox runs Claude via Amazon Bedrock over one system of record — and everything
              below reads from the production cluster.
            </p>
          </div>
          <CapabilityBento />
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
