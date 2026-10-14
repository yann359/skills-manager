import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelTranslation, getCachedTranslation, rejectTranslationFragments, translateDocument, type TranslationProgress, type TranslationResult } from "../lib/aiTranslation";
import { prepareTranslationInput, retainValidFragments } from "../lib/translationMarkdown";
import { getErrorMessage } from "../lib/error";

export function useSkillTranslation(name: string, content: string, description: string) {
  const input = useMemo(() => prepareTranslationInput(name, content, description), [name, content, description]);
  const [entry, setEntry] = useState<{ input: typeof input; value: TranslationResult } | null>(null);
  const translation = entry?.input === input ? entry.value : null;
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [invalidCache, setInvalidCache] = useState(false);
  const job = useRef<string | null>(null);
  const generation = useRef(0);
  const lastAttempt = useRef<{ input: typeof input; force: boolean } | null>(null);

  useEffect(() => {
    const current = ++generation.current;
    setCacheLoading(true); setBusy(false); setProgress(null); setError(null); setInvalidCache(false);
    getCachedTranslation(input).then((value) => {
      if (generation.current !== current) return;
      if (value) {
        const checked = retainValidFragments(input, value);
        setEntry({ input, value: checked.value });
        if (checked.rejected.length) {
          void rejectTranslationFragments(input, checked.rejected).catch(() => {});
          setError("部分片段未通过 Markdown 校验，已保留其他中文；可重试问题片段。");
          return;
        }
      } else setEntry(null);
      setInvalidCache(false);
      setError(null);
    }).catch((err) => {
      if (generation.current === current) { setEntry(null); setError(getErrorMessage(err, "读取缓存失败，继续显示原文。")); }
    }).finally(() => { if (generation.current === current) setCacheLoading(false); });
    return () => {
      generation.current = current + 1;
      if (job.current) { void cancelTranslation(job.current).catch(() => {}); job.current = null; }
    };
  }, [input]);

  const start = useCallback(async (freeConfirmed: boolean, force = false) => {
    if (job.current) return;
    lastAttempt.current = { input, force };
    const id = crypto.randomUUID(); job.current = id;
    const current = generation.current;
    setBusy(true); setError(null); setProgress(null);
    try {
      const value = await translateDocument(input, freeConfirmed, force, id, (next) => {
        if (generation.current === current && job.current === id) {
          setProgress(next);
          if (next.preview) {
            try { const checked = retainValidFragments(input, next.preview); setEntry({ input, value: checked.value }); if (checked.rejected.length) void rejectTranslationFragments(input, checked.rejected).catch(() => {}); }
            catch { /* Keep the most recent verified preview. */ }
          }
        }
      });
      const checked = retainValidFragments(input, value);
      if (generation.current === current) {
        if (checked.rejected.length) {
          await rejectTranslationFragments(input, checked.rejected);
          setError("部分片段未通过 Markdown 校验，已保留其他中文；重试只处理问题片段。");
        }
        setEntry({ input, value: checked.value });
        setInvalidCache(false);
        window.dispatchEvent(new CustomEvent("skill-translation-cached", { detail: { name, description } }));
      }
    } catch (err) {
      if (generation.current === current) {
        setError(getErrorMessage(err, "翻译失败，已完成中文保留。请手动重试未完成片段。"));
        try {
          const value = await getCachedTranslation(input);
          if (value && generation.current === current) { const checked = retainValidFragments(input, value); setEntry({ input, value: checked.value }); if (checked.rejected.length) await rejectTranslationFragments(input, checked.rejected); }
        } catch { /* Do not discard a previously verified partial preview. */ }
      }
    } finally {
      if (job.current === id) job.current = null;
      if (generation.current === current) setBusy(false);
    }
  }, [input, name, description]);

  const cancel = useCallback(() => { if (job.current) void cancelTranslation(job.current).catch(() => {}); }, []);
  return { input, translation, progress, busy, error, cacheLoading, invalidCache, resumeForce: lastAttempt.current?.input === input && lastAttempt.current.force, start, cancel };
}
