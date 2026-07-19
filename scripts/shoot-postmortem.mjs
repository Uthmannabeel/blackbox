// Drive a chat that recalls REAL public postmortems and screenshot the
// evidence ledger with its provenance links visible.
//   node scripts/shoot-postmortem.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] || "https://blackbox-web-eight.vercel.app";
const OUT = "shots";
const PROMPT =
  "An engineer accidentally deleted the production database data directory " +
  "while troubleshooting replication lag. Have we seen anything like this before?";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("bb-theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + "/console", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.locator(".composer input").fill(PROMPT);
    await page.locator(".composer input").press("Enter");
    // Wait for the ledger's provenance link — the thing this shot exists to show.
    await page.locator(".ledger .lsrc").first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    const file = `${OUT}/console-postmortem-${theme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`  ${file}`);
  } catch (err) {
    console.log(`  FAILED console-postmortem-${theme}: ${err.message}`);
  }
  await ctx.close();
}
await browser.close();
console.log("done");
