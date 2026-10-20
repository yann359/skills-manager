// Production browser demo: layout matrix and reversible UI interactions.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const runtime = process.env.PLAYWRIGHT_MODULE_ROOT ?? path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = createRequire(path.join(runtime, "package.json"))("playwright");
const output = path.resolve("build-cache.local/ui-redesign");
fs.mkdirSync(output, { recursive: true });
const root = path.resolve("dist-demo");
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/skills-manager/, "");
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" })[path.extname(file)] ?? "text/html");
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/skills-manager/`;
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], executablePath: process.env.BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const errors = [];
const logs = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", msg => { if (msg.type() === "error") logs.push(msg.text()); });
const cases = [];
const routes = ["/", "/my-skills", "/install", "/install?tab=local", "/install?tab=git", "/global-workspace", "/global-workspace/codex", "/global-workspace/claude_code", "/global-workspace/pi", "/project/demo-project", "/presets", "/backup", "/settings"];
try {
  await page.goto(base);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("theme", theme), theme);
    for (const viewport of [{ width: 1440, height: 860 }, { width: 1100, height: 640 }]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(`${base}#${route}`);
        await page.reload();
        await page.locator("main .app-page").waitFor();
        await page.waitForTimeout(250);
        const metrics = await page.locator("main").evaluate(el => ({
          width: el.clientWidth, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, height: el.clientHeight,
          text: el.innerText.slice(0, 140), bodyWidth: document.body.scrollWidth, viewport: document.body.clientWidth,
        }));
        assert.ok(metrics.text.length > 10, `empty page: ${route}`);
        assert.ok(metrics.scrollWidth <= metrics.width + 1, `horizontal overflow: ${route} ${JSON.stringify(metrics)}`);
        assert.ok(metrics.bodyWidth <= metrics.viewport + 1, `body overflow: ${route}`);
        assert.ok(!/ui\.[a-zA-Z]|sidebar\.[a-zA-Z]/.test(metrics.text), `missing translation: ${metrics.text}`);
        if (viewport.width === 1440) await page.screenshot({ path: path.join(output, `${theme}-${route.replace(/\W+/g, "-") || "dashboard"}.png`) });
        cases.push({ route, theme, viewport, ...metrics });
      }
      await page.goto(`${base}#/my-skills`);
      await page.getByText("hyperframes-keyframes", { exact: true }).first().click();
      const detail = page.getByRole("region", { name: "hyperframes-keyframes" });
      await detail.locator("article").last().waitFor();
      await page.screenshot({ path: path.join(output, `detail-${theme}-${viewport.width}.png`) });
      await detail.focus();
      await page.keyboard.press("Control+End");
      await page.waitForFunction(el => el.scrollTop > 1000, await detail.elementHandle());
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "detached" });
    }
  }
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`${base}#/my-skills`);
  const search = page.locator("main").getByRole("textbox").first();
  await search.fill("hyperframes-keyframes");
  assert.equal(await page.locator("main").getByText("hyperframes-keyframes", { exact: true }).count(), 1);
  await search.fill("");
  await page.getByRole("combobox", { name: "筛选 Agent" }).selectOption("pi");
  assert.ok(await page.locator("main").getByText("frontend-design", { exact: true }).count() > 0);
  await page.getByRole("combobox", { name: "工作范围" }).selectOption("/project/demo-project");
  await page.waitForURL("**/#/project/demo-project");
  await page.goto(`${base}#/presets`);
  await page.locator("main").getByRole("button", { name: "新建 Preset", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").first().fill("UI test preset");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("heading", { name: "UI test preset", exact: true }).waitFor();
  await page.getByRole("button", { name: "删除 UI test preset", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "UI test preset", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(logs, []);
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ cases, interactions: ["search", "agent filter", "project scope", "preset creation", "delete cancellation", "detail keyboard"], errors, logs }, null, 2));
  console.log(`PASS ${cases.length} layout cases + interaction checks. ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  console.error({ url: page.url(), errors, logs });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
