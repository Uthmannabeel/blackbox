# ccloud CLI — cluster operations

The [ccloud CLI](https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-get-started)
is CockroachDB Cloud's agent-ready command-line tool. BlackBox uses it for
cluster lifecycle and inspection operations that are out of band for the app
itself (the app talks SQL; operators and record-day preflight talk ccloud).

## Install (Windows)

```powershell
# Downloads to infra/ccloud/bin (gitignored)
curl.exe -sSL --ssl-no-revoke -o infra\ccloud\bin\ccloud.zip `
  "https://binaries.cockroachdb.com/ccloud/ccloud_windows-amd64_latest.zip"
Expand-Archive -Force infra\ccloud\bin\ccloud.zip infra\ccloud\bin
Rename-Item infra\ccloud\bin\ccloud infra\ccloud\bin\ccloud.exe
Unblock-File infra\ccloud\bin\ccloud.exe
```

macOS/Linux: see the official install docs (`brew install cockroachdb/tap/ccloud`).

## Auth

Either interactive (`ccloud auth login`, opens a browser) or non-interactive via
a service-account API key:

```powershell
$env:CCLOUD_API_KEY = "<service account API key>"
```

The repo's `.env` already holds a service-account key (`CRDB_MCP_API_KEY`,
Cluster Operator role) used for the Managed MCP Server; `cluster-info.ps1`
reuses it.

## Usage in this project

`.\infra\ccloud\cluster-info.ps1` — pre-flight snapshot of the memory cluster
(state, version, regions) straight from the CockroachDB Cloud control plane.
Run it before recording the demo (see ../../RECORDING.md) so the cluster state
on camera is corroborated by the vendor's own tooling, not just our app.

```powershell
# examples
.\infra\ccloud\bin\ccloud.exe cluster list
.\infra\ccloud\bin\ccloud.exe cluster info blackbox
.\infra\ccloud\bin\ccloud.exe cluster sql blackbox   # interactive SQL shell
```
