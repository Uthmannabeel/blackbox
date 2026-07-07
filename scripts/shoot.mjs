// Headless screenshot pass — every page, both themes, desktop + mobile.
//   node scripts/shoot.mjs [baseUrl]
// Default target is the live deployment; pass http://localhost:3000 for local.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] || "https://blackbox-web-eight.vercel.app";
const OUT = "shots";
const PAGES = [
  ["home", "/"],
  ["product", "/product"],
  ["architecture", "/architecture"],
  ["survivability", "/survivability"],
  ["console", "/console"],
];
const THEMES = ["light", "dark"];
const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const [vpName, w, h] of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      colorScheme: theme,
    });
    // Pin the app's own theme choice too (it reads localStorage first).
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("bb-theme", t);
      } catch {}
    }, theme);

    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      try {
        await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(900); // let fonts + fetch settle
        const file = `${OUT}/${name}-${theme}-${vpName}.png`;
        await page.screenshot({ path: file, fullPage: true });
        console.log(`  ${file}`);
      } catch (err) {
        console.log(`  FAILED ${name}-${theme}-${vpName}: ${err.message}`);
      }
    }
    await ctx.close();
  }
}

await browser.close();
console.log("done");
