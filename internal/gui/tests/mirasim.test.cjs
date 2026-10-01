const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");
const assets = path.resolve(__dirname, "../assets");

for (const width of [900, 480]) {
  for (const lang of ["en", "zh"]) {
    test(`Mirasim settings ${lang} ${width}px`, async (t) => {
      const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
      t.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
      let settings = { lang, theme: "light", tray: "panel", mirasim: false, claudeLauncher: "", version: "mirasim-dev", dir: "/tmp/magpie", gateway: "http://127.0.0.1:3426", visionModels: [], imageGenModels: [], fx: { rate: 7.2, stale: false } };
      const errors = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.route("**/*", async (route) => {
        const req = route.request(), p = new URL(req.url()).pathname;
        const json = (data) => route.fulfill({ json: data });
        if (p === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs={lang:"${lang}",theme:"light",web:false};` });
        if (p === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window={};" });
        if (p === "/api/state") return json({ agents: [], profiles: [], settings, fx: settings.fx });
        if (p === "/api/settings") {
          if (req.method() === "POST") settings = { ...settings, ...req.postDataJSON() };
          return json(settings);
        }
        if (p === "/api/usage/quotas") return json([]);
        if (p === "/api/groups") return json({ groups: [], models: [] });
        if (p.startsWith("/api/")) return json({});
        const file = path.join(assets, p === "/" ? "index.html" : p);
        const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
        return route.fulfill({ body: await fs.readFile(file), contentType });
      });
      await page.goto("http://magpie.test/");
      await page.locator("#prefs").click();
      await page.locator("#claudeLauncherSegs button").filter({ hasText: "mirasim claude" }).click();
      await page.waitForFunction(() => document.querySelector("#claudeLauncherSegs .on")?.textContent === "mirasim claude");
      await page.locator("#mirasimSegs button").nth(1).click();
      await page.waitForFunction(() => document.querySelector("#mirasimSegs button:last-child").classList.contains("on"));
      assert.equal(settings.mirasim, true);
      assert.equal(settings.claudeLauncher, "mirasim");
      await page.locator("#themeSegs button").last().click();
      await page.waitForTimeout(100);
      assert.equal(settings.mirasim, true);
      assert.equal(settings.claudeLauncher, "mirasim");
      await page.reload();
      await page.locator("#prefs").click();
      const row = page.locator("#claudeLauncherSegs");
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width + 1, JSON.stringify(box));
      await page.locator("#mirasimSegs").evaluate((el) => el.scrollIntoView({ block: "center" }));
      assert.deepEqual(errors, []);
      if (process.env.ARTIFACT_DIR) {
        await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, `mirasim-${lang}-${width}.png`) });
      }
    });
  }
}
