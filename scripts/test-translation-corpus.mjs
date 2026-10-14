import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {prepareTranslationInput,validateTranslatedMarkdown,retainValidFragments,markdownBlockEntries} from '../src/lib/translationMarkdown.ts';
const folder='build-cache.local/translation-stability';
const edge='# Heading **bold**\r\n\r\n> Read _notes_ and **keep `npm run build`** [Guide](https://example.com/a "title").\r\n> Continue reading.\r\n\r\n- [x] First item\r\n  continued text\r\n  - Second item\r\n\r\n| Name | Help |\r\n| --- | --- |\r\n| value | [ref][id] and [id] |\r\n\r\n[id]: https://example.com/ref "Title"\r\n\r\n```sh\r\nnpx hyperframes render --output C:\\Skills\\clip.mp4\r\n```\r\n\r\nAPI_KEY=placeholder\r\n';
fs.mkdirSync(folder,{recursive:true});
const root=process.env.TRANSLATION_SKILLS_ROOT ?? path.join(os.homedir(),'.codex','skills');
const inputs=[prepareTranslationInput('edge-fixture',edge,'Read `SKILL.md` using Codex.')];
for(const name of (fs.existsSync(root)?fs.readdirSync(root):[])) {
 const file=path.join(root,name,'SKILL.md');if(name.startsWith('.') || !fs.existsSync(file))continue;
 const content=fs.readFileSync(file,'utf8');
 inputs.push(prepareTranslationInput(name,content,''));
}
if(process.argv.includes('--prepare')) {
 fs.writeFileSync(`${folder}/corpus-input.json`,JSON.stringify(inputs));
 console.log(JSON.stringify({prepared:inputs.length,skills:inputs.length-1,apiRequests:0}));
}
if(process.argv.includes('--verify')) {
 const values=JSON.parse(fs.readFileSync(`${folder}/corpus-result.json`,'utf8'));
 let invalid=[];let rejected=0;
 for(let i=0;i<inputs.length;i++) {
  try {validateTranslatedMarkdown(inputs[i],values[i]);}
  catch(e) {const safe=retainValidFragments(inputs[i],values[i]);rejected+=safe.rejected.length;invalid.push({name:inputs[i].skill_name,rejected:safe.rejected.map(span=>Buffer.from(inputs[i][span.field]).subarray(span.start,span.end).toString())});validateTranslatedMarkdown(inputs[i],safe.value);}
 }
 fs.writeFileSync(`${folder}/corpus-validation.json`,JSON.stringify({documents:inputs.length,invalid,rejected},null,2));
 console.log(JSON.stringify({documents:inputs.length,invalid:invalid.map(v=>v.name),rejected,apiRequests:0}));
 if(rejected)process.exitCode=1;
 assert.equal(markdownBlockEntries(inputs[0].content).length,markdownBlockEntries(values[0].content).length);
}
