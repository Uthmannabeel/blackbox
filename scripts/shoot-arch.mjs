// Targeted screenshot of the architecture "why not" section, both themes.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] || "https://blackbox-web-eight.vercel.app";
await mkdir("shots", { recursive: true });
const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("bb-theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + "/architecture", { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1000);
    const el = page.locator(".compare").first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    // capture the heading + intro paragraph + compare grid
    const sec = page.locator("section", { has: page.locator(".compare") });
    await sec.screenshot({ path: `shots/arch-whynot-${theme}.png` });
    console.log(`  shots/arch-whynot-${theme}.png`);
  } catch (err) {
    console.log(`  FAILED ${theme}: ${err.message}`);
  }
  await ctx.close();
}
await browser.close();
console.log("done");
