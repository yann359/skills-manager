// Optional runtime acceptance, with isolated homes and no inference/API calls.
// node scripts/verify-agent-skill-loaders.mjs --codex-exe PATH --pi-cli PATH --claude-exe PATH
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, args) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), args[i + 1]]);
  return pairs;
}, []));
const root = await mkdtemp(join(tmpdir(), 'skills-manager-loader-'));
const home = join(root, 'home');
const cwd = join(root, 'project');
await mkdir(cwd, { recursive: true });
await mkdir(home, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home,
  CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  PI_CODING_AGENT_DIR: join(home, '.pi', 'agent'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0' };
const name = 'sm-switch-runtime-fixture';
const content = `---\nname: ${name}\ndescription: An isolated filesystem loader acceptance fixture.\n---\nRead-only test fixture; do not execute any action.\n`;
const report = { root, results: [] };

async function skill(path) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), content);
}

function protocol(exe, args) {
  const child = spawn(exe, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let next = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const callback = pending.get(String(message.id));
    if (callback) { pending.delete(String(message.id)); callback(message); }
  });
  child.stderr.resume(); // Never expose environment/auth diagnostics.
  const exit = new Promise((resolve) => child.once('close', resolve));
  child.on('error', (error) => {
    for (const callback of pending.values()) callback({ error: { message: error.message } });
    pending.clear();
  });
  return {
    async request(fields) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(String(id)); reject(new Error('Loader request timed out')); }, 30_000);
        pending.set(String(id), (message) => {
          clearTimeout(timer);
          if (message.error || message.success === false) reject(new Error(message.error?.message ?? message.error ?? 'Loader request failed'));
          else resolve(message.result ?? message.data ?? message);
        });
        child.stdin.write(JSON.stringify({ id, ...fields }) + '\n');
      });
    },
    notify(fields) { child.stdin.write(JSON.stringify(fields) + '\n'); },
    async close() {
      child.stdin.end();
      await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 5000))]);
      // Only this idle test child may be ended; no user Agent process is touched.
      if (child.exitCode === null) child.kill();
      lines.close();
    },
  };
}

async function codex() {
  const path = join(env.CODEX_HOME, 'skills', name);
  await skill(path);
  const rpc = protocol(options['codex-exe'], ['app-server', '--stdio']);
  try {
    await rpc.request({ method: 'initialize', params: { clientInfo: { name: 'skills_manager_acceptance', version: '1.0.0' } } });
    rpc.notify({ method: 'initialized', params: {} });
    const check = async (expected) => {
      const result = await rpc.request({ method: 'skills/list', params: { cwds: [cwd], forceReload: true } });
      const found = JSON.stringify(result).includes(name);
      assert.equal(found, expected, `Codex actual skills/list should report enabled=${expected}`);
      return result;
    };
    await check(true);
    const backup = join(root, 'codex-disabled');
    await rename(path, backup); await check(false);
    await rename(backup, path); await check(true);
    assert.equal(await readFile(join(path, 'SKILL.md'), 'utf8'), content);
    report.results.push({ agent: 'Codex', status: 'passed', method: 'skills/list forceReload, enabled -> disabled -> restored' });
  } finally { await rpc.close(); }
}

async function pi() {
  const path = join(env.PI_CODING_AGENT_DIR, 'skills', name);
  await skill(path);
  const check = async (expected) => {
    const rpc = protocol(process.execPath, [options['pi-cli'], '--mode', 'rpc', '--no-session', '--no-extensions', '--no-mcp', '--no-tools']);
    try {
      const result = await rpc.request({ type: 'get_commands' });
      assert.equal(JSON.stringify(result).includes(name), expected, `Pi actual command list should report enabled=${expected}`);
    } finally { await rpc.close(); }
  };
  await check(true);
  const backup = join(root, 'pi-disabled');
  await rename(path, backup); await check(false);
  await rename(backup, path); await check(true);
  assert.equal(await readFile(join(path, 'SKILL.md'), 'utf8'), content);
  report.results.push({ agent: 'Pi', status: 'passed', method: 'RPC get_commands on fresh processes, enabled -> disabled -> restored' });
}

async function claude() {
  const path = join(env.CLAUDE_CONFIG_DIR, 'skills', name);
  await skill(path);
  let run = 0;
  const check = async (expected) => {
    const log = join(root, `claude-${++run}.log`);
    // user-only avoids ancestor project hooks/settings in the host's Temp tree.
    // --init-only loads resources and exits without a conversation/API call.
    const child = spawn(options['claude-exe'], ['--init-only', '--setting-sources', 'user', '--debug-file', log],
      { cwd, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Claude loader initialization timed out')); }, 30_000);
      child.once('close', (code) => { clearTimeout(timer); resolve(code); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    assert.equal(code, 0, 'Claude --init-only must exit successfully');
    const debug = await readFile(log, 'utf8');
    const match = /Loaded \d+ unique skills[^\n]*user: (\d+)/.exec(debug);
    assert.ok(match, 'Claude debug log must report actual loaded user skills');
    assert.equal(Number(match[1]), expected ? 1 : 0, 'Claude isolated user skill count');
  };
  await check(true);
  const backup = join(root, 'claude-disabled');
  await rename(path, backup); await check(false);
  await rename(backup, path); await check(true);
  assert.equal(await readFile(join(path, 'SKILL.md'), 'utf8'), content);
  report.results.push({ agent: 'Claude Code', status: 'passed', method: '--init-only user resource loader, enabled -> disabled -> restored' });
}

for (const [enabled, run, agent] of [[options['codex-exe'], codex, 'Codex'], [options['pi-cli'], pi, 'Pi'], [options['claude-exe'], claude, 'Claude Code']]) {
  if (!enabled) continue;
  try { await run(); } catch (error) { report.results.push({ agent, status: 'failed', reason: error.message }); process.exitCode = 1; }
}
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
