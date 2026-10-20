import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Dialog } from "./ui";
import { toast } from "sonner";

interface Props {
  open: boolean; title?: string; message: string; details?: string[]; confirmLabel?: string;
  tone?: "danger" | "warning"; lockWhileRunning?: boolean;
  onClose: () => void; onConfirm: () => Promise<void>;
}
export function ConfirmDialog({ open, title, message, details, confirmLabel, tone = "danger", lockWhileRunning = false, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const locked = lockWhileRunning && loading;
  async function confirm() {
    setLoading(true);
    try { await onConfirm(); onClose(); } catch (error) { toast.error(String(error)); } finally { setLoading(false); }
  }
  return <Dialog open={open} locked={locked} onClose={onClose}
    title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />{title || t("common.confirm")}</span>}
    footer={<><Button disabled={locked} onClick={onClose}>{t("common.cancel")}</Button><Button variant={tone === "warning" ? "primary" : "danger"} disabled={loading} onClick={() => void confirm()}>{loading ? t("common.loading") : confirmLabel || t("common.delete")}</Button></>}>
    <p className="text-[13px] leading-6 text-tertiary">{message}</p>
    {!!details?.length && <div className="mt-4 flex flex-wrap gap-2">{details.map(detail => <span key={detail} className="app-badge break-all">{detail}</span>)}</div>}
  </Dialog>;
}
