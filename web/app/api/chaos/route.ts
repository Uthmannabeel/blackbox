import { NextRequest, NextResponse } from "next/server";
import { Socket } from "node:net";
import { isMock, regionLiveness, clusterHealth } from "@blackbox/memory";
import { bustRegionsCache } from "@/lib/regionsCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REAL chaos, dev-rig only: kills (or restores) every node in a region by
 * sending `\demo shutdown <n>` to the local `cockroach demo` shell through the
 * chaos driver's TCP control port.
 *
 * Hard-gated: does nothing unless CHAOS_CONTROL_PORT is explicitly set — it
 * can never fire in a cloud deployment, where the UI falls back to the
 * exclusion-query drill instead.
 */
const CONTROL_PORT = process.env.CHAOS_CONTROL_PORT
  ? Number(process.env.CHAOS_CONTROL_PORT)
  : null;

const DRAIN_SPACING_MS = 4_000;

function sendControl(commands: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };
    // Listen for the whole socket lifetime, not just once: a late error (node
    // restart drops the port mid-drain) would otherwise be an uncaught
    // exception inside the timer callback and crash the process.
    sock.on("error", (err) => finish(err));
    sock.connect(CONTROL_PORT!, "127.0.0.1", () => {
      let i = 0;
      const tick = () => {
        if (done) return; // socket errored out — stop writing to a dead socket
        if (i >= commands.length) {
          sock.end();
          finish();
          return;
        }
        sock.write(commands[i]! + "\n");
        i++;
        setTimeout(tick, DRAIN_SPACING_MS);
      };
      tick();
    });
  });
}

/** GET: is real chaos available, and what would it target? */
export async function GET() {
  if (!CONTROL_PORT || isMock()) {
    return NextResponse.json({ available: false });
  }
  try {
    const health = await clusterHealth();
    const target = pickTarget(health.gatewayRegion, health.regions.map((r) => r.region));
    return NextResponse.json({ available: true, target });
  } catch {
    return NextResponse.json({ available: false });
  }
}

export async function POST(req: NextRequest) {
  if (!CONTROL_PORT || isMock()) {
    return NextResponse.json({ error: "real chaos is not available here" }, { status: 400 });
  }

  try {
    const { action } = (await req.json()) as { action: "kill" | "restore" };
    if (action !== "kill" && action !== "restore") {
      return NextResponse.json({ error: "action must be kill|restore" }, { status: 400 });
    }

    const health = await clusterHealth();
    const target = pickTarget(health.gatewayRegion, health.regions.map((r) => r.region));
    if (!target) {
      return NextResponse.json({ error: "no safe target region" }, { status: 409 });
    }

    const nodes =
      (await regionLiveness()).regions.find((r) => r.region === target)?.nodeIds ?? [];
    const verb = action === "kill" ? "shutdown" : "restart";
    const targets = nodes.filter((n) => (action === "kill" ? n.live : !n.live));

    await sendControl(targets.map((n) => `\\demo ${verb} ${n.id}`));

    // The topology just changed — drop the cached /api/regions body so the next
    // poll reflects the kill/restore immediately instead of up to 10s later.
    bustRegionsCache();

    return NextResponse.json({
      ok: true,
      action,
      region: target,
      nodes: targets.map((n) => n.id),
    });
  } catch (err) {
    console.error("[/api/chaos]", err);
    return NextResponse.json({ error: "chaos control failed" }, { status: 500 });
  }
}

/**
 * Never kill the region serving our own connection — that's not a
 * survivability demo, it's a self-own. Prefer the first non-gateway region
 * (deterministic for the demo).
 */
function pickTarget(gateway: string, regions: string[]): string | null {
  return regions.find((r) => r !== gateway && r !== "unknown") ?? null;
}
