// Browser regression test of the production reader/settings with a local IPC mock.
// No Google requests, real credentials, Skill writes or new dependencies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const runtimeRoot=process.env.PLAYWRIGHT_MODULE_ROOT ?? path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const requireRuntime=createRequire(path.join(runtimeRoot,'package.json'));
const {chromium}=requireRuntime('playwright');
const folder=path.resolve('build-cache.local/translation-stability/ui');
fs.mkdirSync(folder,{recursive:true});
const mock=`
const status=()=>({provider:'Google Gemini',model:'mock-model',has_key:true,limits:{rpm:15,tpm:250000,rpd:500},saved_at:'2026-10-14T00:00:00Z',last_test_at:'2026-10-14T00:00:00Z',last_test_passed:true,authorized:localStorage.getItem('mock-consent')==='yes',authorized_at:localStorage.getItem('mock-consent')==='yes'?'2026-10-14T00:00:00Z':null});
export const getTranslationStatus=async()=>status();
export const setTranslationConsent=async(value)=>{localStorage.setItem('mock-consent',value?'yes':'no');return status();};
export const getCachedTranslation=async()=>JSON.parse(localStorage.getItem('mock-cache')||'null');
export const getCachedSummary=async()=>null;
export const cancelTranslation=async()=>{};
export const rejectTranslationFragments=async()=>{};
export const clearTranslationKey=async()=>status();
export const saveTranslationKey=async()=>status();
export const testTranslationConnection=async()=>status();
export async function translateDocument(input,confirmed,force,id,onProgress){
 if(!status().authorized)throw {kind:'invalid_input',message:'未授权'};
 const call=Number(localStorage.getItem('mock-calls')||0)+1;localStorage.setItem('mock-calls',String(call));
 const previous=force?JSON.parse(localStorage.getItem("mock-refresh")||"null"):await getCachedTranslation();
 const remaining=previous?previous.fragments.filter(v=>v.text===null).length:input.spans.length;
 localStorage.setItem('mock-last-remaining',String(remaining));
 let fragments=previous?.fragments??input.spans.map(span=>({span,text:null}));
 const make=()=>{let values={content:new TextEncoder().encode(input.content),description:new TextEncoder().encode(input.description)};
 for(const {span,text} of [...fragments].reverse()){if(text===null)continue;const src=values[span.field],rep=new TextEncoder().encode(text),out=new Uint8Array(span.start+rep.length+src.length-span.end);out.set(src.subarray(0,span.start));out.set(rep,span.start);out.set(src.subarray(span.end),span.start+rep.length);values[span.field]=out;}
 const completed=fragments.filter(v=>v.text!==null).length;return {content:new TextDecoder().decode(values.content),description:new TextDecoder().decode(values.description),cached:false,requests:1,source_hash:'mock',model:'mock-model',rule:'mock',legacy_cache:false,complete:completed===fragments.length,completed,total:fragments.length,pending:fragments.filter(v=>v.text===null).map(v=>v.span),fragments};};
 const pending=fragments.filter(v=>v.text===null);
 for(const fragment of (call===1||(force&&call===3)?pending.slice(0,1):pending)) {
 const span=fragment.span, raw=new TextEncoder().encode(input[span.field]);
 const shields=input.protected.filter(v=>v.field===span.field&&v.start<span.end&&v.end>span.start).sort((a,b)=>a.start-b.start);
 const pieces=[]; let cursor=span.start;
 const ordinary=(end)=>{if(end>cursor){const value=new TextDecoder().decode(raw.slice(cursor,end));pieces.push(/[a-z]/i.test(value)?'中文说明':value);}};
 for(const shield of shields){if(shield.start<cursor)continue;ordinary(shield.start);pieces.push(new TextDecoder().decode(raw.slice(shield.start,shield.end)));cursor=shield.end;}
 ordinary(span.end);fragment.text=pieces.join('');
 }
 const value=make();localStorage.setItem(force&&!value.complete?'mock-refresh':'mock-cache',JSON.stringify(value)); if(force&&value.complete)localStorage.removeItem('mock-refresh');
 onProgress({job_id:id,state:'translating',completed:value.completed,total:value.total,requests:1,preview:value});
 await new Promise(r=>setTimeout(r,100));
 if(call===1||(force&&call===3))throw {kind:'network',message:'HTTP 503：Google 服务暂时异常，已完成译文保留。'};
 return value;
}
`;
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {SkillTranslationReader} from './src/components/SkillTranslationReader';
import {AiTranslationSettings} from './src/components/AiTranslationSettings';
createRoot(document.getElementById('root')).render(<main><SkillTranslationReader name="temporary-fixture" content={'Read notes.\\n\\nOther explanation.\\n\\n\`\`\`sh\\nnpm run build --dry-run\\n\`\`\`\\n\\n[Guide](https://example.com/original)'} /><AiTranslationSettings/></main>);
`;
await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'ui-fixture.tsx',loader:'tsx'},bundle:true,format:'esm',jsx:'automatic',outfile:path.join(folder,'app.js'),plugins:[{name:'mock-ipc',setup(build){build.onResolve({filter:/lib\/aiTranslation$/},()=>({path:'mock-ipc',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock,loader:'js'}));}}]});
const css=fs.readdirSync('dist/assets').find(name=>name.endsWith('.css'));
fs.copyFileSync(`dist/assets/${css}`,path.join(folder,'app.css'));
fs.writeFileSync(path.join(folder,'index.html'),'<meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root" style="max-width:1000px;padding:32px;margin:auto"></div><script type="module" src="/app.js"></script>');
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','app.css'].includes(name)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(folder,name)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
let page; const errors=[];
try {
 page=await browser.newPage({viewport:{width:1280,height:1000}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const chinese=page.getByRole('button',{name:'中文翻译',exact:true});await chinese.waitFor({state:'visible'});await chinese.click();
 await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('mock-calls')),null);
 await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('button',{name:'同意并记住授权'}).click();
 await page.getByRole('alert').filter({hasText:'HTTP 503'}).waitFor();
 assert.match(await page.locator('main').innerText(),/中文说明/);assert.match(await page.locator('main').innerText(),/本段含未完成片段/);
 await page.getByRole('button',{name:'中英对照',exact:true}).click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('mock-calls')),'1');
 await page.getByRole('button',{name:'继续未完成片段',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mock-cache')).complete);
 await page.getByRole('button',{name:'取消翻译',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.getByRole('dialog').count(),0);assert.match(await page.locator('main').innerText(),/Read notes/);assert.match(await page.locator('main').innerText(),/中文说明/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('mock-calls')),'2');
 assert.equal(await page.evaluate(()=>localStorage.getItem('mock-last-remaining')),'2');
 assert.equal(await page.locator('code').first().innerText(),'npm run build --dry-run\n');
 assert.equal(await page.getByRole('link',{name:'Guide',exact:true}).first().getAttribute('href'),'https://example.com/original');
 await page.screenshot({path:path.join(folder,'bilingual.png'),fullPage:true});
 await page.getByRole('button',{name:'重新翻译',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'HTTP 503'}).waitFor();
 await page.getByRole('button',{name:'重试翻译',exact:true}).click();
 await page.getByRole('button',{name:'取消翻译',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>localStorage.getItem('mock-calls')),'4');
 assert.equal(await page.evaluate(()=>localStorage.getItem('mock-last-remaining')),'2');
 await page.reload();await chinese.click();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('mock-calls')),'4');
 await page.getByRole('button',{name:'撤销在线翻译授权'}).click();await page.getByText('在线翻译授权：尚未授权或已撤销').waitFor();
 // Cached reading remains free of prompts; explicit new work requires consent again.
 await page.getByRole('button',{name:'重新翻译',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('mock-calls')),'4');
 await page.getByRole('button',{name:'取消',exact:true}).click();
 assert.deepEqual(errors,[]);
 const report={firstConsent:true,refreshResume:true,rememberedAfterReload:true,partialReadableAfter503:true,resumeOnlyMissing:true,bilingual:true,immutableCodeAndLinks:true,cacheRequests:0,revocation:true,realApiRequests:0};
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error) { console.log(JSON.stringify({uiText:await page.locator("body").innerText(), storage:await page.evaluate(()=>({...localStorage})), errors})); await page.screenshot({path:path.join(folder,"failure.png"),fullPage:true}); throw error; } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
