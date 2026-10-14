// Inspect only the staged source tree. Never print matching secret values.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const git=(args)=>{const r=spawnSync('git',args,{encoding:'utf8'});if(r.status!==0)throw new Error('Git safety inspection failed');return r.stdout;};
const files=git(['diff','--cached','--name-only','--diff-filter=ACMR']).trim().split('\n').filter(Boolean);
const problems=[];let synthetic=0;
const denied=/(?:^|\/)(?:build-cache[^/]*|node_modules|dist|target|\.codex|\.claude|\.agents|\.pi|private-skills|ai-translation|translation-cache|logs)(?:\/|$)|\.(?:exe|msi|log|db|sqlite|pfx|p12|pem|key)$/i;
const keys=/(?:AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{35,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})/g;
for(const file of files){
 if(denied.test(file)||/(?:^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example')){problems.push({file,reason:'private/generated/binary path'});continue;}
 const text=git(['show',`:${file}`]);
 for(const match of text.matchAll(keys)){
  // Exact, long-standing synthetic fixture used by the sensitive-content test.
  if(file==='src-tauri/src/core/translation_document.rs'&&match[0]===['sk','abcdefghijklmnopqrstuvwxyz1234567890'].join('-')){synthetic++;continue;}
  problems.push({file,reason:'credential-shaped value'});
 }
 if(/C:[/\\]+Users[/\\]+Administrator/.test(text))problems.push({file,reason:'personal machine path'});
}
if(git(['diff','--cached','--name-only','--','LICENSE']).trim())problems.push({file:'LICENSE',reason:'upstream license must be preserved'});
const result={stagedFiles:files.length,problems,syntheticFixtures:synthetic,binaryAssetsStaged:files.some(f=>/\.(exe|msi)$/i.test(f))};
if(fs.existsSync('build-cache.local/performance-release'))fs.writeFileSync('build-cache.local/performance-release/source-safety.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(problems.length)process.exitCode=1;
