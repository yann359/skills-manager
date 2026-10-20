import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, CheckCircle2, Bot, Plus, ArrowUpRight, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { AgentControlSetupCard } from "../components/AgentControlSetupCard";
import { AgentIcon } from "../components/AgentIcon";
import { Badge, Button, Card, EmptyState, LoadingState, PageHeader } from "../components/ui";

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tools, projects, managedSkills, loading, openSkillDetailById } = useApp();
  const agents = useMemo(() => tools.filter(tool => tool.installed && tool.enabled), [tools]);
  const synced = managedSkills.filter(skill => skill.targets.length > 0).length;
  const diverged = projects.reduce((sum, project) => sum + project.sync_health.diverged, 0);
  const recent = useMemo(() => [...managedSkills].sort((a, b) => b.updated_at - a.updated_at).slice(0, 8), [managedSkills]);
  return <div className="app-page">
    <PageHeader title={t("ui.overview")} description={t("ui.overviewHint")}
      actions={<><Button onClick={() => navigate("/install?tab=local")}><FolderOpen className="h-3.5 w-3.5" />{t("dashboard.scanImport")}</Button><Button variant="primary" onClick={() => navigate("/install")}><Plus className="h-3.5 w-3.5" />{t("dashboard.installNew")}</Button></>} />
    <AgentControlSetupCard />
    {loading ? <LoadingState label={t("common.loading")} /> : <>
      <Card className="grid grid-cols-3">
        {[{ label: t("dashboard.librarySkills"), value: managedSkills.length, icon: Layers },
          { label: t("dashboard.syncCoverage"), value: `${synced}/${managedSkills.length}`, icon: CheckCircle2 },
          { label: t("dashboard.connectedAgents"), value: agents.length, icon: Bot }].map(item =>
          <div className="dashboard-stat" key={item.label}><div className="flex items-center gap-2 text-xs text-muted"><item.icon className="h-3.5 w-3.5" />{item.label}</div><strong>{item.value}</strong></div>)}
      </Card>
      {diverged > 0 && <button onClick={() => navigate("/backup")} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-700 dark:text-amber-300">{t("ui.conflicts", { count: diverged })}<ArrowUpRight className="ml-2 inline h-3 w-3" /></button>}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,1fr)]">
        <section className="min-w-0"><div className="mb-2 flex items-center justify-between"><h2 className="app-section-title">{t("ui.recent")}</h2><Button variant="ghost" onClick={() => navigate("/my-skills")}>{t("ui.openLibrary")}<ArrowUpRight className="h-3 w-3" /></Button></div>
          <Card>{recent.length === 0 ? <EmptyState title={t("dashboard.librarySkills")} description={t("ui.installHint")} action={<Button onClick={() => navigate("/install")}>{t("install.title")}</Button>} /> : recent.map(skill =>
            <button key={skill.id} className="dashboard-row w-full text-left" onClick={() => { openSkillDetailById(skill.id); navigate("/my-skills"); }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-bg text-accent"><Layers className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-primary">{skill.name}</div><div className="mt-0.5 truncate text-[11px] text-muted">{skill.description || skill.central_path}</div></div>
              <Badge>{skill.source_type === "skillssh" ? "skills.sh" : skill.source_type}</Badge><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint" />
            </button>)}</Card>
        </section>
        <section className="min-w-0"><div className="mb-2 flex h-8 items-center justify-between"><h2 className="app-section-title">{t("ui.agents")}</h2><Badge>{agents.length}</Badge></div>
          <Card>{agents.length === 0 ? <EmptyState title={t("ui.noAgents")} action={<Button onClick={() => navigate("/settings")}>{t("settings.title")}</Button>} /> : agents.map(tool =>
            <button key={tool.key} className="dashboard-row w-full text-left" onClick={() => navigate(`/${tool.category === "lobster" ? "lobster" : "global"}-workspace/${tool.key}`)}>
              <AgentIcon agentKey={tool.key} displayName={tool.display_name} className="h-8 w-8" />
              <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{tool.display_name}</div><div className="mt-0.5 truncate text-[11px] text-muted">{tool.skills_dir}</div></div><Badge>{managedSkills.filter(skill => skill.targets.some(target => target.tool === tool.key)).length}</Badge>
            </button>)}</Card>
          <Card className="mt-3 p-4"><div className="mb-2 flex items-center gap-2 text-xs font-medium"><FolderOpen className="h-4 w-4 text-muted" />{t("sidebar.projects")}<Badge>{projects.length}</Badge></div>
            {projects.slice(0, 4).map(project => <button key={project.id} className="flex w-full items-center justify-between py-2 text-xs text-muted hover:text-accent" onClick={() => navigate(`/project/${project.id}`)}><span className="truncate">{project.name}</span><ArrowUpRight className="h-3 w-3" /></button>)}
          </Card>
        </section>
      </div>
    </>}
  </div>;
}
