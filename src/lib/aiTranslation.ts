import { invoke, Channel } from "@tauri-apps/api/core";
import type { TranslationInput } from "./translationMarkdown";

export interface FreeTierLimits {
  rpm: number;
  tpm: number;
  rpd: number;
}

export interface TranslationStatus {
  provider: string;
  model: string;
  has_key: boolean;
  limits: FreeTierLimits | null;
  saved_at: string | null;
  last_test_at: string | null;
  last_test_passed: boolean;
  authorized: boolean;
  authorized_at: string | null;
}

// The saved key has no read command. Frontend memory holds only newly typed input.
export const getTranslationStatus = () => invoke<TranslationStatus>("get_ai_translation_status");
export const setTranslationConsent = (authorized: boolean) => invoke<TranslationStatus>("set_ai_translation_consent", { authorized });
export const saveTranslationKey = (apiKey: string, limits: FreeTierLimits, freeConfirmed: boolean) =>
  invoke<TranslationStatus>("save_ai_translation_key", { apiKey, limits, freeConfirmed });
export const clearTranslationKey = () => invoke<TranslationStatus>("clear_ai_translation_key");
export const testTranslationConnection = (freeConfirmed: boolean) =>
  invoke<TranslationStatus>("test_ai_translation_connection", { freeConfirmed });

export interface TranslationResult { content: string; description: string; source_hash: string; model: string; cached: boolean; requests: number; rule?: string; legacy_cache?: boolean; complete: boolean; completed: number; total: number; pending: TranslationInput["spans"]; fragments: { span: TranslationInput["spans"][number]; text: string | null }[] }
export interface TranslationProgress { job_id: string; state: "waiting" | "translating" | "complete" | "partial"; completed: number; total: number; requests: number; preview?: TranslationResult | null }
export const getCachedTranslation = (input: TranslationInput) => invoke<TranslationResult | null>("get_cached_skill_translation", { input });
export const rejectTranslationFragments = (input: TranslationInput, rejected: TranslationInput["spans"]) => invoke<void>("reject_skill_translation_fragments", { input, rejected });
export const getCachedSummary = (skillName: string, description: string) => invoke<string | null>("get_cached_skill_summary", { skillName, description });
export const cancelTranslation = (jobId: string) => invoke<void>("cancel_skill_translation", { jobId });
export function translateDocument(input: TranslationInput, freeConfirmed: boolean, force: boolean, jobId: string, onProgress: (value: TranslationProgress) => void) {
  const progress = new Channel<TranslationProgress>();
  progress.onmessage = onProgress;
  return invoke<TranslationResult>("translate_skill_document", { input, freeConfirmed, force, jobId, onProgress: progress });
}
