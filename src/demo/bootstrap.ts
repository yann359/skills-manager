/** Browser-only showcase. Vite removes this module from desktop builds.
 * All data is invented; this module never reads an actual Skill or credential.
 * Writes are explicitly allowlisted and affect this browser session only.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { ManagedSkill, Preset, ToolInfo, Project } from "../lib/tauri";

const tools: ToolInfo[] = [["codex", "Codex"], ["claude_code", "Claude Code"], ["pi", "Pi"]].map(([key, display_name]) => ({
  key, display_name, installed: true, enabled: true, is_custom: false,
  skills_dir: `~/demo/${key}/skills`, has_path_override: false,
  project_relative_skills_dir: `.${key}/skills`, has_project_path_override: false, category: "coding",
}));
const descriptions = [
  ["hyperframes-keyframes", "用关键帧组织运动节奏，构建清晰、可重复的动画。", "Creative"],
  ["frontend-design", "从设计规范到界面实现，创建精致而实用的产品体验。", "Design"],
  ["code-review", "检查代码边界、可维护性和回归风险。", "Development"],
  ["accessibility-audit", "检查键盘操作、对比度与屏幕阅读器体验。", "Design"],
  ["react-patterns", "复用可靠的组件模式，让界面保持一致。", "Development"],
  ["document-reader", "从文档中提取结构、关键问题和行动项。", "Productivity"],
  ["release-checklist", "整理版本说明、构建产物与发布检查。", "Development"],
  ["project-planner", "将目标拆分成可执行、可验证的小步骤。", "Productivity"],
  ["motion-design", "用轻量动效表达状态变化与内容关系。", "Creative"],
  ["test-workflows", "规划组件、交互与端到端验证。", "Development"],
  ["writing-editor", "将复杂内容整理成清晰易读的文字。", "Productivity"],
  ["design-tokens", "统一颜色、字体、间距和交互状态。", "Design"],
];
let skills: ManagedSkill[] = descriptions.map(([name, description, tag], i) => ({
  id: `demo-${i}`, name, description, source_type: i % 3 === 0 ? "git" : i % 3 === 1 ? "local" : "skillssh",
  source_ref: null, source_ref_resolved: null, source_subpath: null, source_branch: null,
  source_revision: null, remote_revision: null, update_status: "up_to_date", last_checked_at: null, last_check_error: null,
  central_path: `~/Skills/${name}`, enabled: true, created_at: 1, updated_at: 100 - i, status: "ok",
  targets: tools.filter((_, j) => (i + j) % 3 !== 2).map(tool => ({
    id: `${i}-${tool.key}`, skill_id: `demo-${i}`, tool: tool.key, target_path: `${tool.skills_dir}/${name}`, mode: "symlink", status: "ok", synced_at: 1,
  })),
  preset_ids: [i % 2 ? "development" : "creative"], tags: [tag],
}));
let presets: Preset[] = [
  { id: "creative", name: "Creative studio", description: "界面设计、动效与创意表达", icon: null, sort_order: 0, skill_count: 6, created_at: 1, updated_at: 1 },
  { id: "development", name: "Daily development", description: "编码、检查、测试与发布", icon: null, sort_order: 1, skill_count: 6, created_at: 1, updated_at: 1 },
];
const projects: Project[] = [{
  id: "demo-project", name: "Design system", path: "~/Projects/design-system", workspace_type: "project",
  linked_agent_name: null, supports_skill_toggle: true, sort_order: 0, skill_count: 4,
  sync_health: { in_sync: 4, project_newer: 0, center_newer: 0, diverged: 0, project_only: 0 }, created_at: 1, updated_at: 1,
}];
const settings = new Map<string, string>([
  ["language", localStorage.getItem("language") || "zh"], ["theme", localStorage.getItem("theme") || "light"],
  ["agent_control_setup_prompt", "dismissed"], ["backup_first_run_prompt", "dismissed"],
]);
// Original sample copy, not the user's installed Skill content.
function sampleDocument(name: string) {
  return `# ${name}\n\n> 这是在线演示文档，用于展示阅读体验。下载桌面版后可查看与管理自己的 Skills。\n\n## Overview\n\nGood tools make complex work feel simple. This sample demonstrates headings, lists, tables and code without accessing files on your computer.\n\n## Working principles\n\n- Start with a clear outcome.\n- Keep changes small and reviewable.\n- Verify the result before publishing.\n\n## Example\n\n\`\`\`typescript\nconst workflow = {\n  name: "${name}",\n  steps: ["Discover", "Build", "Verify"],\n  duration: 240,\n};\n\`\`\`\n\n| Stage | Goal | Output |\n| --- | --- | --- |\n| Discover | Understand the task | A clear plan |\n| Build | Create the experience | A working draft |\n| Verify | Check the details | A reliable result |\n\n` +
    Array.from({ length: name === "hyperframes-keyframes" ? 18 : 4 }, (_, i) =>
      `## ${i + 1}. ${["Plan the sequence", "Refine the detail", "Check the result"][i % 3]}\n\nA deliberate workflow keeps the important details visible. Define the starting point and the intended result, then verify each change in context. Use a consistent rhythm, meaningful labels and clear feedback.\n\n1. Identify the current state.\n2. Make one focused adjustment.\n3. Confirm that the result matches the intent.\n\n\`\`\`css\n.example-${i + 1} {\n  transition: transform 160ms ease, opacity 160ms ease;\n  border-radius: 8px;\n}\n\`\`\`\n\n`).join("");
}
function localSkills(agent: string) {
  return skills.map(skill => ({
    name: skill.name, dir_name: skill.name, relative_path: skill.name, path: `${tools.find(tool => tool.key === agent)?.skills_dir}/${skill.name}`,
    description: skill.description, files: ["SKILL.md"], enabled: skill.targets.some(target => target.tool === agent),
    agent, agent_display_name: tools.find(tool => tool.key === agent)?.display_name ?? agent,
    tags: skill.tags, in_center: true, sync_status: "in_sync", center_skill_id: skill.id,
    managed: true, blocked_reason: null, exposure_paths: skill.targets.filter(target => target.tool === agent).map(target => target.target_path), backup_path: null,
  }));
}
mockWindows("main");
mockIPC((command, rawArgs = {}) => {
  const args = rawArgs as Record<string, unknown>;
  switch (command) {
    case "get_settings": return settings.get(String(args.key)) ?? null;
    case "set_settings": {
      const key = String(args.key);
      if (!["theme", "language", "text_size"].includes(key)) break;
      settings.set(key, String(args.value)); return null;
    }
    case "get_managed_skills": return structuredClone(skills);
    case "get_skills_for_preset": return structuredClone(skills.filter(skill => skill.preset_ids.includes(String(args.presetId))));
    case "get_tool_status": return structuredClone(tools);
    case "get_presets": return structuredClone(presets);
    case "get_active_preset": return presets[0] ?? null;
    case "get_projects": return projects;
    case "get_preset_skill_order": case "git_backup_pending_conflicts": case "get_central_repo_warnings": return [];
    case "get_all_tags": return [...new Set(skills.flatMap(skill => skill.tags))];
    case "slugify_skill_names": return (args.names as string[]).map(name => name.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
    case "get_agent_skill_states": case "get_global_local_skills": return localSkills(String(args.agent));
    case "get_project_skills": return localSkills("codex").slice(0, 4);
    case "get_project_agent_targets": return tools.map(tool => ({ ...tool }));
    case "get_skill_document": case "get_source_skill_document": {
      const skill = skills.find(skill => skill.id === args.skillId) ?? skills[0];
      return { skill_id: skill.id, filename: "SKILL.md", content: sampleDocument(skill.name), central_path: skill.central_path, source_label: "Demo", revision: "demo0001" };
    }
    case "get_agent_skill_document": case "get_global_local_skill_document": case "get_project_skill_document": {
      const name = String(args.skillPath ?? args.skillRelativePath ?? "demo-skill").split("/").pop() ?? "demo-skill";
      return { skill_name: name, filename: "SKILL.md", content: sampleDocument(name) };
    }
    case "get_skill_source_diff": return { skill_id: args.skillId, source_label: "Demo", revision: "demo0001", entries: [] };
    case "get_skill_tool_toggles": return tools.map(tool => ({ tool: tool.key, display_name: tool.display_name, installed: true, globally_enabled: true, enabled: skills.find(skill => skill.id === args.skillId)?.targets.some(target => target.tool === tool.key) ?? false }));
    case "set_agent_skill_enabled": case "set_skill_tool_toggle": {
      const skill = skills.find(skill => skill.id === args.skillId || skill.name === args.skillId);
      const tool = tools.find(tool => tool.key === (args.agent ?? args.tool));
      if (!skill || !tool) break;
      skill.targets = skill.targets.filter(target => target.tool !== tool.key);
      if (args.enabled) skill.targets.push({ id: `${skill.id}-${tool.key}`, skill_id: skill.id, tool: tool.key, target_path: `${tool.skills_dir}/${skill.name}`, mode: "symlink", status: "ok", synced_at: 1 });
      return null;
    }
    case "add_skill_to_preset": case "remove_skill_from_preset": {
      const skill = skills.find(skill => skill.id === args.skillId);
      if (!skill) break;
      skill.preset_ids = skill.preset_ids.filter(id => id !== args.presetId);
      if (command === "add_skill_to_preset") skill.preset_ids.push(String(args.presetId));
      return null;
    }
    case "create_preset": {
      const preset = { id: crypto.randomUUID(), name: String(args.name), description: args.description as string | null, icon: args.icon as string | null, sort_order: presets.length, skill_count: 0, created_at: 1, updated_at: 1 };
      presets.push(preset); return preset;
    }
    case "update_preset": {
      const preset = presets.find(preset => preset.id === args.id);
      if (preset) Object.assign(preset, { name: args.name, icon: args.icon, description: args.description });
      return null;
    }
    case "delete_preset":
      presets = presets.filter(preset => preset.id !== args.id);
      skills = skills.map(skill => ({ ...skill, preset_ids: skill.preset_ids.filter(id => id !== args.id) })); return null;
    case "fetch_leaderboard": case "search_skillssh": return skills.filter(skill => !args.query || skill.name.includes(String(args.query))).map(skill => ({ id: skill.id, skill_id: skill.name, name: skill.name, source: "demo/skills", installs: 1200 }));
    case "scan_local_skills": return { tools_scanned: 3, skills_found: 0, groups: [] };
    case "get_ai_translation_status": return { provider: "Google Gemini", model: "Demo", has_key: false, authorized: false, limits: null };
    case "get_cached_skill_translation": case "get_cached_skill_summary": case "check_last_panic":
    case "get_central_repo_path_override": case "get_central_repo_pending_path": case "git_backup_migrate_credentials": return null;
    case "get_central_repo_path": return "~/Skills";
    case "check_app_update": return { has_update: false, current_version: "Demo", latest_version: "Demo" };
    case "log_startup_event": case "check_all_skill_updates": return null;
    case "git_backup_status": return { is_repo: false, remote_url: null, branch: null, has_changes: false, changed_skill_count: 0, ahead: 0, behind: 0, last_commit: null, last_commit_time: null, current_snapshot_tag: null, restored_from_tag: null, upstream_health: "no_remote" };
    case "git_backup_list_versions": return [];
    case "backup_device_name": return "Demo workspace";
    case "git_backup_size_report": return { total_bytes: 0, oversized: [], skill_limit_bytes: 10485760, repo_warn_bytes: 104857600 };
    case "plugin:clipboard-manager|write_text": return navigator.clipboard.writeText(String(args.text));
  }
  throw new Error("在线演示仅使用示例数据；安装、文件操作、在线翻译和备份请下载桌面版。");
}, { shouldMockEvents: true });
