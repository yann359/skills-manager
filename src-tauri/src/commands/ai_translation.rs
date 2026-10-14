use std::sync::Arc;
use tauri::{ipc::Channel, Manager, State};

use crate::core::{
    ai_translation::{
        self, FreeTierLimits, TranslationProgress, TranslationResult, TranslationStatus,
    },
    error::AppError,
    skill_store::SkillStore,
    translation_document::TranslationInput,
};

#[tauri::command]
pub async fn get_ai_translation_status() -> Result<TranslationStatus, AppError> {
    tauri::async_runtime::spawn_blocking(ai_translation::status).await?
}

#[tauri::command]
pub async fn set_ai_translation_consent(authorized: bool) -> Result<TranslationStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || ai_translation::set_consent(authorized)).await?
}

fn cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| AppError::io("无法定位应用本地缓存目录。"))?
        .join("ai-translation"))
}

#[tauri::command]
pub async fn get_cached_skill_translation(
    app: tauri::AppHandle,
    input: TranslationInput,
) -> Result<Option<TranslationResult>, AppError> {
    let dir = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        ai_translation::get_cached_translation(input, &dir)
    })
    .await?
}

#[tauri::command]
pub async fn reject_skill_translation_fragments(
    app: tauri::AppHandle,
    input: TranslationInput,
    rejected: Vec<crate::core::translation_document::TextSpan>,
) -> Result<(), AppError> {
    let dir = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        ai_translation::reject_fragments(input, &dir, rejected)
    })
    .await?
}

#[tauri::command]
pub async fn get_cached_skill_summary(
    app: tauri::AppHandle,
    skill_name: String,
    description: String,
) -> Result<Option<String>, AppError> {
    let dir = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(ai_translation::get_cached_summary(
            skill_name,
            description,
            &dir,
        ))
    })
    .await?
}

#[tauri::command]
pub async fn translate_skill_document(
    app: tauri::AppHandle,
    input: TranslationInput,
    free_confirmed: bool,
    force: bool,
    job_id: String,
    on_progress: Channel<TranslationProgress>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<TranslationResult, AppError> {
    let dir = cache_dir(&app)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ai_translation::translate_document(
            input,
            dir,
            free_confirmed,
            force,
            job_id,
            store.proxy_url(),
            |progress| {
                on_progress
                    .send(progress)
                    .map_err(|_| AppError::cancelled("阅读页面已关闭，翻译任务停止。"))
            },
        )
    })
    .await?
}

#[tauri::command]
pub fn cancel_skill_translation(job_id: String) {
    ai_translation::cancel_translation(&job_id);
}

#[tauri::command]
pub async fn save_ai_translation_key(
    api_key: String,
    limits: FreeTierLimits,
    free_confirmed: bool,
) -> Result<TranslationStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        ai_translation::save_key(api_key, limits, free_confirmed)
    })
    .await?
}

#[tauri::command]
pub async fn clear_ai_translation_key() -> Result<TranslationStatus, AppError> {
    tauri::async_runtime::spawn_blocking(ai_translation::clear_key).await?
}

#[tauri::command]
pub async fn test_ai_translation_connection(
    free_confirmed: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<TranslationStatus, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ai_translation::test_connection(free_confirmed, store.proxy_url())
    })
    .await?
}
