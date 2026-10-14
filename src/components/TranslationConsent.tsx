import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getTranslationStatus, setTranslationConsent } from "../lib/aiTranslation";

export function TranslationConsent({ name, open, force = false, onClose, onConfirm }: { name: string; open: boolean; force?: boolean; onClose: () => void; onConfirm: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  async function authorize() {
    setSaving(true);
    try { await setTranslationConsent(true); onConfirm(); }
    catch { setMessage("无法保存授权，请检查系统安全凭据存储后重试。"); }
    finally { setSaving(false); }
  }
  const [message, setMessage] = useState("正在读取本地连接状态…");
  useEffect(() => {
    if (!open) return;
    let active = true;
    getTranslationStatus().then(status => {
      if (!active) return;
      setReady(status.has_key && status.last_test_passed);
      setMessage(!status.has_key ? "尚未配置 API Key，请前往设置中的 AI 翻译服务。" : !status.last_test_passed ? "请先在设置中完成连接测试。" : `使用 ${status.model}；已记录上限 ${status.limits?.rpm} RPM / ${status.limits?.rpd} RPD。`);
    }).catch(() => { if (active) { setReady(false); setMessage("无法读取安全凭据，请检查设置中的 AI 翻译服务。"); } });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", escape, true);
    return () => { active = false; window.removeEventListener("keydown", escape, true); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(<div className="fixed inset-0 z-[70] flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-labelledby="translation-consent-title" onClick={event => event.stopPropagation()}>
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
    <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
      <h2 id="translation-consent-title" className="text-[16px] font-semibold text-primary">{force ? "重新翻译" : "中文翻译"} · {name}</h2>
      <p className="mt-3 text-[13px] leading-6 text-secondary">普通说明文字将发送到 Google 官方 Gemini API，免费服务的数据可能用于改进 Google 产品。请仅翻译适合发送到第三方的文档。原始文件只读；代码、配置、链接地址和技术标识由程序在本地保护。授权将被记住，可随时在设置中撤销；更换密钥、服务商或重要隐私及计费规则变化后需重新确认。</p>
      <p className="mt-2 text-[12px] leading-5 text-muted">{message}</p>
      {force && <p className="mt-2 text-[12px] text-amber-600">重新翻译会再次消耗额度；成功前保留现有缓存。</p>}
      <label className="mt-4 flex items-start gap-2 text-[12px] leading-5 text-secondary"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 accent-accent" /><span>我确认密钥所属项目为 Free Tier，未开通付费使用，同意在线翻译并记住此次授权。</span></label>
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-surface-hover">取消</button><button type="button" disabled={!ready || !confirmed || saving} onClick={() => void authorize()} className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40">{saving ? "正在保存授权…" : "同意并记住授权"}</button></div>
    </div>
  </div>, document.body);
}
