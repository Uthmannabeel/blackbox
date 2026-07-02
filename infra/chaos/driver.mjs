// Chaos driver: spawns `cockroach demo`, keeps its stdin open, and exposes a
// localhost-only TCP control port so demo-shell commands (e.g. `\demo shutdown 3`)
// can be sent programmatically:
//
//   node infra/chaos/driver.mjs <path-to-cockroach.exe> [demo args...]
//
// Send commands (PowerShell):
//   $c = New-Object Net.Sockets.TcpClient("127.0.0.1", 7777)
//   $w = New-Object IO.StreamWriter($c.GetStream()); $w.WriteLine("\demo shutdown 1"); $w.Flush(); $c.Close()
//
// Dev-only tooling: binds 127.0.0.1 exclusively.
import { spawn } from "node:child_process";
import net from "node:net";

const CONTROL_PORT = Number(process.env.CHAOS_CONTROL_PORT ?? 7777);
const [, , bin, ...args] = process.argv;

if (!bin) {
  console.error("usage: node driver.mjs <cockroach-binary> [demo args...]");
  process.exit(1);
}

const child = spawn(bin, args, { stdio: ["pipe", "inherit", "inherit"] });

child.on("exit", (code) => {
  console.error(`[driver] cockroach exited (${code})`);
  process.exit(code ?? 0);
});

const server = net.createServer((sock) => {
  sock.setEncoding("utf8");
  sock.on("data", (raw) => {
    // Normalize: strip CRs (Windows clients send CRLF; a trailing \r makes the
    // demo shell reject the command) and guarantee exactly one trailing LF.
    const line = String(raw).replace(/\r/g, "").replace(/\n+$/, "");
    if (!line) return;
    process.stderr.write(`[driver] cmd: ${line}\n`);
    child.stdin.write(line + "\n");
  });
  sock.on("error", () => sock.destroy());
});

server.listen(CONTROL_PORT, "127.0.0.1", () => {
  console.error(`[driver] control port listening on 127.0.0.1:${CONTROL_PORT}`);
});
