import Link from "next/link";
import { RecorderStrip } from "../components/RecorderStrip";
import { LiveStat } from "../components/LiveStat";
import { CapabilityBento } from "../components/CapabilityBento";
import { REPO } from "@/lib/demoData";

export default function Home() {
  return (
    <>
      {/* hero */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">CockroachDB &times; AWS — agentic memory</div>
            <h1 style={{ marginTop: 16 }}>Agent memory that survives the outage.</h1>
            <p className="lede">
              BlackBox is agentic-memory infrastructure with two properties most agent memories
              lack: it survives a full region failure, and it audits what it lets itself remember —
              every learned fix is gated, deduplicated, and confidence-scored before it can shape
              recall. We prove both with an incident-response agent working a live outage on
              CockroachDB.
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
              An agent&apos;s memory is only trustworthy if it is available during a failure,
              consistent across regions, compliant with where data may live — and honest about what
              it lets itself remember. Bolt a vector store onto a cache onto a state store and none
              of that holds when a region goes dark. BlackBox runs Claude via Amazon Bedrock over
              one system of record — and everything below reads from the production cluster.
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
            <a href={REPO} className="btn btn-ghost">
              Read the source
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
