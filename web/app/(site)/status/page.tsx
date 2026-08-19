import type { Metadata } from "next";
import { StatusBoard } from "@/app/components/StatusBoard";

export const metadata: Metadata = {
  title: "Status — live proofs, read from the cluster",
  description:
    "The operations page: memory totals, region health, the survival ledger, the red-team wall, and the promotion-certificate chain — all read live from the production cluster.",
};

export default function Status() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="eyebrow">Operations</div>
          <h1>Status: every claim, measured live.</h1>
          <p className="lede">
            Infrastructure earns trust with a status page, not a slogan. Everything below is read
            from the production cluster when you load this page — region health, the survival
            ledger, the red-team tally, and the certificate chain — plus an independent external
            probe that checks this site twice a day and files its results in public.
          </p>
        </div>
      </header>

      <section className="bordered">
        <div className="wrap">
          <StatusBoard />
        </div>
      </section>

      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Trust, but verify</div>
            <h2>Every proof, from your own terminal.</h2>
            <p>
              Nothing on this page requires believing the page. The same endpoints it reads are
              public and unauthenticated — run them yourself:
            </p>
          </div>
          <pre className="curl-block mono">{`# live cluster health — memories, regions, vector-search latency
curl https://blackbox-web-eight.vercel.app/api/stats

# the survival ledger — automated region drills, memories lost
curl https://blackbox-web-eight.vercel.app/api/drills

# the red-team wall — poisoning attempts and breaches (kept at zero)
curl https://blackbox-web-eight.vercel.app/api/poison

# the promotion-certificate chain, re-verified on every read
curl https://blackbox-web-eight.vercel.app/api/certificates

# race one query across all three regional gateways (follower reads)
curl -X POST https://blackbox-web-eight.vercel.app/api/race \\
  -H 'Content-Type: application/json' \\
  -d '{"query":"checkout-api connection pool exhausted"}'

# forensic replay — what did the agent know an hour ago?
curl -X POST https://blackbox-web-eight.vercel.app/api/forensics \\
  -H 'Content-Type: application/json' \\
  -d '{"query":"checkout-api p99 latency spike","minutesAgo":60}'`}</pre>
        </div>
      </section>
    </>
  );
}
