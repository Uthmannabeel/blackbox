// Drive one incident through the console and screenshot the result — so the
// evidence ledger, incident card, and updated memory stream are captured.
//   node scripts/shoot-chat.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] || "https://blackbox-web-eight.vercel.app";
const OUT = "shots";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("bb-theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + "/console", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    // Click the suggested incident link.
    const link = page.locator(".hint a").first();
    await link.click();
    // Wait for an agent reply (or the evidence ledger) to render.
    await page.locator(".msg.agent").first().waitFor({ timeout: 80000 });
    await page.waitForTimeout(2500);
    const file = `${OUT}/console-chat-${theme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`  ${file}`);
  } catch (err) {
    console.log(`  FAILED console-chat-${theme}: ${err.message}`);
  }
  await ctx.close();
}
await browser.close();
console.log("done");
