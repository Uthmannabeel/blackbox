# Record day — turnkey runbook

Everything you need to film the <3-minute demo cleanly. Pair with `VIDEO.md`
(the script/narration); this is the operational checklist.

---

## 0. Decide the recording mode

| Mode | Act II (survive) shows | Effort | Recommended |
|---|---|---|---|
| **A — Live cloud site** | The **simulated** failure drill (a live exclusion query proving surviving regions answer) | Zero setup | For a clean, low-risk take |
| **B — Local chaos rig** | A **real** node-kill (region genuinely goes dark) | ~10 min setup | For the strongest "survive" moment |

You can film Acts I, III, IV, V on the live site and splice a Mode-B clip for
Act II. Never imply a real node-kill you didn't perform — the script wording
already handles the simulated case.

---

## 1. Pre-flight (do this ~15 min before recording)

**Optional but worth it — faster on-camera responses.** Fresh AWS accounts throttle;
bump quotas in AWS console → Service Quotas → Amazon Bedrock:
- `InvokeModel requests per minute` for **Titan Text Embeddings V2**
- `InvokeModel requests per minute` for **Claude** (Sonnet)
Request ~10x; approval is often quick. Without this, replies take ~20s (fine, just slower).

**Readiness check (one command):**
```powershell
cd "C:\Users\Nabeel Uthman\cockroach-ai"
$env:NODE_OPTIONS="--use-system-ca"
node scripts\preflight.mjs
```
Expect `ALL GREEN — 19 passed` (includes the real-postmortem provenance check).
It also *warms* the demo (opens an incident), so time-travel will show a delta.
If a page 500s, wait 60s (cold start) and re-run.

**Screenshot sanity (optional):** `node scripts\shoot.mjs` then eyeball `shots/`.

---

## 2. Warm the demo so time-travel shows change

In the console, before recording Act IV, send one incident and resolve it — this
writes fresh memories "now" so the time-travel slider visibly drops the count
when you rewind 10 minutes. (The pre-flight already sends one; sending one more
live makes the delta bigger.)

---

## 3. Recording setup
- Browser at **1440p**, zoom 100–110%, bookmarks bar hidden, notifications off.
- Pick **one theme** and stay consistent (dark reads well on video; toggle is top-right).
- Open two tabs: **/** (landing) and **/console**. Architecture tab ready for the close.
- Mode B only: start the rig — `powershell -ExecutionPolicy Bypass -File infra\chaos\rig-up.ps1`
  and point `.env` `DATABASE_URL` at the rig; the console will show the topology with `CHAOS_CONTROL_PORT` set.

---

## 4. Click order per act (mirrors VIDEO.md)

**Act I — Recall + receipts (console)**
0. BEFORE recording, in this same tab: send the database-deletion warm-up
   question (see VIDEO.md checklist) so its **source ↗** ledger is in the scroll-back.
1. Click the suggested incident link (checkout-api p99 latency…).
2. Let the trace fire; when the reply lands, point at the **evidence ledger** (numbered, region, distance).
2b. Scroll up to the warm-up turn: point at the **source ↗** links (GitLab 2017
    et al.) — "real public postmortems, provenance-linked", then scroll back down.

**Act II — Survive MID-INVESTIGATION (do NOT resolve first)**
3. The incident from Act I is open — show the **incident card** (phase, hypotheses, next steps) and the **region topology** (primary ringed).
4. Trigger the drill: Mode A → click **failure drill: down a region**; Mode B → in the rig terminal drain the primary region's nodes.
5. Send *"Still there? What's our next step on checkout-api?"* → same investigation continues; evidence ledger renders (incl. dead-region rows); incident state still updates.
6. Click the chip *"Is your memory OK? Diagnose it."* → self-diagnosis cites the **reviewing-cluster-health Agent Skill** checks + region down, memory intact.
7. Restore.

**Act III — Learn, through the hygiene gate**
8. Click the chip *"We raised the pool size — mark it resolved."*
9. Point at the resolve trace, then the **memory hygiene panel**: the gate decision (consolidated/accepted) and the reinforcement of recalled runbooks land live.

**Act IV — Time-travel**
10. Drag the **memory time-travel** slider from *now* toward *10 min ago*; the count drops as recent memories fall outside the snapshot.

**Act V — Close**
11. Switch to the **Architecture** tab: spec table → diagram → residency proof (3s).
12. End on repo + live URL.

---

## 5. After recording
- Trim to **under 3:00** (hard limit). If over, cut Act I narration first.
- Upload **unlisted** to YouTube/Vimeo.
- Paste the link into: `DEVPOST.md` (Links), `README.md` (top), and the Devpost submission form.

---

## 6. Final submission checklist
- [ ] Public repo, Apache-2.0 — github.com/Uthmannabeel/blackbox
- [ ] Live demo URL — blackbox-web-eight.vercel.app
- [ ] Video link in Devpost + README
- [ ] Docs name the tools (Distributed Vector Indexing + Managed MCP Server + Agent Skills Repo; Bedrock)
- [ ] ccloud CLI (4th tool): Norton whitelist DONE — remaining: run
      `.\infra\ccloud\bin\ccloud.exe auth login` once in a real terminal
      (ENTER + browser OAuth; no API-key auth exists), then
      `.\infra\ccloud\cluster-info.ps1`, then add ccloud to the DEVPOST tools list
- [ ] Least-privilege applied (IAM `iam-bedrock-policy.json`; MCP acct → Cluster Operator)
- [ ] Architecture diagram attached / linked
- [ ] `FEEDBACK.md` linked (tool feedback — bonus with the judges)
- [ ] Re-check the Devpost project gallery weekly for the competitor field
