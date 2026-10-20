import { Command, Moon, Sun, ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { useThemeContext } from "../context/ThemeContext";
import { Button } from "./ui";

export function AppTopbar() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { tools, projects } = useApp();
  const { resolvedTheme, setTheme } = useThemeContext();
  const agent = tools.find(tool => pathname.endsWith(`/${tool.key}`));
  const project = projects.find(item => pathname === `/project/${item.id}`);
  const titles: Record<string, string> = {
    "/": "Dashboard", "/my-skills": t("mySkills.title"), "/install": t("install.title"),
    "/backup": t("backup.title"), "/settings": t("settings.title"),
    "/presets": "Presets", "/global-workspace": t("sidebar.globalWorkspace"),
    "/lobster-workspace": t("sidebar.lobsterAgents"),
  };
  return <header className="app-topbar">
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span className="shrink-0">Workspace</span><ChevronRight className="h-3 w-3 shrink-0" />
      <span className="truncate font-medium text-secondary">{agent?.display_name ?? project?.name ?? titles[pathname] ?? "Skills"}</span>
    </div>
    <div className="flex shrink-0 items-center gap-1.5">
      {import.meta.env.MODE === "demo" && <a className="app-badge text-accent" href="https://github.com/yann359/skills-manager/releases/latest" target="_blank" rel="noreferrer" title="下载 Windows 桌面版">演示 · 下载桌面版 ↗</a>}
      <Button variant="ghost" title={t("ui.commandSearch")} aria-label={t("ui.commandSearch")}
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}>
        <Command className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t("ui.commandSearch")}</span><kbd className="ml-2 hidden text-[10px] text-faint lg:inline">Ctrl K</kbd>
      </Button>
      <Button variant="ghost" title={t("ui.changeTheme")} aria-label={t("ui.changeTheme")} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
        {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </div>
  </header>;
}
