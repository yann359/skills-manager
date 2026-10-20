import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

/** Uses existing headings, so every settings/backup section stays reachable. */
export function SectionNav() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const [headings, setHeadings] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => {
    const root = document.querySelector("main");
    if (!root) return;
    const collect = () => {
      const next = [...root.querySelectorAll("section h2")].map((node, index) => {
        node.id ||= `section-${index}`;
        return { id: node.id, text: node.textContent ?? "" };
      });
      setHeadings(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);
  return <nav className="section-nav" aria-label={t("ui.sections")}>
    {headings.map(item => <button key={item.id} className="ui-button ui-button-ghost" onClick={() => document.getElementById(item.id)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}>{item.text}</button>)}
  </nav>;
}
