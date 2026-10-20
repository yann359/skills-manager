// Run after npm run build. Tests the production UI with isolated Tauri IPC
// fixtures; no real settings, Skill files or external APIs are mutated.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const runtimeRoot = process.env.PLAYWRIGHT_MODULE_ROOT
  ?? path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = createRequire(path.join(runtimeRoot, "package.json"))("playwright");
const output = path.resolve("build-cache.local/scrollbars");
fs.mkdirSync(output, { recursive: true });
const documentPath = process.env.SCROLL_TEST_SKILL_PATH
  ?? path.join(os.homedir(), ".codex/skills/hyperframes-keyframes/SKILL.md");
const documentContent = fs.readFileSync(documentPath, "utf8");
const tools = [["codex", "Codex"], ["claude_code", "Claude Code"], ["pi", "Pi"]].map(([key, display_name]) => ({
  key, display_name, installed: true, enabled: true, is_custom: false,
  skills_dir: `C:/fixture/${key}/skills`, has_path_override: false,
  project_relative_skills_dir: null, has_project_path_override: false, category: "coding",
}));
const skills = Array.from({ length: 48 }, (_, i) => ({
  id: `skill-${i}`, name: i === 0 ? "hyperframes-keyframes" : `scroll-fixture-${String(i).padStart(2, "0")}`,
  description: "用于验证内容滚动、侧边栏位置与长文档阅读的测试技能。",
  source_type: "fixture", source_ref: null, central_path: `C:/fixture/skills/skill-${i}`,
  enabled: true, created_at: 1, updated_at: 1, status: "ok", update_status: "up_to_date",
  targets: tools.map(tool => ({ id: `${i}-${tool.key}`, skill_id: `skill-${i}`, tool: tool.key,
    target_path: `${tool.skills_dir}/skill-${i}`, mode: "symlink", status: "ok", synced_at: 1 })),
  preset_ids: ["default"], tags: [],
}));

const mockBundle = await build({
  stdin: {
    resolveDir: process.cwd(), sourcefile: "scrollbar-fixture.js",
    contents: `
      import {mockIPC, mockWindows} from '@tauri-apps/api/mocks';
      const tools = ${JSON.stringify(tools)};
      const skills = ${JSON.stringify(skills)};
      const content = ${JSON.stringify(documentContent)};
      const preset = {id:'default',name:'Default',description:null,icon:null,sort_order:0,skill_count:skills.length,created_at:1,updated_at:1};
      window.scrollTestUnexpectedCommands = [];
      mockWindows('main');
      mockIPC((cmd, args={}) => {
        switch(cmd) {
          case 'get_settings':
            return ({language:'zh',theme:localStorage.getItem('theme') || 'light',text_size:localStorage.getItem('test-scale') || 'default',agent_control_setup_prompt:'dismissed',backup_first_run_prompt:'dismissed'})[args.key] ?? null;
          case 'get_managed_skills': case 'get_skills_for_preset': return skills;
          case 'get_tool_status': return tools;
          case 'get_presets': return [preset];
          case 'get_active_preset': return preset;
          case 'get_projects': case 'get_all_tags': case 'get_preset_skill_order':
          case 'git_backup_pending_conflicts': case 'get_central_repo_warnings': return [];
          case 'git_backup_status': return {is_repo:false,remote_url:null,branch:null,has_changes:false,changed_skill_count:0,ahead:0,behind:0,last_commit:null,last_commit_time:null,current_snapshot_tag:null,restored_from_tag:null,upstream_health:'no_remote'};
          case 'get_agent_skill_states': return skills.map(s => ({
            name:s.name,dir_name:s.name,relative_path:s.name,path:s.central_path,description:s.description,
            files:['SKILL.md'],enabled:true,agent:args.agent,agent_display_name:tools.find(t=>t.key===args.agent).display_name,
            tags:[],in_center:true,sync_status:'in_sync',center_skill_id:s.id,managed:true,blocked_reason:null,
            exposure_paths:[s.central_path],backup_path:null
          }));
          case 'get_skill_document': return {skill_id:args.skillId,filename:'SKILL.md',content,central_path:'C:/fixture'};
          case 'get_agent_skill_document': return {skill_name:'hyperframes-keyframes',filename:'SKILL.md',content};
          case 'get_skill_tool_toggles': return tools.map(t=>({tool:t.key,display_name:t.display_name,installed:true,globally_enabled:true,enabled:true}));
          case 'fetch_leaderboard': return skills.map(s=>({id:s.id,skill_id:s.name,name:s.name,source:'fixture/skills',installs:100}));
          case 'scan_local_skills': return {tools_scanned:3,skills_found:0,groups:[]};
          case 'get_ai_translation_status': return {provider:'Google Gemini',model:'fixture',has_key:false,authorized:false,limits:null};
          case 'get_cached_skill_translation': case 'get_cached_skill_summary':
          case 'check_last_panic': case 'get_central_repo_path_override': case 'get_central_repo_pending_path': return null;
          case 'get_central_repo_path': return 'C:/fixture/skills';
          case 'check_app_update': return {has_update:false,current_version:'test',latest_version:'test'};
          case 'log_startup_event': return null;
          default:
            window.scrollTestUnexpectedCommands.push(cmd);
            throw new Error('Unmocked IPC: '+cmd);
        }
      }, {shouldMockEvents:true});
    `,
  },
  bundle: true, format: "iife", write: false,
});
const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, "http://localhost").pathname;
  const root = path.resolve("dist");
  const asset = path.resolve(root, `.${urlPath}`);
  if (!asset.startsWith(`${root}${path.sep}`) && asset !== root) {
    res.writeHead(403).end();
    return;
  }
  const file = fs.existsSync(asset) && fs.statSync(asset).isFile() ? asset : path.join(root, "index.html");
  const types = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
  res.setHeader("Content-Type", types[path.extname(file)] ?? "text/html");
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  // Playwright hides scrollbars by default in headless mode. Keep the actual
  // browser scrollbars painted and hit-testable for native dragging tests.
  ignoreDefaultArgs: ["--hide-scrollbars"],
  executablePath: process.env.BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage();
page.setDefaultTimeout(10000);
await page.addInitScript({ content: mockBundle.outputFiles[0].text });
await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const report = [];

async function metrics(locator) {
  return locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return {
      height: el.clientHeight, scrollHeight: el.scrollHeight, width: el.clientWidth,
      scrollWidth: el.scrollWidth, scrollTop: el.scrollTop,
      gutter: el.offsetWidth - el.clientWidth,
      x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
      barWidth: getComputedStyle(el, "::-webkit-scrollbar").width,
      barDisplay: getComputedStyle(el, "::-webkit-scrollbar").display,
      thumb: getComputedStyle(el, "::-webkit-scrollbar-thumb").backgroundColor,
    };
  });
}

async function resetScroll(locator) {
  await locator.evaluate(el => el.scrollTop = 0);
  await page.waitForTimeout(180);
}

async function verifyScrolling(locator, label) {
  const before = await metrics(locator);
  assert.ok(before.scrollHeight > before.height + 1, `${label}: expected long content`);
  assert.equal(before.barWidth, "10px", `${label}: scrollbar width`);
  assert.notEqual(before.barDisplay, "none");
  assert.ok(before.gutter >= 9 && before.gutter <= 11, `${label}: native gutter`);
  assert.ok(before.scrollWidth <= before.width + 1, `${label}: horizontal overflow`);
  const sidebar = page.locator("#root img[alt=logo]");
  const sidebarBefore = await sidebar.boundingBox();
  const bounds = await locator.boundingBox();
  await resetScroll(locator);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 420);
  await page.waitForFunction(el => el.scrollTop > 0, await locator.elementHandle());
  await resetScroll(locator);
  await locator.focus();
  await page.keyboard.press("PageDown");
  await page.waitForFunction(el => el.scrollTop > 0, await locator.elementHandle());
  await page.waitForTimeout(200);
  await resetScroll(locator);
  // Grab the native thumb at the top, rather than clicking the track.
  const thumbHeight = Math.max(32, before.height * before.height / before.scrollHeight);
  await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + Math.min(thumbHeight / 2, 20));
  await page.mouse.down({ button: "left" });
  await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + Math.min(bounds.height / 2, 220), { steps: 12 });
  await page.mouse.up({ button: "left" });
  await page.waitForFunction(el => el.scrollTop > 0, await locator.elementHandle());
  assert.deepEqual(await sidebar.boundingBox(), sidebarBefore, `${label}: sidebar moved`);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
  await locator.focus();
  await page.keyboard.press("Control+End");
  await page.waitForFunction(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 2, await locator.elementHandle());
  await resetScroll(locator);
  return before;
}

const routes = [
  ["Dashboard", "/"], ["技能库", "/my-skills"], ["安装 Skills", "/install"],
  ["设置", "/settings"], ["Codex", "/global-workspace/codex"],
  ["Claude Code", "/global-workspace/claude_code"], ["Pi", "/global-workspace/pi"],
];

try {
  await page.goto(origin);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("theme", theme), theme);
    for (const [scale, viewport] of [
      ["default", { width: 1440, height: 860 }],
      ["xlarge", { width: 1100, height: 640 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(scale => localStorage.setItem("test-scale", scale), scale);
      for (const [name, route] of routes) {
        await page.goto(`${origin}${route}`);
        const main = page.locator("main.app-scroll-region");
        await main.waitFor();
        await page.waitForTimeout(400);
        assert.ok((await main.innerText()).length > 30, `${name}: page is empty`);
        const initial = await metrics(main);
        assert.equal(initial.thumb, theme === "dark" ? "rgb(113, 113, 122)" : "rgb(196, 196, 204)");
        const overflowing = initial.scrollHeight > initial.height + 1;
        if (overflowing) await verifyScrolling(main, `${name}/${theme}/${scale}`);
        assert.ok(initial.scrollWidth <= initial.width + 1, `${name}: horizontal overflow`);
        assert.ok(Math.abs(initial.right - viewport.width) <= 2, `${name}: bar outside viewport`);
        const shell = await page.evaluate(() => ({
          bodyX: document.body.scrollWidth > document.body.clientWidth + 1,
          bars: [...document.querySelectorAll("main *")].filter(el =>
            /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1).length,
        }));
        assert.equal(shell.bodyX, false, `${name}: body horizontal overflow`);
        assert.equal(shell.bars, 0, `${name}: unexpected nested vertical scrollbar`);
        assert.deepEqual(await page.evaluate(() => window.scrollTestUnexpectedCommands), [], `${name}: unexpected IPC`);
        report.push({ name, theme, scale, overflowing, ...initial });
        console.log(`PASS ${name} / ${theme} / ${scale} / ${overflowing ? "scrollable" : "fits"}`);
      }
      await page.goto(`${origin}/my-skills`);
      await page.getByText("hyperframes-keyframes", { exact: true }).first().click();
      const detail = page.getByRole("region", { name: "hyperframes-keyframes" });
      await detail.locator("article").last().waitFor();
      assert.equal(await detail.evaluate(el => document.activeElement === el), true, "detail focus");
      assert.ok((await detail.innerText()).length > documentContent.length * 0.6, "real long Skill document rendered");
      const mainTop = await page.locator("main").evaluate(el => el.scrollTop);
      const detailMetrics = await verifyScrolling(detail, `详情/${theme}/${scale}`);
      assert.equal(await page.locator("main").evaluate(el => el.scrollTop), mainTop, "detail scrolled background page");
      // Pixel wheel deltas also exercise the browser's touchpad-style input path.
      const bounds = await detail.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 7.5);
      await page.waitForFunction(el => el.scrollTop > 0, await detail.elementHandle());
      await resetScroll(detail);
      await page.screenshot({ path: path.join(output, `detail-${theme}-${scale}.png`) });
      report.push({ name: "hyperframes-keyframes 详情", theme, scale, ...detailMetrics });
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "detached" });
    }
  }

  // Empty/short page: no scroll range, no wheel movement; changing to long
  // content retains the same inner width thanks to the stable gutter.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => localStorage.setItem("test-scale", "default"));
  await page.goto(`${origin}/my-skills`);
  const main = page.locator("main.app-scroll-region");
  await page.getByText("hyperframes-keyframes", { exact: true }).first().waitFor();
  const search = main.getByRole("textbox").first();
  const long = await metrics(main);
  await search.fill("no-matching-skill-scrollbar-test");
  await page.waitForTimeout(300);
  const short = await metrics(main);
  assert.equal(short.scrollHeight, short.height, "short page must not have a vertical scroll range");
  assert.equal(short.width, long.width, "layout shifted when scrollbar disappeared");
  const bounds = await main.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(180);
  assert.equal((await metrics(main)).scrollTop, 0, "short page scrolled");
  await page.screenshot({ path: path.join(output, "short-page.png") });
  assert.deepEqual(await page.evaluate(() => window.scrollTestUnexpectedCommands), []);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({
    browser: await browser.version(), documentPath, cases: report,
    shortContent: true, stableGutter: true, keyboard: true, nativeThumbDrag: true,
    wheel: true, touchpadStylePixelDeltas: true, physicalTouchpadTested: false,
    sidebarStable: true, nestedPageScrollbars: false, errors,
  }, null, 2));
  console.log(`Passed ${report.length} page/theme/scale cases, native dragging, wheel, keyboard, short content and stable layout.`);
  console.log(`Screenshots and report: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") });
  console.error({ url: page.url(), errors, unexpectedCommands: await page.evaluate(() => window.scrollTestUnexpectedCommands) });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
