# Chaos rig — a REAL multi-region cluster you can kill, locally

This rig runs a genuine 9-node, 3-region CockroachDB cluster on your machine
(`cockroach demo --global`, with simulated inter-region latency) so the
"memory survives the crash" demo is **real**: you kill actual nodes on camera
and BlackBox keeps recalling.

No cloud accounts needed.

## 1. Get the binary

`infra/chaos/bin/cockroach.exe` (gitignored). Download from
https://www.cockroachlabs.com/docs/releases/ (v25.2+ for vector indexes), or:

```powershell
# from repo root
Invoke-WebRequest https://binaries.cockroachdb.com/cockroach-v25.4.2.windows-6.2-amd64.zip -OutFile infra\chaos\bin\cockroach.zip
Expand-Archive infra\chaos\bin\cockroach.zip -DestinationPath infra\chaos\bin -Force
```

## 2. Start the cluster (keep this terminal open — it's your kill switch)

```powershell
.\infra\chaos\bin\<extracted-dir>\cockroach.exe demo --global --nodes 9 --no-example-database
```

The shell prints a connection URL like
`postgresql://demo:<password>@127.0.0.1:26257/defaultdb?sslmode=require`.
Copy it.

## 3. Set up the multi-region memory database

```powershell
npm run build
node packages\memory\dist\scripts\chaosSetup.js "<that url>"
```

This discovers the demo regions (us-east1 / us-west1 / europe-west1), creates
`blackbox` with `SURVIVE REGION FAILURE`, and applies the schema. It prints the
`DATABASE_URL` to put in `.env`.

## 4. Seed memory (no Bedrock needed)

```powershell
$env:BLACKBOX_MOCK_EMBEDDINGS='1'   # deterministic embeddings, real database
npm run db:seed                      # the curated historical incidents
npm run db:seed:scale                # +10,000 synthetic incidents for real C-SPANN scale
```

## 5. Run the app against the real cluster

```powershell
$env:BLACKBOX_MOCK_EMBEDDINGS='1'    # keep until Bedrock creds exist
npm run dev                          # dashboard shows "live" with real per-region counts
```

## 6. The money shot — kill a region, memory survives

In the demo shell (step 2), nodes 1-3 = us-east1, 4-6 = us-west1,
7-9 = europe-west1 (check with `\demo ls`). Take down an entire region:

```
\demo shutdown 1
\demo shutdown 2
\demo shutdown 3
```

us-east1 is now genuinely gone. Ask the agent something — recall still works;
the regions panel still counts memories from surviving replicas. Bring it back:

```
\demo restart 1
\demo restart 2
\demo restart 3
```

## Notes

- The demo cluster is in-memory: data resets when the shell exits. Re-run
  steps 3-4 (seconds with mock embeddings).
- `--global` simulates real inter-region latency, so latency numbers you show
  are honest too.
- The same `chaosSetup.js` works against CockroachDB Cloud later — it discovers
  regions instead of assuming names.
