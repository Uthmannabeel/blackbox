// Element-level screenshot of the home bento for detail review.
//   node scripts/shoot-bento.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] || "http://localhost:3001";
const OUT = "shots";
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1600 }, colorScheme: theme });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("bb-theme", t);
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  try {
    // networkidle waits for the live /api fetches — locally those can take ~30s
    // through the corporate TLS proxy (prod serves them in ~1-2s).
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1000);
    const el = page.locator(".bento");
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const file = `${OUT}/bento-${theme}.png`;
    await el.screenshot({ path: file });
    console.log(`  ${file}`);
  } catch (err) {
    console.log(`  FAILED bento-${theme}: ${err.message}`);
  }
  await ctx.close();
}
await browser.close();
console.log("done");
