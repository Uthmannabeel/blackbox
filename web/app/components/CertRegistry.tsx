"use client";

import { useEffect, useState } from "react";

interface Cert {
  seq: number;
  runbookId: string;
  title: string;
  promotedAt: string;
  certHash: string;
  prevHash: string;
  chainOk: boolean;
  bodyUnchanged: boolean;
}

export function CertRegistry() {
  const [certs, setCerts] = useState<Cert[] | null>(null);
  const [chainVerified, setChainVerified] = useState(true);

  useEffect(() => {
    fetch("/api/certificates")
      .then((r) => r.json())
      .then((d) => {
        setCerts(d.certificates ?? []);
        setChainVerified(Boolean(d.chainVerified));
      })
      .catch(() => setCerts([]));
  }, []);

  return (
    <div className="poison-wall">
      <div className="k">
        Promotion receipts — every lesson that ever entered recall, hash-chained
      </div>
      {certs === null ? (
        <p className="mono muted">loading…</p>
      ) : certs.length ? (
        <>
          <p className={chainVerified ? "v-clean mono" : "v-breach"}>
            {chainVerified
              ? "chain verified on this read — no promotion altered, reordered, or removed"
              : "⚠ chain verification FAILED — promotion history has been tampered with"}
          </p>
          <ul>
            {certs.map((c) => (
              <li key={c.seq}>
                <span className={`verdict verdict-sm ${c.chainOk && c.bodyUnchanged ? "v-accepted" : "v-rejected"}`}>
                  {c.chainOk && c.bodyUnchanged ? "VERIFIED" : "TAMPERED"}
                </span>
                <span className="w-text">
                  #{c.seq} · {c.title}
                  <span className="mono muted"> · {c.certHash.slice(0, 12)}… ← {c.prevHash.slice(0, 12)}…</span>
                </span>
                <span className="mono muted w-when">{c.promotedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mono muted">
          no certified promotions yet — the next operator promotion mints certificate #1
        </p>
      )}
    </div>
  );
}
