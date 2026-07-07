# Record day — turnkey runbook

Everything you need to film the <3-minute demo cleanly. Pair with `VIDEO.md`
(the script/narration); this is the operational checklist.

---

## 0. Decide the recording mode

| Mode | Act III (survive) shows | Effort | Recommended |
|---|---|---|---|
| **A — Live cloud site** | The **simulated** failure drill (a live exclusion query proving surviving regions answer) | Zero setup | For a clean, low-risk take |
| **B — Local chaos rig** | A **real** node-kill (region genuinely goes dark) | ~10 min setup | For the strongest "survive" moment |

You can film Acts I, II, IV, V on the live site and splice a Mode-B clip for
Act III. Never imply a real node-kill you didn't perform — the script wording
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
Expect `ALL GREEN — 18 passed`. It also *warms* the demo (opens an incident), so
time-travel will show a delta. If a page 500s, wait 60s (cold start) and re-run.

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
1. Click the suggested incident link (checkout-api p99 latency…).
2. Let the trace fire; when the reply lands, point at the **evidence ledger** (numbered, region, distance).

**Act II — Learn**
3. Click the chip *"We raised the pool size — mark it resolved."*
4. Point at the resolve trace ("distilling runbook") and the new reflection in the memory stream.

**Act III — Survive**
5. Show the **region topology** (three nodes, primary ringed).
6. Trigger the drill: Mode A → click **failure drill: down a region**; Mode B → in the rig terminal drain the primary region's nodes.
7. Click the chip *"Is your memory OK? Diagnose it."* → read the self-diagnosis (region down, memory intact).
8. Restore.

**Act IV — Time-travel**
9. Drag the **memory time-travel** slider from *now* toward *10 min ago*; the count drops as recent memories fall outside the snapshot.

**Act V — Close**
10. Switch to the **Architecture** tab: spec table → diagram → residency proof (3s).
11. End on repo + live URL.

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
- [ ] Docs name the tools (Distributed Vector Indexing + Managed MCP Server; Bedrock)
- [ ] Least-privilege applied (IAM `iam-bedrock-policy.json`; MCP acct → Cluster Operator)
- [ ] Architecture diagram attached / linked
- [ ] `FEEDBACK.md` linked (tool feedback — bonus with the judges)
