import type { Metadata } from "next";
import { PoisonChallenge, PoisonStats } from "@/app/components/PoisonChallenge";

export const metadata: Metadata = {
  title: "Poison me — the public red-team challenge",
  description:
    "Try to poison BlackBox's memory. Every attempt runs the real hygiene gate — content filter, duplicate consolidation, contradiction check, trust boundary — and every verdict is public.",
};

export default function Poison() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="eyebrow">The challenge</div>
          <h1>Poison me.</h1>
          <p className="lede">
            A memory that lets anyone teach it is a memory you cannot trust. So here is the write
            path, in public: teach this agent something false, malicious, or subtly wrong. Your
            attempt runs the exact code path the agent itself uses to learn — and you get to watch
            the gate catch it, with a live recall query as the receipt.
          </p>
        </div>
      </header>

      <section className="bordered">
        <div className="wrap">
          <PoisonStats />
        </div>
      </section>

      <section className="bordered">
        <div className="wrap">
          <PoisonChallenge />
        </div>
      </section>

      <section className="bordered">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">How the gate decides</div>
            <h2>Four ways to lose.</h2>
          </div>
          <div className="grid grid-4">
            <div className="card">
              <div className="k">1 · Content gate</div>
              <h3>Not every string is knowledge</h3>
              <p>
                Deterministic checks refuse writes that cannot be a reusable fix: too short,
                questions posing as answers, unresolved uncertainty, narrated failures.
              </p>
            </div>
            <div className="card">
              <div className="k">2 · Consolidation</div>
              <h3>Duplicates don&rsquo;t multiply</h3>
              <p>
                Within L2 distance 0.45 of existing knowledge, your lesson merges instead of
                duplicating — and untrusted writes cannot reinforce trusted runbooks.
              </p>
            </div>
            <div className="card">
              <div className="k">3 · Contradiction</div>
              <h3>Disagreement is flagged</h3>
              <p>
                Same situation, materially different fix? The write is marked as contradicting its
                neighbour and starts on probation confidence, not as truth.
              </p>
            </div>
            <div className="card">
              <div className="k">4 · Trust boundary</div>
              <h3>Anonymous writes teach nobody</h3>
              <p>
                Everything an unauthenticated session teaches is quarantined: stored, auditable,
                never recalled — until a trusted operator explicitly promotes it.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
