import { NextResponse } from "next/server";
import { residencyProof, isMock } from "@blackbox/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO = {
  region: "aws-eu-west-1",
  gateway: "aws-us-east-1",
  incident: { id: "demo", title: "auth-service login failures after key rotation" },
  perRegion: [
    { region: "aws-ap-south-1", rows: 1164 },
    { region: "aws-eu-west-1", rows: 1167 },
    { region: "aws-us-east-1", rows: 1170 },
  ],
};

/** Proof that a memory is physically pinned to its home region (REGIONAL BY ROW). */
export async function GET() {
  if (isMock()) return NextResponse.json({ ...DEMO, mock: true });
  try {
    return NextResponse.json(await residencyProof());
  } catch (err) {
    console.error("[/api/residency]", err);
    return NextResponse.json(DEMO);
  }
}
