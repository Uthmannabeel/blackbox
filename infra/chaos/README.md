# Chaos rig — a REAL multi-region cluster you can kill, locally

This rig runs a genuine 9-node, 3-region CockroachDB cluster on your machine
(`cockroach demo --global`, with simulated inter-region latency) so the
"memory survives the crash" demo is **real**: you kill actual nodes on camera
and BlackBox keeps recalling.

No cloud accounts needed.

## 1. Get the binary

`infra/chaos/bin/` (gitignored). v25.2+ required for vector indexes; we
validated against **v25.4.0**:

```powershell
# from repo root
Invoke-WebRequest https://binaries.cockroachdb.com/cockroach-v25.4.0.windows-6.2-amd64.zip -OutFile infra\chaos\bin\cockroach.zip
Expand-Archive infra\chaos\bin\cockroach.zip -DestinationPath infra\chaos\bin -Force
```

## 2. Start the cluster (via the driver)

The driver keeps the demo shell's stdin open and exposes a localhost TCP
control port (7777) so node-kills can be scripted:

```powershell
node infra\chaos\driver.mjs "infra\chaos\bin\cockroach-v25.4.0.windows-6.2-amd64\cockroach.exe" `
  demo --insecure --global --nodes 9 --no-example-database --sql-port 26257 --http-port 8080 --set errexit=false
```

Notes we learned the hard way:
- `--insecure` is required on machines with corporate TLS interception (the
  demo's own inter-node certs fail verification otherwise).
- `--set errexit=false` keeps a malformed control command from killing the
  whole shell (non-interactive shells exit on error by default).
- Control commands must be LF-terminated; the driver strips stray CRs.
- The demo trial license throttles after ~7 days; a fresh `demo` start is fine.

## 3. Set up the multi-region memory database

```powershell
npm run build
node packages\memory\dist\scripts\chaosSetup.js "postgresql://root@127.0.0.1:26257/defaultdb?sslmode=disable"
```

Discovers regions (us-east1 / us-west1 / europe-west1), creates `blackbox`
with `SURVIVE REGION FAILURE`, applies the schema.

## 4. Seed memory (no Bedrock needed)

```powershell
$env:DATABASE_URL="postgresql://root@127.0.0.1:26257/blackbox?sslmode=disable"
$env:BLACKBOX_MOCK_EMBEDDINGS='1'    # deterministic embeddings, real database
npm run db:seed                      # curated historical incidents
npm run db:seed:scale                # +10,000 synthetic incidents (~15 min: every
                                     #  write pays real cross-region consensus)
```

## 5. Run the app against the real cluster

```powershell
npm run dev    # with the env vars above — dashboard shows live per-region counts
```

## 6. The money shot — kill a region, memory survives

Node → region map (`\demo ls`, or `SELECT node_id, locality FROM crdb_internal.gossip_nodes`):

| Nodes | Region |
|---|---|
| 1-3 | us-east1 (app connects here via :26257) |
| 4-6 | us-west1 |
| 7-9 | europe-west1 (database PRIMARY region) |

Kill the **primary region** (most dramatic honest test) via the control port:

```powershell
$c = New-Object Net.Sockets.TcpClient("127.0.0.1", 7777); $s = $c.GetStream()
foreach ($n in 7,8,9) {
  $b = [Text.Encoding]::UTF8.GetBytes("\demo shutdown $n`n"); $s.Write($b,0,$b.Length); $s.Flush(); Start-Sleep 2
}
$c.Close()
```

europe-west1 is now genuinely gone (3 of 9 nodes dead, including all primary-
region replicas). Ask the agent something — recall still works. Restore:

```powershell
# same pattern with "\demo restart 7|8|9"
```

## Known CockroachDB quirk we hit (v25.4.0)

Post-hoc `CREATE INDEX` on a `REGIONAL BY ROW` table that has an inline
`VECTOR INDEX` fails — internal error XX000 ("table has PARTITION ALL BY
defined, but index does not have matching PARTITION BY"), or
"decoding: invalid uuid length of 2" for UUID-prefixed indexes. Workaround
(applied in `db/schema.sql`): define secondary indexes **inline** in
`CREATE TABLE`. Reported as product feedback in our submission.

## Cleanup

The cluster is in-memory: exit the driver (Ctrl+C) and everything vanishes.
Re-setup takes seconds (plus seed time).
