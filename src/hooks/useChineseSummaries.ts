import { useEffect, useState } from "react";
const KEY = "skills-manager-chinese-summaries";
const EVENT = "chinese-summaries-changed";
function read() { try { return localStorage.getItem(KEY) === "true"; } catch { return false; } }
export function useChineseSummaries() {
  const [enabled, setEnabled] = useState(read);
  useEffect(() => { const update = () => setEnabled(read()); window.addEventListener(EVENT, update); return () => window.removeEventListener(EVENT, update); }, []);
  function toggle(value: boolean) { try { localStorage.setItem(KEY, String(value)); } catch { /* Display preference only. */ } setEnabled(value); window.dispatchEvent(new Event(EVENT)); }
  return [enabled, toggle] as const;
}
