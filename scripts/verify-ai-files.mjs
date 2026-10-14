// Hash-only safety check. Never prints file content or credentials.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const output = path.resolve('build-cache.local/ai-translation-acceptance');
fs.mkdirSync(output, { recursive: true });
const home = os.homedir();
const roots = ['.codex/skills', '.claude/skills', '.pi/agent/skills', '.pi/skills', '.agents/skills'].map(p => path.join(home, p));
const configs = ['.codex/config.toml', '.claude/settings.json', '.claude.json', '.pi/agent/settings.json', '.pi/settings.json'].map(p => path.join(home, p));
const records = {};
const visited = new Set();
function record(file) {
  if (fs.existsSync(file) && fs.statSync(file).isFile()) records[file] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const resolved = fs.realpathSync(dir);
  if (visited.has(resolved)) return;
  visited.add(resolved);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { records[file] = `link:${fs.readlinkSync(file)}`; if (fs.statSync(file).isDirectory()) walk(file); else record(file); continue; }
    if (entry.isDirectory()) { if (!['.git', 'node_modules', '.venv', 'target', '__pycache__'].includes(entry.name)) walk(file); }
    else if (entry.isFile()) record(file);
  }
}
roots.forEach(walk);
configs.forEach(record);
const target = path.join(output, 'protected-files-before.json');
if (process.argv[2] === 'before') {
  fs.writeFileSync(target, JSON.stringify(records, null, 2));
  console.log(JSON.stringify({ snapshot: 'before', files: Object.keys(records).length, codexSkills: fs.readdirSync(roots[0]).filter(name => !name.startsWith('.') && fs.statSync(path.join(roots[0], name)).isDirectory()).length }));
} else {
  const before = JSON.parse(fs.readFileSync(target, 'utf8'));
  const changed = [...new Set([...Object.keys(before), ...Object.keys(records)])].filter(file => before[file] !== records[file]);
  fs.writeFileSync(path.join(output, 'protected-files-after.json'), JSON.stringify(records, null, 2));
  console.log(JSON.stringify({ unchanged: changed.length === 0, files: Object.keys(records).length, changed }));
  if (changed.length) process.exitCode = 1;
}
