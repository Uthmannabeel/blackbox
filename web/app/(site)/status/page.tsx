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
    </>
  );
}
