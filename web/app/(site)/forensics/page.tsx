import type { Metadata } from "next";
import { ForensicsReplay } from "@/app/components/ForensicsReplay";

export const metadata: Metadata = {
  title: "Memory forensics — replay a recall against the past",
  description:
    "What did the agent know, and when did it know it? Re-run any recall AS OF SYSTEM TIME and diff it against the present — no backups, no separate audit store.",
};

export default function Forensics() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="eyebrow">The flight recorder, replayed</div>
          <h1>What did the agent know — and when did it know it?</h1>
          <p className="lede">
            When an agent makes a call mid-incident, the only fair way to judge that call is
            against the memory it had <i>at that moment</i> — not the memory it has now. BlackBox
            answers this with the database itself: the same consolidated recall the agent runs
            live is re-run inside an <span className="mono">AS OF SYSTEM TIME</span> transaction,
            and diffed against the present. No backups. No separate audit store. The memory is
            its own forensic record.
          </p>
        </div>
      </header>

      <section className="bordered">
        <div className="wrap">
          <ForensicsReplay />
        </div>
      </section>

      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">Why this is hard anywhere else</div>
            <h2>Point-in-time recall is a database property.</h2>
          </div>
          <div className="grid grid-3">
            <div className="card">
              <div className="k">Consistent, not reconstructed</div>
              <h3>A snapshot, not a guess</h3>
              <p>
                The historical read is a consistent transaction at that timestamp — episodes,
                runbooks, and totals all from the same instant. Replaying from application logs
                reconstructs an approximation; this reads the actual past.
              </p>
            </div>
            <div className="card">
              <div className="k">Same code path</div>
              <h3>The recall is the recall</h3>
              <p>
                The replay runs the live system&rsquo;s own consolidation and hygiene-aware
                ranking — distance discounted by confidence — so &ldquo;what it knew then&rdquo;
                is computed exactly the way the agent computed it.
              </p>
            </div>
            <div className="card">
              <div className="k">Audit answers</div>
              <h3>Blame the memory, or clear it</h3>
              <p>
                &ldquo;The agent missed the fix&rdquo; and &ldquo;the fix had not been learned
                yet&rdquo; are different verdicts. The diff shows lessons learned since, recurrence
                counts rising, and confidence earned or decayed — with timestamps.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
