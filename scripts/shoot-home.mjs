// Focused screenshot pass for the home page only — fast iteration loop.
//   node scripts/shoot-home.mjs [baseUrl]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] || "https://blackbox-web-eight.vercel.app";
const OUT = "shots";
const THEMES = ["light", "dark"];
const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const [vpName, w, h] of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("bb-theme", t);
      } catch {}
    }, theme);
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(1200);
      const file = `${OUT}/home-${theme}-${vpName}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(`  ${file}`);
    } catch (err) {
      console.log(`  FAILED home-${theme}-${vpName}: ${err.message}`);
    }
    await ctx.close();
  }
}

await browser.close();
console.log("done");
