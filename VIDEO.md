# BlackBox — demo video script v3 (target 2:55 / hard max 3:00)

Screen recording + voiceover. Five beats: **recall with receipts → learn →
survive → time-travel → it's real**. Everything on screen is live: real Claude
on Bedrock, real multi-region CockroachDB Cloud, real queries.

Setup before recording:
- Live site: https://blackbox-web-eight.vercel.app (pill shows "live · multi-region CockroachDB").
- For the on-camera node-kill (Act III), run the local chaos rig (`infra/chaos/README.md`) in a second window; on managed Cloud use the console's simulated drill and say so.
- Pick light or dark deliberately and stay consistent. 1440p, big fonts, no notifications.

---

### 0:00–0:15 — Hook
> "An hour of downtime costs most enterprises over three hundred thousand
> dollars — and every AI agent claims to have memory, until the database behind
> it fails, exactly when you need it: mid-outage. BlackBox is agentic memory
> that survives the crash it's recording — and audits every write it lets in.
> I'll prove it with an incident agent working a live outage: I'll kill a whole
> region on camera, and it will not lose one of its three and a half thousand
> memories."

(Downtime figure: ITIC 2024 Hourly Cost of Downtime Survey — >90% of mid/large
enterprises report >$300k/hour. Safe to say on camera.)

**Say only numbers the live site will show.** The memory count is on the stats
strip — read the real figure off screen on the day and say that. Do NOT say
"136 milliseconds" here: that is the *local rig* drill figure, and the site
shows CockroachDB vector search at roughly 0.9 s on the managed cluster. Saying
a number a judge can immediately contradict by clicking the demo link costs
more than the number gains. If you want a latency line, the honest one is:
"about a second to search three and a half thousand memories across three
regions — and the same after I kill one of them."

On screen: the landing hero + the flight-recorder strip showing three regions
with live memory counts.

### 0:15–0:55 — Act I: RECALL, with receipts
Open the console. Click the suggested incident:
*"checkout-api p99 latency just jumped to 8s and connections are maxed out."*
> "The agent searches thousands of past incidents in CockroachDB — distributed
> vector search, per region — and finds the connection-pool exhaustion we solved
> before. And it shows its receipts."

On screen: the tool trace fires; the reply appears; the **evidence ledger**
renders under it — numbered memories with region, raw distance, and a ×N
recurrence count. Point at it.
> "Every claim is backed by the exact memories it recalled — id, home region,
> vector distance. Not 'trust me' — provenance. And see that times-seventy-two?
> A real fleet fails the same way over and over, so recall doesn't hand back the
> same incident five times — it collapses the repeats and tells you how often
> this signature has fired. That count is the most useful thing institutional
> memory can give an on-call."

Scroll briefly to the earlier warm-up turn (sent before recording): the
database-deletion question whose ledger shows **source ↗** links.
> "And this memory isn't synthetic: it holds twenty-five real public
> postmortems. Ask about a deleted production database and it cites GitLab's
> actual 2017 incident report — that link goes to the original."

### 0:55–1:50 — Act II: SURVIVE, MID-INVESTIGATION (the money shot)
The incident from Act I is OPEN and unresolved — hypotheses and next steps live
in the incident card. That is the point: the kill happens mid-investigation.
> "The incident is open. The agent is mid-diagnosis — hypotheses, next steps,
> all durable state. Now the reason this runs on CockroachDB: three regions,
> every memory REGIONAL BY ROW. I'm killing the primary region. Not a mock —
> watch the topology."

Trigger the region kill (rig: `\demo shutdown` the primary region's nodes; Cloud:
the failure drill, stated as simulated). Topology node goes dark.
> "Same investigation, no restart. Ask it to keep working."

Send: *"Still there? What's our next step on checkout-api?"*
> "It recalls again — the evidence ledger still renders, including memories
> homed in the dead region. Its in-flight incident state still commits. Not one
> memory lost, mid-investigation."

Click the chip: *"Is your memory OK? Diagnose it."*
> "And it diagnoses its own brain: through CockroachDB's Managed MCP Server it
> sees one region down — and runs the official CockroachDB Agent Skill health
> check on itself. Every memory readable and writable from surviving replicas,
> because the database is set to SURVIVE REGION FAILURE."

On screen: dark node; agent's reply citing reviewing-cluster-health; stats strip
still serving. Restore the region.

### 1:50–2:20 — Act III: LEARN — through a hygiene gate, and a trust boundary
**Start this act with the operator-token field EMPTY.** That is deliberate: the
first resolve is an anonymous one, and the quarantine is the point.

Click the chip: *"We raised the pool size — mark it resolved."*
> "Here's the part most memory demos get wrong: they append everything. One bad
> write poisons a self-improving memory. BlackBox gates every learned fix —
> content filter, duplicate consolidation, contradiction check. But look at what
> it did with mine: quarantined. I'm an anonymous visitor on a public console.
> The agent will happily work the incident with me, but nothing I teach it
> reaches anyone else's recall."

On screen: the resolve trace; the hygiene panel logs `quarantined`; the lesson
appears in the quarantine list with a disabled **promote** button.

Now paste the operator token into the field. The promote button enables.
> "Now I authenticate as an operator — and I can release it. That's the whole
> difference between a memory that learns and a memory anyone can poison."

Click **promote**.
> "It's in recall now, and the ledger records who let it in. The runbooks the
> agent recalled during this incident just earned confidence too — and the
> whole thing, resolve, distil, reinforce, reflect, committed as a single
> CockroachDB transaction across four tables in three regions."

On screen: hygiene panel shows `quarantined` then `promoted`; quarantine list
empties.

### 2:20–2:40 — Act IV: TIME-TRAVEL
> "One more only-CockroachDB trick: AS OF SYSTEM TIME rewinds the agent's
> memory — a consistent historical read, no backups. This is its mind ten
> minutes ago, before it learned that fix."

On screen: drag the memory time-travel slider; the count changes to the past state.

### 2:40–2:58 — Act V: it's real, and close
> "One CockroachDB is system of record, vector memory, live incident state,
> the hygiene ledger — even the rate limiter. Claude on Amazon Bedrock reasons;
> Titan embeds. Survivable, hygienic agentic memory — proven, not claimed.
> Code and live demo below."

On screen: the architecture page (spec table + diagram + residency proof) for 3s,
then repo + live URL.

---

## Recording checklist
- [ ] Pre-seed done; stats strip shows the corpus, 3/3 regions.
- [ ] Evidence ledger renders (send one incident before recording to warm it).
- [ ] Warm-up turn for Act I's provenance beat: in the SAME console tab you will
      record, send *"An engineer accidentally deleted the production database
      data directory while troubleshooting replication lag. Have we seen
      anything like this before?"* — its ledger shows the GitLab/Atlassian/
      GitHub **source ↗** links you'll point at (8s, no on-camera wait).
- [ ] Act II: the kill happens with the incident OPEN — do not resolve before
      the drill. Rehearse the node drain (~12s); narrate over it; ONE kill cycle.
- [ ] Managed Cloud can't show raw node-kill — either use the local rig for Act II,
      or keep the "simulated drill" wording. Never imply a real kill you didn't do.
- [ ] Act III needs `BLACKBOX_OPERATOR_TOKEN` set in Vercel and the value on
      hand to paste. Start the act with the console's operator field EMPTY so
      the quarantine fires, then paste it to enable **promote**.
- [ ] Act III: resolve with a fix worded close to a prior one if you want the
      panel to show "consolidated" after promotion; a novel fix showing
      "accepted (confidence 0.5)" is equally fine — say on camera which you got.
      Never narrate a gate decision you did not actually get on screen.
- [ ] Only say numbers the live site shows. The memory count is on the stats
      strip; vector search is ~0.9 s on managed Cloud. "136 ms" is the LOCAL RIG
      drill figure — say "on the local rig" or don't say it.
- [ ] Time-travel: works best if you opened/resolved an incident earlier so the
      recent count visibly differs from the past snapshot.
- [ ] Hard limit 3:00. If over, trim Act I narration first.
- [ ] Upload unlisted to YouTube/Vimeo; put the link in Devpost + README.
