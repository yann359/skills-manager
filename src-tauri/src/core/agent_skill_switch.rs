//! Filesystem-backed, reversible per-agent switches. Preset membership is not
//! an enabled-state signal. No agent configuration or SKILL.md is edited here.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::{
    central_repo, content_hash,
    error::AppError,
    project_scanner, skill_metadata,
    skill_store::{SkillRecord, SkillStore, SkillTargetRecord},
    sync_engine,
    tool_adapters::{self, ToolAdapter},
};

static SWITCH_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
struct SwitchRecord {
    target_path: String,
    enabled: bool,
    mode: String,
    fingerprint: String,
    backup_path: Option<String>,
    original_backup: Option<String>,
}

#[derive(Serialize)]
pub struct AgentSkillState {
    #[serde(flatten)]
    pub skill: project_scanner::ProjectSkillInfo,
    pub managed: bool,
    pub blocked_reason: Option<String>,
    pub exposure_paths: Vec<String>,
    pub backup_path: Option<String>,
}

#[derive(Serialize)]
pub struct AdoptionPreview {
    pub path: String,
    pub fingerprint: String,
    pub blocked_reason: Option<String>,
}

fn key(skill_id: &str, agent: &str) -> String {
    format!("agent_skill_switch:{}:{}", agent, skill_id)
}

fn record(store: &SkillStore, id: &str, agent: &str) -> Result<Option<SwitchRecord>, AppError> {
    store
        .get_setting(&key(id, agent))
        .map_err(AppError::db)?
        .map(|s| serde_json::from_str(&s).map_err(AppError::db))
        .transpose()
}

fn save(store: &SkillStore, id: &str, agent: &str, value: &SwitchRecord) -> Result<(), AppError> {
    store
        .set_setting(
            &key(id, agent),
            &serde_json::to_string(value).map_err(AppError::db)?,
        )
        .map_err(AppError::db)
}

pub fn explicitly_disabled(store: &SkillStore, id: &str, agent: &str) -> Result<bool, AppError> {
    Ok(record(store, id, agent)?.is_some_and(|r| !r.enabled))
}

/// Refresh an existing switch baseline after the established sync engine has
/// deliberately deployed a new revision (pull/update/preset apply). Otherwise
/// a legitimate update would be mistaken for an external edit on the next off.
pub fn note_engine_deployment(
    store: &SkillStore,
    target: &SkillTargetRecord,
    source: &Path,
) -> Result<(), AppError> {
    let Some(mut r) = record(store, &target.skill_id, &target.tool)? else {
        return Ok(());
    };
    r.fingerprint = artifact_fingerprint(Path::new(&target.target_path), source, &target.mode)?;
    r.target_path = target.target_path.clone();
    r.mode = target.mode.clone();
    r.enabled = true;
    r.backup_path = None;
    save(store, &target.skill_id, &target.tool, &r)
}

fn adapter(store: &SkillStore, agent: &str) -> Result<ToolAdapter, AppError> {
    tool_adapters::find_adapter_with_store(store, agent)
        .ok_or_else(|| AppError::not_found(format!("未知 Agent：{agent}")))
}

/// Resolve ancestors, but never follow the final deployment link. On Windows
/// aliases differing only in case identify the same filesystem object.
fn physical_key(path: &Path) -> String {
    let p = if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        resolved_directory(parent)
            .unwrap_or_else(|| parent.to_path_buf())
            .join(name)
    } else {
        path.to_path_buf()
    };
    let value = p.to_string_lossy().to_string();
    #[cfg(windows)]
    let value = value.to_lowercase();
    value
}

fn resolved_directory(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Some(resolved_directory(path.parent()?)?.join(path.file_name()?))
        }
        _ => None,
    }
}

fn within(path: &Path, root: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    match (resolved_directory(parent), resolved_directory(root)) {
        (Some(p), Some(r)) => p.starts_with(r),
        _ => false,
    }
}

fn shared_reason(store: &SkillStore, a: &ToolAdapter, target: &Path) -> Option<String> {
    for other in tool_adapters::all_tool_adapters(store) {
        if other.key == a.key {
            continue;
        }
        // Even an agent disabled in this app can still load its directory.
        for root in other.all_scan_dirs() {
            if within(target, &root) {
                return Some(format!(
                    "此目录也被 {} 搜索，无法独立开关；请先为 Agent 配置独立目录。",
                    other.display_name
                ));
            }
        }
    }
    None
}

fn scan(a: &ToolAdapter) -> Vec<project_scanner::ProjectSkillInfo> {
    let mut result = Vec::new();
    for root in a.all_scan_dirs() {
        for skill in project_scanner::read_linked_workspace_skills(
            &root,
            None,
            &a.key,
            &a.display_name,
            a.recursive_scan,
        ) {
            if !result.iter().any(|s: &project_scanner::ProjectSkillInfo| {
                physical_key(Path::new(&s.path)) == physical_key(Path::new(&skill.path))
            }) {
                result.push(skill);
            }
        }
        // Plugin caches and Codex's bundled .system root are read-only
        // discovery sources. Workspace scanning intentionally omits these.
        let readonly_roots = if physical_key(&root) == physical_key(&a.skills_dir()) {
            vec![root.join(".system")]
        } else {
            vec![root.clone()]
        };
        for readonly in readonly_roots {
            for path in super::scanner::collect_skill_dirs(&readonly) {
                if result
                    .iter()
                    .any(|s| physical_key(Path::new(&s.path)) == physical_key(&path))
                {
                    continue;
                }
                let meta = skill_metadata::parse_skill_md(&path);
                let dir = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                result.push(project_scanner::ProjectSkillInfo {
                    name: meta.name.unwrap_or_else(|| dir.clone()),
                    dir_name: dir,
                    relative_path: path
                        .strip_prefix(&root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .into(),
                    description: meta.description,
                    path: path.to_string_lossy().into(),
                    files: Vec::new(),
                    enabled: true,
                    agent: a.key.clone(),
                    agent_display_name: a.display_name.clone(),
                    tags: Vec::new(),
                    in_center: false,
                    sync_status: "project_only".into(),
                    center_skill_id: None,
                    last_modified_at: None,
                    content_hash: None,
                });
            }
        }
    }
    result
}

fn known_skills(
    store: &SkillStore,
    a: &ToolAdapter,
) -> Result<Vec<project_scanner::ProjectSkillInfo>, AppError> {
    let mut skills = scan(a);
    // Installed plugin caches are only POTENTIAL exposures: inactive plugins
    // must not be labelled enabled in the Agent page. They conservatively
    // block a claim of complete disabling, without changing plugin settings.
    if let Some(home) = dirs::home_dir() {
        let plugin_root = match a.key.as_str() {
            "codex" => Some(home.join(".codex/plugins/cache")),
            "claude_code" => Some(home.join(".claude/plugins/cache")),
            _ => None,
        };
        if let Some(root) = plugin_root {
            for path in super::scanner::collect_skill_dirs(&root) {
                let meta = skill_metadata::parse_skill_md(&path);
                let dir = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                skills.push(project_scanner::ProjectSkillInfo {
                    name: meta.name.unwrap_or_else(|| dir.clone()),
                    dir_name: dir,
                    relative_path: String::new(),
                    description: meta.description,
                    path: path.to_string_lossy().into(),
                    files: Vec::new(),
                    enabled: true,
                    agent: a.key.clone(),
                    agent_display_name: a.display_name.clone(),
                    tags: Vec::new(),
                    in_center: false,
                    sync_status: "project_only".into(),
                    center_skill_id: None,
                    last_modified_at: None,
                    content_hash: None,
                });
            }
        }
    }
    // Registered projects are also effective scopes. Arbitrary CLI --skill,
    // unregistered projects and plugin settings are explicitly outside scope.
    for project in store.get_all_projects().map_err(AppError::db)? {
        let root = PathBuf::from(&project.path);
        let mut roots = vec![root.join(a.project_relative_skills_dir())];
        if a.key == "codex" || a.key == "pi" {
            roots.push(root.join(".agents/skills"));
        }
        for root in roots {
            skills.extend(project_scanner::read_linked_workspace_skills(
                &root,
                None,
                &a.key,
                &a.display_name,
                a.recursive_scan,
            ));
        }
    }
    Ok(skills)
}

fn exposures(
    skills: &[project_scanner::ProjectSkillInfo],
    name: &str,
    dir: &str,
    target: &Path,
) -> Vec<String> {
    let mut paths: Vec<_> = skills
        .iter()
        .filter(|s| {
            (s.name == name || s.dir_name == dir)
                && physical_key(Path::new(&s.path)) != physical_key(target)
        })
        .map(|s| s.path.clone())
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

/// Full fidelity fingerprint: includes ignored files, empty directories and
/// permissions. Reject nested links/reparse points instead of copying through
/// them. This is intentionally stricter than the sync engine's content hash.
fn tree_fingerprint(path: &Path) -> Result<String, AppError> {
    let mut entries = WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::io)?;
    entries.sort_by_key(|e| e.path().to_path_buf());
    let mut hash = Sha256::new();
    for entry in entries {
        let meta = fs::symlink_metadata(entry.path())?;
        if meta.file_type().is_symlink() {
            return Err(AppError::invalid_input(
                "目录包含链接，无法保证完整备份，暂不支持接管。",
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(AppError::invalid_input("目录包含重解析点，无法安全接管。"));
            }
        }
        let relative = entry
            .path()
            .strip_prefix(path)
            .map_err(AppError::io)?
            .to_string_lossy()
            .replace('\\', "/");
        hash.update((relative.len() as u64).to_le_bytes());
        hash.update(relative.as_bytes());
        hash.update([meta.is_dir() as u8, meta.permissions().readonly() as u8]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            hash.update(meta.permissions().mode().to_le_bytes());
        }
        if meta.is_file() {
            let bytes = fs::read(entry.path())?;
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
        } else if !meta.is_dir() {
            return Err(AppError::invalid_input("目录包含特殊文件，无法安全备份。"));
        }
    }
    Ok(hex::encode(hash.finalize()))
}

fn artifact_fingerprint(path: &Path, source: &Path, mode: &str) -> Result<String, AppError> {
    let meta = fs::symlink_metadata(path)?;
    if mode == "symlink" {
        if !meta.file_type().is_symlink() || path.canonicalize()? != source.canonicalize()? {
            return Err(AppError::invalid_input(
                "部署链接已被外部替换，已保留原文件，请重新扫描。",
            ));
        }
        return Ok(format!("link:{}", fs::read_link(path)?.to_string_lossy()));
    }
    if mode != "copy" || meta.file_type().is_symlink() {
        return Err(AppError::invalid_input("部署类型已改变，已保留原文件。"));
    }
    tree_fingerprint(path)
}

fn copy_exact(source: &Path, dest: &Path) -> Result<String, AppError> {
    let before = tree_fingerprint(source)?;
    if fs::symlink_metadata(dest).is_ok() {
        return Err(AppError::invalid_input("备份路径已存在，拒绝覆盖。"));
    }
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(AppError::io)?;
        let target = dest.join(entry.path().strip_prefix(source).map_err(AppError::io)?);
        // Recheck each entry immediately before copying, including junctions.
        let meta = fs::symlink_metadata(entry.path())?;
        if meta.file_type().is_symlink() {
            return Err(AppError::invalid_input(
                "备份时检测到链接变化，原文件未改动。",
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(AppError::invalid_input("备份时检测到重解析点。"));
            }
        }
        if meta.is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    // Apply permissions after children are copied so readonly dirs work too.
    let mut entries = WalkDir::new(source)
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::io)?;
    entries.sort_by_key(|e| std::cmp::Reverse(e.depth()));
    for entry in entries {
        fs::set_permissions(
            dest.join(entry.path().strip_prefix(source).map_err(AppError::io)?),
            fs::metadata(entry.path())?.permissions(),
        )?;
    }
    if tree_fingerprint(source)? != before || tree_fingerprint(dest)? != before {
        return Err(AppError::invalid_input(
            "备份校验失败或来源正在变化，原文件未改动。",
        ));
    }
    Ok(before)
}

fn vault(store: &SkillStore) -> Result<PathBuf, AppError> {
    let root = central_repo::base_dir().join("agent-switch-backups");
    fs::create_dir_all(&root)?;
    for a in tool_adapters::all_tool_adapters(store) {
        for search in a.all_scan_dirs() {
            if root
                .canonicalize()?
                .starts_with(search.canonicalize().unwrap_or(search))
            {
                return Err(AppError::invalid_input(
                    "恢复区位于 Agent 搜索目录内，拒绝操作；请调整中心库路径。",
                ));
            }
        }
    }
    Ok(root)
}

fn adoption_reason(store: &SkillStore, a: &ToolAdapter, path: &Path) -> Option<String> {
    match overlaps_library_source(store, path) {
        Ok(true) => {
            return Some("此路径属于中心库原始内容，请为 Agent 配置独立目录后部署。".into())
        }
        Err(error) => return Some(error.to_string()),
        Ok(false) => {}
    }
    if !within(path, &a.skills_dir()) {
        return Some("此技能来自附加搜索路径或外部插件，请在所属工具中管理。".into());
    }
    if path.components().any(|c| {
        matches!(
            c.as_os_str().to_string_lossy().as_ref(),
            ".system" | "plugins" | "synced"
        )
    }) {
        return Some("此路径由系统或外部插件管理，不能接管。".into());
    }
    shared_reason(store, a, path).or_else(|| tree_fingerprint(path).err().map(|e| e.to_string()))
}

fn overlaps_library_source(store: &SkillStore, path: &Path) -> Result<bool, AppError> {
    let target = PathBuf::from(physical_key(path));
    let mut roots = vec![central_repo::skills_dir()];
    roots.extend(
        store
            .get_all_skills()
            .map_err(AppError::db)?
            .into_iter()
            .map(|s| PathBuf::from(s.central_path)),
    );
    Ok(roots.into_iter().any(|root| {
        let resolved = root.canonicalize().unwrap_or(root);
        let source = PathBuf::from(physical_key(&resolved));
        target.starts_with(&source) || source.starts_with(&target)
    }))
}

pub fn preview(
    store: &SkillStore,
    agent: &str,
    relative: &str,
) -> Result<AdoptionPreview, AppError> {
    let a = adapter(store, agent)?;
    crate::commands::projects::ensure_safe_skill_relative_path(relative)?;
    let path = a.skills_dir().join(relative);
    if !skill_metadata::is_valid_skill_dir(&path) {
        return Err(AppError::not_found("找不到有效的 SKILL.md。"));
    }
    let blocked = adoption_reason(store, &a, &path);
    Ok(AdoptionPreview {
        path: path.to_string_lossy().into(),
        fingerprint: tree_fingerprint(&path).unwrap_or_default(),
        blocked_reason: blocked,
    })
}

pub fn adopt(
    store: &SkillStore,
    agent: &str,
    relative: &str,
    expected: &str,
) -> Result<(), AppError> {
    let _guard = SWITCH_LOCK.lock().map_err(AppError::db)?;
    let a = adapter(store, agent)?;
    let p = preview(store, agent, relative)?;
    if let Some(reason) = p.blocked_reason {
        return Err(AppError::invalid_input(reason));
    }
    if expected.is_empty() || p.fingerprint != expected {
        return Err(AppError::invalid_input(
            "来源在确认后已改变，请重新确认接管。",
        ));
    }
    let source = PathBuf::from(&p.path);
    if store
        .get_all_targets()
        .map_err(AppError::db)?
        .iter()
        .any(|t| physical_key(Path::new(&t.target_path)) == physical_key(&source))
    {
        return Err(AppError::invalid_input(
            "此目录已受管理，请刷新后使用开关。",
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let backup = vault(store)?.join(&id).join("original");
    fs::create_dir_all(backup.parent().unwrap())?;
    let fingerprint = copy_exact(&source, &backup)?;
    let central = central_repo::skills_dir()
        .join(format!("adopted-{id}"))
        .join(source.file_name().unwrap());
    fs::create_dir_all(central.parent().unwrap())?;
    copy_exact(&source, &central)?;
    if fingerprint != expected || tree_fingerprint(&source)? != fingerprint {
        return Err(AppError::invalid_input("来源已改变，原文件未改动。"));
    }
    let meta = skill_metadata::parse_skill_md(&source);
    let now = chrono::Utc::now().timestamp_millis();
    let hash = content_hash::hash_directory(&central).map_err(AppError::io)?;
    let skill = SkillRecord {
        id: id.clone(),
        name: meta
            .name
            .unwrap_or_else(|| source.file_name().unwrap().to_string_lossy().into()),
        description: meta.description,
        source_type: "import".into(),
        source_ref: Some(backup.to_string_lossy().into()),
        source_ref_resolved: None,
        source_subpath: None,
        source_branch: None,
        source_revision: None,
        remote_revision: None,
        central_path: central.to_string_lossy().into(),
        content_hash: Some(hash),
        enabled: true,
        created_at: now,
        updated_at: now,
        status: "ok".into(),
        update_status: "local_only".into(),
        last_checked_at: None,
        last_check_error: None,
    };
    let r = SwitchRecord {
        target_path: p.path,
        enabled: true,
        mode: "copy".into(),
        fingerprint,
        backup_path: None,
        original_backup: Some(backup.to_string_lossy().into()),
    };
    fs::write(
        backup.parent().unwrap().join("manifest.json"),
        serde_json::to_vec_pretty(&r).map_err(AppError::db)?,
    )?;
    // Registration only. The original remains byte-for-byte where it was.
    store.insert_skill(&skill).map_err(AppError::db)?;
    if let Err(e) = save(store, &id, agent, &r).and_then(|_| {
        store
            .insert_target(&target_record(&id, agent, &r, skill.content_hash.clone()))
            .map_err(AppError::db)
    }) {
        let _ = store.delete_skill(&id);
        return Err(e);
    }
    let _ = a;
    Ok(())
}

fn target_record(
    id: &str,
    agent: &str,
    r: &SwitchRecord,
    hash: Option<String>,
) -> SkillTargetRecord {
    SkillTargetRecord {
        id: uuid::Uuid::new_v4().to_string(),
        skill_id: id.into(),
        tool: agent.into(),
        target_path: r.target_path.clone(),
        mode: r.mode.clone(),
        status: "ok".into(),
        synced_at: Some(chrono::Utc::now().timestamp_millis()),
        last_error: None,
        source_hash: hash,
    }
}

pub fn set_enabled(
    store: &SkillStore,
    id: &str,
    agent: &str,
    enabled: bool,
) -> Result<(), AppError> {
    let _guard = SWITCH_LOCK.lock().map_err(AppError::db)?;
    let a = adapter(store, agent)?;
    if enabled
        && (!a.is_installed()
            || super::tool_service::get_disabled_tools(store).contains(&agent.to_string()))
    {
        return Err(AppError::invalid_input(
            "此 Agent 未安装或已在设置中停用，请先启用 Agent。",
        ));
    }
    let skill = store
        .get_skill_by_id(id)
        .map_err(AppError::db)?
        .ok_or_else(|| AppError::not_found("技能不在中心库中，请先接管。"))?;
    let source = PathBuf::from(&skill.central_path);
    let targets = store.get_targets_for_skill(id).map_err(AppError::db)?;
    let target_row = targets.iter().find(|t| t.tool == agent);
    let old = record(store, id, agent)?;
    let path = target_row
        .map(|t| PathBuf::from(&t.target_path))
        .or_else(|| old.as_ref().map(|r| PathBuf::from(&r.target_path)))
        .unwrap_or_else(|| {
            a.skills_dir()
                .join(sync_engine::target_dir_name(&source, &skill.name))
        });
    // Resolve ancestors without following the final deployment link. Staging
    // protects partial writes, but the FINAL path must also stay disjoint from
    // the source, even when a custom Agent accidentally points into the library.
    let source_location = source.canonicalize().unwrap_or_else(|_| source.clone());
    let source_key = PathBuf::from(physical_key(&source_location));
    let target_key = PathBuf::from(physical_key(&path));
    if target_key.starts_with(&source_key) || source_key.starts_with(&target_key) {
        return Err(AppError::invalid_input(
            "Agent 部署路径与中心库原始技能重叠，拒绝操作以保护原始文件；请配置独立目录。",
        ));
    }
    if overlaps_library_source(store, &path)? {
        return Err(AppError::invalid_input(
            "Agent 部署路径与中心库原始内容重叠，拒绝移动原始文件；请配置独立目录。",
        ));
    }
    if !within(&path, &a.skills_dir()) {
        return Err(AppError::invalid_input(
            "部署路径已改变或位于外部搜索目录，请先检查 Agent 路径。",
        ));
    }
    if store
        .get_all_targets()
        .map_err(AppError::db)?
        .iter()
        .any(|other| {
            physical_key(Path::new(&other.target_path)) == physical_key(&path)
                && (other.tool != agent || other.skill_id != id)
        })
    {
        return Err(AppError::invalid_input(
            "此物理路径还有其他部署记录，无法独立开关；所有文件和记录均已保留。",
        ));
    }
    if let Some(reason) = shared_reason(store, &a, &path) {
        return Err(AppError::invalid_input(reason));
    }
    let dir_name = path.file_name().unwrap().to_string_lossy();
    let exposure = exposures(&known_skills(store, &a)?, &skill.name, &dir_name, &path);
    if !enabled && !exposure.is_empty() {
        return Err(AppError::invalid_input(format!(
            "同名技能仍从其他路径暴露，无法完全禁用：{}",
            exposure.join("；")
        )));
    }
    if enabled {
        if fs::symlink_metadata(&path).is_ok() {
            let row = target_row
                .ok_or_else(|| AppError::invalid_input("目标已存在未受管理的文件，拒绝覆盖。"))?;
            let fp = artifact_fingerprint(&path, &source, &row.mode)?;
            if let Some(r) = old.as_ref() {
                if r.fingerprint != fp {
                    return Err(AppError::invalid_input("部署已被外部修改，拒绝覆盖。"));
                }
            }
            if !skill_metadata::is_valid_skill_dir(&path) {
                return Err(AppError::invalid_input("部署中缺少 SKILL.md。"));
            }
            let r = SwitchRecord {
                target_path: path.to_string_lossy().into(),
                enabled: true,
                mode: row.mode.clone(),
                fingerprint: fp,
                backup_path: None,
                original_backup: old.and_then(|r| r.original_backup),
            };
            return save(store, id, agent, &r);
        }
        if let Some(r) = old
            .as_ref()
            .filter(|r| !r.enabled && r.backup_path.is_some())
        {
            let backup = PathBuf::from(r.backup_path.as_ref().unwrap());
            // Restoring the original name is essential for nested local skills.
            fs::create_dir_all(path.parent().unwrap())?;
            if r.mode == "copy" && tree_fingerprint(&backup)? != r.fingerprint {
                return Err(AppError::invalid_input(
                    "恢复文件已改变，校验失败，拒绝覆盖。",
                ));
            }
            fs::rename(&backup, &path)?;
            let mut next = r.clone();
            next.enabled = true;
            next.backup_path = None;
            let result = (|| {
                if artifact_fingerprint(&path, &source, &r.mode)? != r.fingerprint
                    || !skill_metadata::is_valid_skill_dir(&path)
                {
                    return Err(AppError::invalid_input("恢复校验失败。"));
                }
                store
                    .insert_target(&target_record(id, agent, &next, skill.content_hash.clone()))
                    .map_err(AppError::db)?;
                save(store, id, agent, &next)
            })();
            if result.is_err() {
                let _ = fs::rename(&path, &backup);
                let _ = store.delete_target(id, agent);
            }
            return result;
        }
        if !skill_metadata::is_valid_skill_dir(&source) {
            return Err(AppError::invalid_input("中心库原始技能缺失，拒绝部署。"));
        }
        // Reuse the engine, but publish only a complete, verified deployment.
        // A failed recursive copy must never expose a partial SKILL.md tree.
        let staging = vault(store)?.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&staging)?;
        let artifact = staging.join("deployment");
        let configured = store.get_setting("sync_mode").map_err(AppError::db)?;
        let mode = sync_engine::sync_mode_for_tool(agent, configured.as_deref());
        let actual_mode = sync_engine::sync_skill(
            &source,
            &artifact,
            mode,
            sync_engine::ReplacePolicy::NoClobber,
        )
        .map_err(AppError::io)?;
        if !skill_metadata::is_valid_skill_dir(&artifact) {
            return Err(AppError::invalid_input("部署校验失败：没有有效 SKILL.md。"));
        }
        if content_hash::hash_directory(&source).map_err(AppError::io)?
            != content_hash::hash_directory(&artifact).map_err(AppError::io)?
        {
            return Err(AppError::invalid_input(
                "部署校验失败：来源正在变化，尚未启用。",
            ));
        }
        let fp = artifact_fingerprint(&artifact, &source, actual_mode.as_str())?;
        let r = SwitchRecord {
            target_path: path.to_string_lossy().into(),
            enabled: true,
            mode: actual_mode.as_str().into(),
            fingerprint: fp,
            backup_path: None,
            original_backup: old.and_then(|r| r.original_backup),
        };
        fs::write(
            staging.join("manifest.json"),
            serde_json::to_vec_pretty(&r).map_err(AppError::db)?,
        )?;
        fs::create_dir_all(path.parent().unwrap())?;
        if fs::symlink_metadata(&path).is_ok() {
            return Err(AppError::invalid_input(
                "目标在部署期间被其他程序创建，拒绝覆盖。",
            ));
        }
        fs::rename(&artifact, &path).map_err(|e| {
            AppError::io(format!(
                "部署未启用；请检查文件锁、权限及恢复区与 Agent 是否位于同一磁盘：{e}"
            ))
        })?;
        let outcome = (|| {
            if artifact_fingerprint(&path, &source, &r.mode)? != r.fingerprint {
                return Err(AppError::invalid_input("部署发布校验失败。"));
            }
            let source_hash = Some(content_hash::hash_directory(&source).map_err(AppError::io)?);
            store
                .insert_target(&target_record(id, agent, &r, source_hash))
                .map_err(AppError::db)?;
            save(store, id, agent, &r)
        })();
        if outcome.is_err() {
            // Retain the staged deployment for recovery, outside search paths.
            if fs::rename(&path, &artifact).is_ok() {
                let _ = store.delete_target(id, agent);
            }
        }
        return outcome;
    }
    let row = match target_row {
        Some(row) => row,
        None if fs::symlink_metadata(&path).is_ok() => {
            return Err(AppError::invalid_input("磁盘存在未受管理文件，请先接管。"))
        }
        None => {
            if old.as_ref().is_some_and(|r| !r.enabled) {
                return Ok(());
            }
            let configured = store.get_setting("sync_mode").map_err(AppError::db)?;
            return save(
                store,
                id,
                agent,
                &SwitchRecord {
                    target_path: path.to_string_lossy().into(),
                    enabled: false,
                    mode: sync_engine::sync_mode_for_tool(agent, configured.as_deref())
                        .as_str()
                        .into(),
                    fingerprint: String::new(),
                    backup_path: None,
                    original_backup: old.and_then(|r| r.original_backup),
                },
            );
        }
    };
    let fp = if fs::symlink_metadata(&path).is_ok() {
        artifact_fingerprint(&path, &source, &row.mode)?
    } else {
        String::new()
    };
    if !fp.is_empty() {
        if let Some(r) = old.as_ref() {
            if r.fingerprint != fp {
                return Err(AppError::invalid_input(
                    "技能已被外部修改，已保留全部文件；请先处理差异再禁用。",
                ));
            }
        } else if row.mode == "copy" {
            // For legacy rows, require their recorded content hash as evidence.
            let current = content_hash::hash_directory(&path).map_err(AppError::io)?;
            if row.source_hash.as_deref() != Some(&current) {
                return Err(AppError::invalid_input(
                    "无法确认此部署仍是原始版本，拒绝撤销。",
                ));
            }
        }
    }
    let backup = vault(store)?.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&backup)?;
    let artifact = backup.join("deployment");
    let r = SwitchRecord {
        target_path: path.to_string_lossy().into(),
        enabled: false,
        mode: row.mode.clone(),
        fingerprint: fp.clone(),
        backup_path: if fp.is_empty() {
            None
        } else {
            Some(artifact.to_string_lossy().into())
        },
        original_backup: old.as_ref().and_then(|r| r.original_backup.clone()),
    };
    fs::write(
        backup.join("manifest.json"),
        serde_json::to_vec_pretty(&r).map_err(AppError::db)?,
    )?;
    // Write-ahead desired state survives a crash between rename and DB update.
    save(store, id, agent, &r)?;
    let outcome = (|| {
        if !fp.is_empty() {
            if artifact_fingerprint(&path, &source, &row.mode)? != fp {
                return Err(AppError::invalid_input(
                    "操作中检测到外部修改，原文件已保留。",
                ));
            }
            fs::rename(&path, &artifact).map_err(|e| AppError::io(format!("无法移入恢复区，原目录未改动。请检查文件锁、权限，以及恢复区是否与 Agent 位于同一磁盘：{e}")))?;
            let preserved = if row.mode == "copy" {
                tree_fingerprint(&artifact)?
            } else {
                format!("link:{}", fs::read_link(&artifact)?.to_string_lossy())
            };
            if preserved != fp {
                return Err(AppError::invalid_input(
                    "恢复区校验发现外部修改，已尝试恢复原路径，请重新扫描。",
                ));
            }
        }
        if fs::symlink_metadata(&path).is_ok() {
            return Err(AppError::invalid_input("禁用校验失败：目标仍存在。"));
        }
        store.delete_target(id, agent).map_err(AppError::db)
    })();
    if outcome.is_err() {
        if fs::symlink_metadata(&artifact).is_ok() && fs::symlink_metadata(&path).is_err() {
            let _ = fs::rename(&artifact, &path);
        }
        let previous = old.unwrap_or(SwitchRecord { enabled: true, ..r });
        let _ = save(store, id, agent, &previous);
    }
    outcome
}

pub fn list(store: &SkillStore, agent: &str) -> Result<Vec<AgentSkillState>, AppError> {
    let a = adapter(store, agent)?;
    for root in a.all_scan_dirs() {
        if root.is_dir() {
            fs::read_dir(&root).map_err(|e| {
                AppError::io(format!("无法读取技能搜索目录 {}：{e}", root.display()))
            })?;
        }
    }
    let local = scan(&a);
    let known = known_skills(store, &a)?;
    let managed = store.get_all_skills().map_err(AppError::db)?;
    let targets = store.get_all_targets().map_err(AppError::db)?;
    let tags = store.get_tags_map().map_err(AppError::db)?;
    let mut result = Vec::new();
    for mut skill in local {
        let target = targets.iter().find(|t| {
            t.tool == agent
                && physical_key(Path::new(&t.target_path)) == physical_key(Path::new(&skill.path))
        });
        let owner = target.and_then(|t| managed.iter().find(|m| m.id == t.skill_id));
        skill.in_center = owner.is_some();
        skill.center_skill_id = owner.map(|m| m.id.clone());
        skill.tags = owner
            .and_then(|m| tags.get(&m.id).cloned())
            .unwrap_or_default();
        skill.sync_status = crate::commands::projects::classify_sync_status(&skill, owner);
        let blocked = if let (Some(m), Some(t)) = (owner, target) {
            artifact_fingerprint(Path::new(&skill.path), Path::new(&m.central_path), &t.mode)
                .err()
                .map(|e| e.to_string())
                .or_else(|| {
                    record(store, &m.id, agent).ok().flatten().and_then(|r| {
                        artifact_fingerprint(
                            Path::new(&skill.path),
                            Path::new(&m.central_path),
                            &t.mode,
                        )
                        .ok()
                        .filter(|fp| *fp != r.fingerprint)
                        .map(|_| "部署已被外部修改，请先处理差异。".into())
                    })
                })
                .or_else(|| shared_reason(store, &a, Path::new(&skill.path)))
        } else {
            adoption_reason(store, &a, Path::new(&skill.path))
        };
        let exposure = exposures(&known, &skill.name, &skill.dir_name, Path::new(&skill.path));
        let blocked = blocked.or_else(|| {
            (!exposure.is_empty()).then(|| "同名技能仍在其他路径暴露，无法完全禁用。".into())
        });
        let backup = owner
            .map(|m| record(store, &m.id, agent))
            .transpose()?
            .flatten()
            .and_then(|r| r.original_backup);
        result.push(AgentSkillState {
            managed: owner.is_some(),
            blocked_reason: blocked,
            exposure_paths: exposure,
            backup_path: backup,
            skill,
        });
    }
    for m in managed {
        if result
            .iter()
            .any(|s| s.skill.center_skill_id.as_deref() == Some(&m.id))
        {
            continue;
        }
        let r = record(store, &m.id, agent)?;
        let target = targets
            .iter()
            .find(|t| t.tool == agent && t.skill_id == m.id);
        let source = PathBuf::from(&m.central_path);
        let path = target
            .map(|t| PathBuf::from(&t.target_path))
            .or_else(|| r.as_ref().map(|r| PathBuf::from(&r.target_path)))
            .unwrap_or_else(|| {
                a.skills_dir()
                    .join(sync_engine::target_dir_name(&source, &m.name))
            });
        let dir = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let relative = path
            .strip_prefix(a.skills_dir())
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        let exposure = exposures(&known, &m.name, &dir, &path);
        let exists = fs::symlink_metadata(&path).is_ok();
        let reason = if exists {
            Some("目标存在其他文件或无效部署，请检查路径冲突。".into())
        } else if !exposure.is_empty() {
            Some("受管理部署已撤销，但其他路径仍暴露同名技能。".into())
        } else {
            shared_reason(store, &a, &path)
        };
        result.push(AgentSkillState {
            managed: true,
            blocked_reason: reason,
            exposure_paths: exposure,
            backup_path: r.and_then(|r| r.backup_path.or(r.original_backup)),
            skill: project_scanner::ProjectSkillInfo {
                name: m.name,
                dir_name: dir,
                relative_path: relative,
                description: m.description,
                path: path.to_string_lossy().into(),
                files: Vec::new(),
                enabled: skill_metadata::is_valid_skill_dir(&path),
                agent: a.key.clone(),
                agent_display_name: a.display_name.clone(),
                tags: tags.get(&m.id).cloned().unwrap_or_default(),
                in_center: true,
                sync_status: "in_sync".into(),
                center_skill_id: Some(m.id),
                last_modified_at: None,
                content_hash: m.content_hash,
            },
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::super::scenario_service;
    use super::*;
    use std::sync::MutexGuard;
    use tempfile::{tempdir, TempDir};
    use tool_adapters::CustomToolDef;

    struct Fixture {
        store: SkillStore,
        tmp: TempDir,
        _guard: MutexGuard<'static, ()>,
    }
    impl Fixture {
        fn new() -> Self {
            let guard = central_repo::test_base_dir_lock();
            let tmp = tempdir().unwrap();
            central_repo::set_test_base_dir_override(Some(tmp.path().join("library")));
            let store = SkillStore::new(&tmp.path().join("state.db")).unwrap();
            let tools: Vec<_> = ["test_a", "test_b"]
                .into_iter()
                .map(|key| {
                    let dir = tmp.path().join(key);
                    fs::create_dir_all(&dir).unwrap();
                    CustomToolDef {
                        key: key.into(),
                        display_name: key.into(),
                        skills_dir: dir.to_string_lossy().into(),
                        project_relative_skills_dir: Some(format!(".{key}/skills")),
                        category: Default::default(),
                    }
                })
                .collect();
            store
                .set_setting("custom_tools", &serde_json::to_string(&tools).unwrap())
                .unwrap();
            store.set_setting("sync_mode", "copy").unwrap();
            Self {
                store,
                tmp,
                _guard: guard,
            }
        }
        fn local(&self, agent: &str) -> PathBuf {
            let path = self.tmp.path().join(agent).join("sm-switch-fixture");
            fs::create_dir_all(path.join("empty")).unwrap();
            fs::create_dir_all(path.join(".git")).unwrap();
            fs::write(
                path.join("SKILL.md"),
                "---\nname: sm-switch-fixture\ndescription: test skill\n---\n原始内容\n",
            )
            .unwrap();
            fs::write(path.join(".gitignore"), "ignored-but-preserved").unwrap();
            fs::write(path.join(".git/marker"), "also-preserved").unwrap();
            path
        }
        fn adopt(&self, agent: &str) -> String {
            let preview = preview(&self.store, agent, "sm-switch-fixture").unwrap();
            adopt(
                &self.store,
                agent,
                "sm-switch-fixture",
                &preview.fingerprint,
            )
            .unwrap();
            self.store
                .get_all_targets()
                .unwrap()
                .iter()
                .find(|t| t.tool == agent)
                .unwrap()
                .skill_id
                .clone()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            central_repo::set_test_base_dir_override(None);
        }
    }

    #[test]
    fn adoption_keeps_original_and_full_backup_then_repeated_switches_restore_exactly() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let before = tree_fingerprint(&path).unwrap();
        let id = f.adopt("test_a");
        assert_eq!(tree_fingerprint(&path).unwrap(), before);
        let original = record(&f.store, &id, "test_a")
            .unwrap()
            .unwrap()
            .original_backup
            .unwrap();
        assert_eq!(tree_fingerprint(Path::new(&original)).unwrap(), before);
        for _ in 0..3 {
            set_enabled(&f.store, &id, "test_a", false).unwrap();
            assert!(!path.exists());
            let state = list(&f.store, "test_a")
                .unwrap()
                .into_iter()
                .find(|s| s.skill.center_skill_id.as_deref() == Some(&id))
                .unwrap();
            assert!(!state.skill.enabled);
            assert!(state.managed);
            set_enabled(&f.store, &id, "test_a", true).unwrap();
            assert_eq!(tree_fingerprint(&path).unwrap(), before);
        }
        assert_eq!(tree_fingerprint(Path::new(&original)).unwrap(), before);
    }

    #[test]
    fn restart_keeps_disabled_state_and_original_restore_path() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        set_enabled(&f.store, &id, "test_a", false).unwrap();
        let reopened = SkillStore::new(&f.tmp.path().join("state.db")).unwrap();
        assert!(explicitly_disabled(&reopened, &id, "test_a").unwrap());
        assert!(
            !list(&reopened, "test_a")
                .unwrap()
                .into_iter()
                .find(|s| s.skill.center_skill_id.as_deref() == Some(&id))
                .unwrap()
                .skill
                .enabled
        );
        set_enabled(&reopened, &id, "test_a", true).unwrap();
        assert!(path.join("SKILL.md").exists());
    }

    #[test]
    fn same_name_independent_agents_do_not_affect_each_other() {
        let f = Fixture::new();
        let a = f.local("test_a");
        let b = f.local("test_b");
        fs::write(b.join("unique"), "agent b only").unwrap();
        let id_a = f.adopt("test_a");
        let id_b = f.adopt("test_b");
        let before_b = tree_fingerprint(&b).unwrap();
        set_enabled(&f.store, &id_a, "test_a", false).unwrap();
        assert!(!a.exists());
        assert_eq!(tree_fingerprint(&b).unwrap(), before_b);
        assert_eq!(f.store.get_targets_for_skill(&id_b).unwrap().len(), 1);
    }

    #[test]
    fn external_modification_refuses_disable_and_retains_state() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        fs::write(path.join("SKILL.md"), "externally edited").unwrap();
        assert!(set_enabled(&f.store, &id, "test_a", false).is_err());
        assert_eq!(
            fs::read_to_string(path.join("SKILL.md")).unwrap(),
            "externally edited"
        );
        assert_eq!(f.store.get_targets_for_skill(&id).unwrap().len(), 1);
        assert!(!explicitly_disabled(&f.store, &id, "test_a").unwrap());
    }

    #[test]
    fn restore_conflict_does_not_overwrite_external_files_or_lose_backup() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        set_enabled(&f.store, &id, "test_a", false).unwrap();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("SKILL.md"), "new owner").unwrap();
        let backup = record(&f.store, &id, "test_a")
            .unwrap()
            .unwrap()
            .backup_path
            .unwrap();
        assert!(set_enabled(&f.store, &id, "test_a", true).is_err());
        assert_eq!(
            fs::read_to_string(path.join("SKILL.md")).unwrap(),
            "new owner"
        );
        assert!(Path::new(&backup).join("SKILL.md").exists());
        assert!(explicitly_disabled(&f.store, &id, "test_a").unwrap());
    }

    #[test]
    fn adoption_confirmation_rejects_changed_source() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let p = preview(&f.store, "test_a", "sm-switch-fixture").unwrap();
        fs::write(path.join("new-file"), "changed since confirmation").unwrap();
        assert!(adopt(&f.store, "test_a", "sm-switch-fixture", &p.fingerprint).is_err());
        assert!(f.store.get_all_skills().unwrap().is_empty());
        assert!(path.exists());
    }

    #[test]
    fn shared_directory_is_blocked_even_without_other_target_records() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let mut tools = tool_adapters::custom_tools(&f.store);
        tools[1].skills_dir = tools[0].skills_dir.clone();
        f.store
            .set_setting("custom_tools", &serde_json::to_string(&tools).unwrap())
            .unwrap();
        assert!(preview(&f.store, "test_a", "sm-switch-fixture")
            .unwrap()
            .blocked_reason
            .is_some());
        assert!(path.exists());
    }

    #[test]
    fn custom_agent_path_inside_source_is_refused_without_modifying_library() {
        let f = Fixture::new();
        f.local("test_a");
        let id = f.adopt("test_a");
        let source = f.store.get_skill_by_id(&id).unwrap().unwrap();
        let before = tree_fingerprint(Path::new(&source.central_path)).unwrap();
        let mut tools = tool_adapters::custom_tools(&f.store);
        tools[1].skills_dir = Path::new(&source.central_path)
            .join("nested")
            .to_string_lossy()
            .into();
        f.store
            .set_setting("custom_tools", &serde_json::to_string(&tools).unwrap())
            .unwrap();
        assert!(set_enabled(&f.store, &id, "test_b", true).is_err());
        assert_eq!(
            tree_fingerprint(Path::new(&source.central_path)).unwrap(),
            before
        );
        assert!(!Path::new(&source.central_path).join("nested").exists());
    }

    #[test]
    fn duplicate_registered_project_exposure_blocks_disable() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        let root = f.tmp.path().join("project");
        let nested = root.join(".test_a/skills/sm-switch-fixture");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("SKILL.md"),
            fs::read(path.join("SKILL.md")).unwrap(),
        )
        .unwrap();
        f.store
            .insert_project(&super::super::skill_store::ProjectRecord {
                id: "project".into(),
                name: "project".into(),
                path: root.to_string_lossy().into(),
                workspace_type: "project".into(),
                linked_agent_key: None,
                linked_agent_name: None,
                disabled_path: None,
                sort_order: 0,
                created_at: 1,
                updated_at: 1,
            })
            .unwrap();
        assert!(set_enabled(&f.store, &id, "test_a", false).is_err());
        assert!(path.exists());
    }

    #[test]
    fn external_removal_and_reappearance_are_reported_from_disk() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        let displaced = f.tmp.path().join("external-move");
        fs::rename(&path, &displaced).unwrap();
        // A leftover directory without SKILL.md is not an enabled deployment.
        fs::create_dir_all(&path).unwrap();
        assert!(
            !list(&f.store, "test_a")
                .unwrap()
                .into_iter()
                .find(|s| s.skill.center_skill_id.as_deref() == Some(&id))
                .unwrap()
                .skill
                .enabled
        );
        fs::remove_dir(&path).unwrap();
        fs::rename(&displaced, &path).unwrap();
        assert!(
            list(&f.store, "test_a")
                .unwrap()
                .into_iter()
                .find(|s| s.skill.center_skill_id.as_deref() == Some(&id))
                .unwrap()
                .skill
                .enabled
        );
    }

    #[test]
    fn builtin_codex_claude_and_pi_use_identical_switch_mechanism_in_temporary_roots() {
        let f = Fixture::new();
        let overrides: std::collections::HashMap<_, _> = ["codex", "claude_code", "pi"]
            .into_iter()
            .map(|agent| {
                fs::create_dir_all(f.tmp.path().join(agent)).unwrap();
                (
                    agent.to_string(),
                    f.tmp.path().join(agent).to_string_lossy().to_string(),
                )
            })
            .collect();
        f.store
            .set_setting(
                "custom_tool_paths",
                &serde_json::to_string(&overrides).unwrap(),
            )
            .unwrap();
        for agent in ["codex", "claude_code", "pi"] {
            let path = f.local(agent);
            let before = tree_fingerprint(&path).unwrap();
            let id = f.adopt(agent);
            set_enabled(&f.store, &id, agent, false).unwrap();
            assert!(!path.exists());
            set_enabled(&f.store, &id, agent, true).unwrap();
            assert_eq!(tree_fingerprint(&path).unwrap(), before);
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_junction_local_skill_cannot_be_silently_adopted() {
        let f = Fixture::new();
        let path = f.local("test_b");
        let link = f.tmp.path().join("test_a/sm-switch-fixture");
        junction::create(&path, &link).unwrap();
        assert!(preview(&f.store, "test_a", "sm-switch-fixture")
            .unwrap()
            .blocked_reason
            .is_some());
        assert!(path.exists());
        junction::delete(&link).unwrap();
    }

    #[test]
    fn startup_sync_does_not_reenable_explicitly_disabled_skill() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        let source = f.store.get_skill_by_id(&id).unwrap().unwrap();
        let desired = scenario_service::ScenarioSyncTarget {
            skill_id: id.clone(),
            skill_name: source.name,
            tool: "test_a".into(),
            source: PathBuf::from(source.central_path),
            target: path.clone(),
            mode: sync_engine::SyncMode::Copy,
            source_hash: source.content_hash,
        };
        set_enabled(&f.store, &id, "test_a", false).unwrap();
        assert!(scenario_service::sync_desired_targets(&f.store, &[desired])
            .unwrap()
            .is_empty());
        assert!(!path.exists());
        assert!(explicitly_disabled(&f.store, &id, "test_a").unwrap());
    }

    #[test]
    fn deliberate_engine_update_refreshes_baseline_and_keeps_switch_usable() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        let source = f.store.get_skill_by_id(&id).unwrap().unwrap();
        fs::write(
            Path::new(&source.central_path).join("revision.txt"),
            "intentional manager update",
        )
        .unwrap();
        scenario_service::sync_single_skill_to_tool(
            &f.store,
            &id,
            "test_a",
            scenario_service::DeployIntent::Managed,
        )
        .unwrap();
        set_enabled(&f.store, &id, "test_a", false).unwrap();
        assert!(!path.exists());
        set_enabled(&f.store, &id, "test_a", true).unwrap();
        assert_eq!(
            fs::read_to_string(path.join("revision.txt")).unwrap(),
            "intentional manager update"
        );
    }

    #[cfg(windows)]
    #[test]
    fn failed_fresh_copy_cannot_publish_partial_skill_or_lose_source() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new();
        f.local("test_a");
        let id = f.adopt("test_a");
        let source = f.store.get_skill_by_id(&id).unwrap().unwrap();
        let locked = Path::new(&source.central_path).join("locked.txt");
        fs::write(&locked, "original source remains").unwrap();
        let handle = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&locked)
            .unwrap();
        assert!(set_enabled(&f.store, &id, "test_b", true).is_err());
        assert!(!f.tmp.path().join("test_b/sm-switch-fixture").exists());
        assert!(f
            .store
            .get_targets_for_skill(&id)
            .unwrap()
            .iter()
            .all(|t| t.tool != "test_b"));
        drop(handle);
        assert_eq!(
            fs::read_to_string(locked).unwrap(),
            "original source remains"
        );
    }

    #[test]
    fn changed_recovery_backup_is_preserved_and_cannot_overwrite_target() {
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        set_enabled(&f.store, &id, "test_a", false).unwrap();
        let backup = record(&f.store, &id, "test_a")
            .unwrap()
            .unwrap()
            .backup_path
            .unwrap();
        fs::write(
            Path::new(&backup).join("SKILL.md"),
            "backup altered externally",
        )
        .unwrap();
        assert!(set_enabled(&f.store, &id, "test_a", true).is_err());
        assert!(!path.exists());
        assert_eq!(
            fs::read_to_string(Path::new(&backup).join("SKILL.md")).unwrap(),
            "backup altered externally"
        );
        assert!(explicitly_disabled(&f.store, &id, "test_a").unwrap());
    }

    #[test]
    fn engine_link_deployment_can_be_disabled_and_restored_without_changing_source() {
        let f = Fixture::new();
        f.local("test_a");
        let id = f.adopt("test_a");
        f.store.set_setting("sync_mode", "symlink").unwrap();
        set_enabled(&f.store, &id, "test_b", true).unwrap();
        let rows = f.store.get_targets_for_skill(&id).unwrap();
        let target = rows.iter().find(|t| t.tool == "test_b").unwrap();
        assert_eq!(target.mode, "symlink");
        let path = PathBuf::from(&target.target_path);
        let center = f.store.get_skill_by_id(&id).unwrap().unwrap().central_path;
        let before = tree_fingerprint(Path::new(&center)).unwrap();
        set_enabled(&f.store, &id, "test_b", false).unwrap();
        assert!(!path.exists());
        assert_eq!(tree_fingerprint(Path::new(&center)).unwrap(), before);
        set_enabled(&f.store, &id, "test_b", true).unwrap();
        assert!(fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(tree_fingerprint(Path::new(&center)).unwrap(), before);
    }

    #[cfg(windows)]
    #[test]
    fn windows_locked_file_disable_failure_retains_original_and_enabled_record() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new();
        let path = f.local("test_a");
        let id = f.adopt("test_a");
        let _handle = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(path.join("SKILL.md"))
            .unwrap();
        assert!(set_enabled(&f.store, &id, "test_a", false).is_err());
        assert!(path.join("SKILL.md").exists());
        assert!(!explicitly_disabled(&f.store, &id, "test_a").unwrap());
        assert_eq!(f.store.get_targets_for_skill(&id).unwrap().len(), 1);
    }
}
