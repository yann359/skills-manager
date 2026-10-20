import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { AppTopbar } from "./AppTopbar";
import { Sidebar } from "./Sidebar";
import { StatusBanner } from "./StatusBanner";
import { CommandPalette } from "./CommandPalette";
import { useApp } from "../context/AppContext";
import { useTranslation } from "react-i18next";
import { useDragWindow } from "../hooks/useDragWindow";

export function Layout() {
  const { t } = useTranslation();
  const { appError, refreshAppData } = useApp();
  const onDrag = useDragWindow();
  const navigate = useNavigate();
  const location = useLocation();

  // Cmd+, to open Settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        navigate("/settings");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        refreshAppData();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, refreshAppData]);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background text-primary">
      {/* Full-width top drag bar — spans sidebar + content, with bottom divider */}
      <div
        onMouseDown={onDrag}
        className="absolute inset-x-0 top-0 z-50 h-[28px] border-b border-border-subtle bg-bg-secondary"
      />
      <Sidebar />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="h-[28px] shrink-0" />
        <AppTopbar />
        <main id="main-content" tabIndex={0} className="app-scroll-region flex-1 px-5 pb-4 pt-4" data-page={location.pathname.split("/")[1] || "dashboard"}>
          <div className="page-enter mx-auto flex min-h-full min-w-0 max-w-[1440px] flex-col gap-3">
            {appError ? (
              <StatusBanner
                compact
                title={t("common.dataOutOfDate")}
                description={appError}
                actionLabel={t("common.retry")}
                onAction={refreshAppData}
                tone="danger"
              />
            ) : null}
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
