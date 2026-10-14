import { useEffect, useState } from "react";
import { Eye, EyeOff, Languages, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  clearTranslationKey,
  setTranslationConsent,
  getTranslationStatus,
  saveTranslationKey,
  testTranslationConnection,
  type FreeTierLimits,
  type TranslationStatus,
} from "../lib/aiTranslation";
import { getErrorMessage } from "../lib/error";

const inputClass = "w-full rounded-lg border border-border-subtle bg-background px-3 py-2 text-[13px] text-primary outline-none focus:border-accent disabled:opacity-60";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] font-medium text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50";

export function AiTranslationSettings() {
  const [status, setStatus] = useState<TranslationStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [freeConfirmed, setFreeConfirmed] = useState(false);
  const [limits, setLimits] = useState<FreeTierLimits>({ rpm: 15, tpm: 250000, rpd: 500 });
  const [busy, setBusy] = useState<"loading" | "save" | "test" | "clear" | "revoke" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const isCooling = cooldown > 0;

  useEffect(() => {
    let active = true;
    getTranslationStatus().then((value) => {
      if (!active) return;
      setStatus(value);
      if (value.limits) setLimits(value.limits);
    }).catch(() => {
      if (active) setError("无法读取 AI 翻译配置，请检查系统安全凭据存储后重新打开设置。");
    }).finally(() => {
      if (active) setBusy(null);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isCooling) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [isCooling]);

  async function save() {
    setBusy("save");
    setError(null);
    try {
      setStatus(await saveTranslationKey(apiKey, limits, freeConfirmed));
      setApiKey("");
      setShowKey(false);
      toast.success("密钥已保存到系统安全凭据存储，尚未测试连接。");
    } catch (err) {
      setError(getErrorMessage(err, "保存密钥失败。"));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setError(null);
    setCooldown(60);
    setStatus((value) => value ? { ...value, last_test_passed: false } : value);
    try {
      setStatus(await testTranslationConnection(freeConfirmed));
      toast.success("连接测试通过：模型已返回校验合格的中文短句。");
    } catch (err) {
      setError(getErrorMessage(err, "连接测试失败，没有自动重试。"));
      // Reload only local status. This does not send another Google request.
      try { setStatus(await getTranslationStatus()); } catch { /* Keep the visible failure. */ }
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    try {
      setStatus(await clearTranslationKey());
      setApiKey("");
      setShowKey(false);
      setFreeConfirmed(false);
      toast.success("已清除保存的密钥和连接测试记录。");
    } catch (err) {
      setError(getErrorMessage(err, "清除密钥失败。"));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy("revoke"); setError(null);
    try { setStatus(await setTranslationConsent(false)); toast.success("已撤销在线翻译授权，已缓存译文仍可阅读。"); }
    catch (err) { setError(getErrorMessage(err, "撤销授权失败。")); }
    finally { setBusy(null); }
  }

  async function openLimits() {
    try {
      await openUrl("https://aistudio.google.com/rate-limit?timeRange=last-28-days&hl=zh-cn");
    } catch {
      setError("无法打开浏览器，请手动访问 aistudio.google.com 的速率限制页面。");
    }
  }

  const validLimits = Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0);
  const connectionLabel = busy === "test" ? "正在测试…"
    : error ? "操作未完成，请查看下方提示"
      : !status?.has_key ? "未配置密钥"
        : !status.last_test_at ? "密钥已保存，连接尚未测试"
          : status.last_test_passed ? "上次连接测试通过" : "上次连接测试未通过";

  return (
    <section aria-labelledby="ai-translation-title">
      <h2 id="ai-translation-title" className="app-section-title mb-3 flex items-center gap-2">
        <Languages className="h-4 w-4 text-accent" />AI 翻译服务
      </h2>
      <div className="app-panel space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-primary">Google Gemini</h3>
            <p className="mt-1 text-[12px] text-muted">当前模型：<span className="font-mono">{status?.model ?? "gemini-3.1-flash-lite"}</span></p>
          </div>
          <span role="status" aria-live="polite" className="rounded-full bg-surface-hover px-3 py-1 text-[12px] text-secondary">{connectionLabel}</span>
        </div>

        <div>
          <label htmlFor="gemini-api-key" className="mb-1.5 block text-[13px] font-medium text-secondary">API Key</label>
          <div className="flex gap-2">
            <input id="gemini-api-key" type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false}
              value={apiKey} disabled={!!busy} placeholder={status?.has_key ? "已安全保存；输入新密钥可替换" : "在此粘贴 API Key"}
              onChange={(event) => { setApiKey(event.target.value); setFreeConfirmed(false); }} className={`${inputClass} font-mono`} />
            <button type="button" disabled={!!busy} onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? "隐藏输入的密钥" : "显示输入的密钥"} aria-pressed={showKey} className={buttonClass}>
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[12px] text-muted">密钥保存到 Windows 凭据管理器；保存后清空输入框，不回读明文。无需发送到对话中。</p>
        </div>

        <div className="rounded-xl border border-border-subtle bg-background/60 p-3.5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-secondary"><ShieldCheck className="h-4 w-4 text-accent" />免费层级核实</span>
            <button type="button" onClick={openLimits} className="text-[12px] text-accent hover:text-accent-light">查看 AI Studio 额度</button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([{ key: "rpm", label: "每分钟请求数 RPM" }, { key: "tpm", label: "每分钟输入 token TPM" }, { key: "rpd", label: "每日请求数 RPD" }] as const).map(({ key, label }) => (
              <label key={key} className="text-[12px] text-muted">{label}
                <input type="number" min={1} max={4294967295} step={1} value={limits[key] || ""}
                  disabled={!!busy || (!!status?.has_key && !apiKey)} className={`${inputClass} mt-1`}
                  onChange={(event) => { setLimits((value) => ({ ...value, [key]: Number(event.target.value) })); setFreeConfirmed(false); }} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-muted">以上是用户记录的项目上限，不代表剩余额度。其他应用也会消耗同一项目的额度。更换项目或开通结算后须重新核实。</p>
          <label className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-secondary">
            <input type="checkbox" checked={freeConfirmed} disabled={!!busy} className="mt-1 accent-accent"
              onChange={(event) => setFreeConfirmed(event.target.checked)} />
            <span>我已在 AI Studio 确认这把密钥所属项目当前为 Free Tier，未启用付费使用，且该模型额度与上方记录一致。</span>
          </label>
          <p className="mt-2 text-[12px] leading-5 text-muted">这是用户核实记录。软件无法仅凭 API Key 自动证明计费层级；未确认时不会发送测试请求。</p>
        </div>

        <div className="rounded-xl border border-border-subtle p-3 text-[12px] leading-5 text-secondary">
          <p>在线翻译授权：{status?.authorized ? "已授权并记住" : "尚未授权或已撤销"}</p>
          {status?.authorized_at && <p className="text-muted">授权时间：{new Date(status.authorized_at).toLocaleString("zh-CN")}</p>}
          <p className="mt-1 text-muted">普通文字发送至 Google Gemini 免费 API；代码、链接地址和配置在本地保护。免费服务数据可能用于改进 Google 产品。更换密钥或重要规则变化后需重新确认，不会自动启用付费服务。</p>
          {status?.authorized && <button type="button" className={`${buttonClass} mt-2`} disabled={!!busy} onClick={() => void revoke()}>撤销在线翻译授权</button>}
        </div>
        <p className="text-[12px] leading-5 text-muted">点击“测试连接”将向 Google 官方 API 发送固定短句 Hello，并验证中文响应。不发送 Skill 文档。每次测试最多发起一次生成请求，间隔至少 60 秒，不自动重试或切换模型。</p>
        {error && <p role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-300">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={!!busy || !apiKey.trim() || !freeConfirmed || !validLimits}
            className={`${buttonClass} border-accent-border bg-accent-bg text-accent`}>
            {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存配置
          </button>
          <button type="button" onClick={test} disabled={!!busy || !status?.has_key || !!apiKey || !freeConfirmed || isCooling}
            className={buttonClass}>
            {busy === "test" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy === "test" ? "正在测试连接" : isCooling ? `稍后测试（${cooldown}秒）` : "测试连接"}
          </button>
          <button type="button" onClick={clear} disabled={!!busy || !status?.has_key} className={buttonClass}>
            {busy === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}清除已保存密钥
          </button>
        </div>
        {status?.last_test_at && <p className="text-[12px] text-muted">上次测试时间：{new Date(status.last_test_at).toLocaleString("zh-CN")}</p>}
        <p className="text-[12px] text-muted">连接测试通过后，可在 Skill 详情页点击“中文翻译”或“中英对照”。列表“中文摘要”开关只读取缓存，不会自动批量翻译。</p>
      </div>
    </section>
  );
}
