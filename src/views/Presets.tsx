import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { Button, Card, Badge, EmptyState, PageHeader } from "../components/ui";
import { CreatePresetDialog } from "../components/CreatePresetDialog";
import { RenamePresetDialog } from "../components/RenamePresetDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import * as api from "../lib/tauri";

export function Presets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { presets, managedSkills, setViewedPresetId, refreshPresets, refreshManagedSkills } = useApp();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<api.Preset | null>(null);
  const [deleting, setDeleting] = useState<api.Preset | null>(null);
  async function run(action: () => Promise<unknown>) {
    try { await action(); await Promise.all([refreshPresets(), refreshManagedSkills()]); }
    catch (error) { toast.error(String(error)); throw error; }
  }
  return <div className="app-page">
    <PageHeader title="Presets" description={t("ui.presetsHint")} actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t("ui.newPreset")}</Button>} />
    {presets.length === 0 ? <EmptyState title={t("ui.emptyPresets")} description={t("ui.emptyPresetsHint")} /> :
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{presets.map(preset => {
        const count = managedSkills.filter(skill => skill.preset_ids.includes(preset.id)).length;
        return <Card key={preset.id} className="flex flex-col p-4">
          <div className="mb-3 flex items-center gap-2"><Layers className="h-4 w-4 text-accent" /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{preset.name}</h2><Badge>{count} Skills</Badge></div>
          <p className="mb-5 min-h-10 text-xs leading-5 text-muted">{preset.description || t("ui.presetsHint")}</p>
          <div className="mt-auto flex items-center gap-1">
            <Button onClick={() => { setViewedPresetId(preset.id); navigate("/my-skills"); }}>{t("ui.open")}<ArrowRight className="h-3 w-3" /></Button><span className="flex-1" />
            <Button variant="ghost" aria-label={`${t("ui.edit")} ${preset.name}`} onClick={() => setEditing(preset)}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" aria-label={`${t("common.delete")} ${preset.name}`} onClick={() => setDeleting(preset)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </Card>;
      })}</div>}
    <CreatePresetDialog open={creating} onClose={() => setCreating(false)} onCreate={(name, description, icon) => run(() => api.createPreset(name, description, icon))} />
    {editing && <RenamePresetDialog open currentName={editing.name} currentIcon={editing.icon} currentDescription={editing.description} onClose={() => setEditing(null)}
      onRename={(name, icon, description) => run(() => api.updatePreset(editing.id, name, description, icon))} />}
    <ConfirmDialog open={!!deleting} title={t("common.delete")} message={t("ui.deletePresetConfirm", { name: deleting?.name })} onClose={() => setDeleting(null)}
      onConfirm={() => run(() => deleting ? api.deletePreset(deleting.id) : Promise.resolve())} />
  </div>;
}
