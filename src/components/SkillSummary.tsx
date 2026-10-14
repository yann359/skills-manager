import { useCallback, useEffect, useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getCachedSummary, getTranslationStatus } from "../lib/aiTranslation";
import { useChineseSummaries } from "../hooks/useChineseSummaries";
import { useSkillTranslation } from "../hooks/useSkillTranslation";
import { TranslationConsent } from "./TranslationConsent";
import { prepareTranslationInput, validateTranslatedMarkdown, plainSummary } from "../lib/translationMarkdown";

export function ChineseSummaryToggle() {
  const [enabled, toggle] = useChineseSummaries();
  return <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-2 text-[12px] text-secondary" title="只显示缓存中的中文摘要；不会自动翻译全部 Skills">
    <input type="checkbox" checked={enabled} onChange={event => toggle(event.target.checked)} className="accent-accent" /><Languages className="h-3.5 w-3.5" />中文摘要
  </label>;
}

export function SkillSummary({ name, description }: { name: string; description?: string | null }) {
  const [enabled] = useChineseSummaries();
  const [cached, setCached] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const raw = description ?? "";
  const { translation, busy, error, start } = useSkillTranslation(name, "", raw);
  const close = useCallback(() => setConsent(false), []);
  async function requestTranslation() {
    try { if ((await getTranslationStatus()).authorized) { void start(false); return; } }
    catch { /* Show configuration guidance in the first-use dialog. */ }
    setConsent(true);
  }
  useEffect(() => {
    if (!enabled || !raw) return;
    let active = true;
    const load = () => { void getCachedSummary(name, raw).then(value => {
      if (!active) return;
      if (value) validateTranslatedMarkdown(prepareTranslationInput(name, "", raw), { content: "", description: value });
      setCached(value);
    }).catch(() => { if (active) setCached(null); }); };
    load(); window.addEventListener("skill-translation-cached", load);
    return () => { active = false; window.removeEventListener("skill-translation-cached", load); };
  }, [enabled, name, raw]);
  useEffect(() => { if (error) toast.error(error); }, [error]);
  const rawChinese = translation?.description || cached;
  const chinese = rawChinese ? plainSummary(rawChinese) : null;
  return <span className="inline-flex w-full min-w-0 items-center gap-2">
    <span className="min-w-0 flex-1 truncate" title={enabled && chinese ? chinese : raw}>{enabled && chinese ? chinese : raw || "—"}</span>
    {enabled && raw && !chinese && <button type="button" disabled={busy} className="inline-flex shrink-0 items-center gap-1 text-[11px] text-accent" title="仅翻译这个 Skill 的 Description" onClick={event => { event.stopPropagation(); void requestTranslation(); }}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}{busy ? "翻译中" : error ? "重试" : "翻译摘要"}
    </button>}
    {consent && <TranslationConsent name={`${name} 摘要`} open={true} onClose={close} onConfirm={() => { setConsent(false); void start(true); }} />}
  </span>;
}
