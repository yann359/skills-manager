import { useCallback, useState } from "react";
import { Languages, Loader2, RefreshCw } from "lucide-react";
import { SkillMarkdown } from "./SkillMarkdown";
import { TranslationConsent } from "./TranslationConsent";
import { useSkillTranslation } from "../hooks/useSkillTranslation";
import { markdownBlocks, markdownBlockEntries } from "../lib/translationMarkdown";
import { getTranslationStatus } from "../lib/aiTranslation";
import { Tabs } from "./ui";

type Mode = "original" | "chinese" | "bilingual";
export function SkillTranslationReader({ name, content, description = "" }: { name: string; content: string; description?: string }) {
  const [mode, setMode] = useState<Mode>("original");
  const [consent, setConsent] = useState<"new" | "force" | null>(null);
  const [checking, setChecking] = useState(false);
  const { input, translation, progress, busy, error, cacheLoading, invalidCache, resumeForce, start, cancel } = useSkillTranslation(name, content, description);
  const closeConsent = useCallback(() => setConsent(null), []);
  async function requestTranslation(force = resumeForce) {
    if (busy || checking) return;
    setChecking(true);
    try {
      const status = await getTranslationStatus();
      if (status.authorized) void start(false, force);
      else setConsent(force ? "force" : "new");
    } catch { setConsent(force ? "force" : "new"); }
    finally { setChecking(false); }
  }
  function select(next: Mode) {
    setMode(next);
    if ((next === "chinese" ? !translation?.complete || !!error : next === "bilingual" && !translation) && !busy && !cacheLoading) void requestTranslation(resumeForce || invalidCache);
  }
  const chinese = mode !== "original" && !!translation;
  const progressText = progress ? `${progress.state === "waiting" ? "等待免费层级限流窗口" : "正在翻译"} · 已完成 ${progress.completed}/${progress.total} 个文本片段` : "正在准备翻译…";
  // Pair AST blocks, so nested lists, tables, code and reference links stay intact.
  function pairedBlocks() {
    const originals = markdownBlockEntries(content);
    const translated = markdownBlocks(translation!.content);
    return originals.map((original, index) => ({ original: original.content, chinese: translated[index] ?? original.content, pending: translation!.pending.some(span => span.field === "content" && span.start < original.end && span.end > original.start) }));
  }
  return <div className={mode === "bilingual" ? "skill-reader skill-reader-wide" : "skill-reader"}>
    <div className="reader-toolbar" aria-label="文档阅读模式">
      <Tabs value={mode} onChange={select} label="文档阅读模式" items={[
        {value:"original",label:"英文原文"},
        {value:"chinese",label:<><Languages className="h-3.5 w-3.5" />中文翻译</>,disabled:cacheLoading},
        {value:"bilingual",label:"中英对照",disabled:cacheLoading},
      ]} />
      {translation && <span className="flex items-center gap-2 text-[12px] text-muted" title={translation.rule ? `翻译规则：${translation.rule}` : undefined}>{!translation.complete ? `已缓存 ${translation.completed}/${translation.total} 个片段` : translation.legacy_cache ? "已读取旧规则缓存" : translation.cached ? "已读取本地缓存" : "译文已缓存"}<button type="button" disabled={busy || checking} onClick={() => void requestTranslation(translation.complete)} className="inline-flex items-center gap-1 text-accent"><RefreshCw className="h-3 w-3" />{translation.complete ? "重新翻译" : "继续未完成片段"}</button></span>}
    </div>
    {busy && <div className="mb-3 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-[12px] text-secondary" role="status"><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progressText}</span><button type="button" onClick={cancel} className="text-muted">取消翻译</button></div><progress className="mt-2 h-1.5 w-full accent-accent" max={progress?.total || 1} value={progress?.completed || 0} /></div>}
    {error && <div role="alert" className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[12px] leading-5 text-amber-700 dark:text-amber-300">{error}<button type="button" disabled={busy} className="ml-3 text-accent" onClick={() => void requestTranslation(resumeForce || invalidCache)}>重试翻译</button></div>}
    {mode !== "original" && !translation && !busy && !cacheLoading && <p className="mb-4 text-[12px] text-muted">尚无中文缓存，当前保留英文原文。<button type="button" onClick={() => void requestTranslation(invalidCache)} className="ml-2 text-accent">开始翻译</button></p>}
    {mode !== "original" && translation && !translation.complete && <p role="status" className="mb-4 text-[12px] text-muted">已完成中文可直接阅读；未完成的 {translation.total - translation.completed} 个片段保留英文，继续翻译只请求剩余部分。</p>}
    {description && <div className="reader-description mb-4 border-l-2 border-accent-border pl-3"><p className="mb-2 text-[12px] font-medium text-muted">Skill Description{chinese && translation!.pending.some(span => span.field === "description") ? " · 含未完成英文" : ""}</p><SkillMarkdown content={chinese ? translation!.description : description} />{mode === "bilingual" && translation && <div className="mt-3 border-t border-border-subtle pt-3"><p className="mb-2 text-[12px] text-muted">英文原文</p><SkillMarkdown content={description} /></div>}</div>}
    {mode === "bilingual" && translation ? <div className="space-y-1">{pairedBlocks().map((block, index) => <div key={index} className="grid grid-cols-1 gap-6 border-b border-border-faint py-3 xl:grid-cols-2"><div className="min-w-0"><span className="mb-2 block text-[11px] text-muted">中文{block.pending ? " · 本段含未完成英文" : ""}</span><SkillMarkdown content={block.chinese} /></div><div className="min-w-0"><span className="mb-2 block text-[11px] text-muted">English</span><SkillMarkdown content={block.original} /></div></div>)}</div> : chinese && !translation!.complete ? <div>{pairedBlocks().map((block, index) => <div key={index}>{block.pending && <span className="mb-1 block text-[11px] text-amber-700 dark:text-amber-300">本段含未完成片段，保留英文</span>}<SkillMarkdown content={block.chinese} /></div>)}</div> : <SkillMarkdown content={chinese ? translation!.content : content} />}
    <TranslationConsent key={consent ?? "closed"} name={name} open={!!consent} force={consent === "force"} onClose={closeConsent} onConfirm={() => { const force = consent === "force"; setConsent(null); void start(true, force); }} />
    <span className="sr-only">{input.skill_name}</span>
  </div>;
}
