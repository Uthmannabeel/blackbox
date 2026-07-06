import Link from "next/link";

const REPO = "https://github.com/Uthmannabeel/blackbox";

export function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-col">
            <div className="brand" style={{ marginBottom: 12 }}>
              <span className="mark">
                Black<b>Box</b>
              </span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: "34ch" }}>
              The incident-response agent whose memory survives the outage it&rsquo;s diagnosing.
            </p>
          </div>
          <div className="foot-col">
            <h4>Product</h4>
            <Link href="/product">How it works</Link>
            <Link href="/architecture">Architecture</Link>
            <Link href="/survivability">Survivability</Link>
            <Link href="/console">Live console</Link>
          </div>
          <div className="foot-col">
            <h4>Built on</h4>
            <a href="https://www.cockroachlabs.com/">CockroachDB Cloud</a>
            <a href="https://aws.amazon.com/bedrock/">AWS Bedrock</a>
            <a href="https://modelcontextprotocol.io/">Model Context Protocol</a>
          </div>
          <div className="foot-col">
            <h4>Project</h4>
            <a href={REPO}>GitHub</a>
            <a href={`${REPO}/blob/main/ARCHITECTURE.md`}>Architecture doc</a>
            <a href={`${REPO}/blob/main/FEEDBACK.md`}>Tool feedback</a>
          </div>
        </div>
        <div className="foot-bottom">
          <span>Built for the CockroachDB &times; AWS &ldquo;Build with Agentic Memory&rdquo; hackathon.</span>
          <span className="mono">Apache-2.0</span>
        </div>
      </div>
    </footer>
  );
}
