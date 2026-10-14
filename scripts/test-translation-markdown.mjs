import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareTranslationInput, markdownBody, validateTranslatedMarkdown } from '../src/lib/translationMarkdown.ts';

function fakeTranslation(input) {
  const values = { content: Buffer.from(input.content), description: Buffer.from(input.description) };
  for (const span of [...input.spans].reverse()) {
    const source = values[span.field];
    const ranges = input.protected.filter(value => value.field === span.field && value.start < span.end && value.end > span.start).map(value => ({ start: Math.max(value.start, span.start), end: Math.min(value.end, span.end) })).sort((a,b) => a.start-b.start);
    let cursor = span.start;
    const pieces = [];
    for (const range of ranges) {
      if (range.start < cursor) continue;
      if (range.start > cursor) pieces.push(Buffer.from('中文说明'));
      pieces.push(source.subarray(range.start, range.end)); cursor = range.end;
    }
    if (cursor < span.end) pieces.push(Buffer.from('中文说明'));
    values[span.field] = Buffer.concat([source.subarray(0, span.start), ...pieces, source.subarray(span.end)]);
  }
  return { content: values.content.toString(), description: values.description.toString() };
}
const original = '---\r\nname: sample\r\ndescription: Read this\r\n---\r\n# Title\r\n\r\nRead **carefully** and `npm run build`.\r\n\r\n```json\r\n{"key":"value"}\r\n```\r\n\r\n| Header | Value |\r\n| --- | --- |\r\n| Note | [Guide](../guide.md) |\r\n\r\n- Step one\r\n  - Step two\r\n';
const input = prepareTranslationInput('sample', original, 'Read `SKILL.md` with Codex.');
const translated = fakeTranslation(input);
validateTranslatedMarkdown(input, translated);
assert.ok(translated.content.includes('```json\r\n{"key":"value"}\r\n```'));
assert.ok(translated.content.includes('(../guide.md)'));
assert.ok(translated.description.includes('`SKILL.md`'));
assert.equal(markdownBody(translated.content).offset, markdownBody(original).offset);
assert.throws(() => validateTranslatedMarkdown(input, { ...translated, content: translated.content.replace('guide.md', 'changed.md') }));
assert.throws(() => validateTranslatedMarkdown(input, { ...translated, content: translated.content.replace('"value"', '"altered"') }));
const unicode = prepareTranslationInput('sample', '# English 😀 中文\n\nExplain this.');
for (const span of unicode.spans) assert.ok(!Buffer.from(unicode.content).subarray(span.start, span.end).toString().includes('\uFFFD'));
const long = prepareTranslationInput('long', `# Long\n\n${'This is a long explanation. '.repeat(1500)}`);
assert.ok(long.spans.length > 20);
assert.ok(long.spans.every(span => span.end - span.start <= 4400));
validateTranslatedMarkdown(long, fakeTranslation(long));
const config = 'Read the settings below.\n\n{"key":"value"}\n\nsetting_name: enabled\n\nAPI_KEY=placeholder\n';
const configPlan = prepareTranslationInput('config', config);
assert.equal(configPlan.spans.length, 1);
assert.ok(fakeTranslation(configPlan).content.includes('{"key":"value"}'));
const keys = prepareTranslationInput('config', 'Adjust maxOutputTokens and metadata.title before continuing.');
for (const key of ['maxOutputTokens', 'metadata.title']) {
  const start = Buffer.from(keys.content).indexOf(key);
  assert.ok(keys.protected.some(span => span.start <= start && span.end >= start + key.length));
}
console.log(JSON.stringify({ markdownProtection: 'passed', longDocumentBytes: long.content.length, longDocumentSpans: long.spans.length }));

if (process.argv.includes('--prepare-live')) {
  const content = fs.readFileSync(path.join(os.homedir(),'.codex/skills/embedded-captions/SKILL.md'), 'utf8');
  const match = /^description:\s*'(.*)'\r?$/m.exec(content);
  assert.ok(match, 'Expected single-quoted description in the nominated fixture');
  const description = match[1].replaceAll("''", "'");
  const input = prepareTranslationInput('embedded-captions', content, description);
  fs.writeFileSync('build-cache.local/ai-translation-acceptance/live-input.json', JSON.stringify(input));
  console.log(JSON.stringify({ nominatedSkill: 'embedded-captions', bytes: Buffer.byteLength(content), proseSpans: input.spans.length }));
}
if (process.argv.includes('--verify-live')) {
  const input = JSON.parse(fs.readFileSync('build-cache.local/ai-translation-acceptance/live-input.json', 'utf8'));
  const result = JSON.parse(fs.readFileSync('build-cache.local/ai-translation-acceptance/live-result.json', 'utf8'));
  validateTranslatedMarkdown(input, result);
  console.log(JSON.stringify({ actualTranslation: 'passed', model: result.model, requests: result.requests, sourceHash: result.source_hash, hasChinese: /[\u4e00-\u9fff]/.test(markdownBody(result.content).body), descriptionChinese: /[\u4e00-\u9fff]/.test(result.description) }));
}
