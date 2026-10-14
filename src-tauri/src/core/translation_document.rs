//! Markdown prose spans originate from the existing frontend's AST parser.
//! Reconstruction replaces only these spans; all surrounding source bytes stay local.
use super::error::AppError;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub const RULE_VERSION: &str = "zh-prose-spans-v8";

#[derive(Clone, Serialize, Deserialize)]
pub struct TextSpan {
    pub field: String,
    pub start: usize,
    pub end: usize,
    #[serde(default)]
    pub kind: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct TranslationInput {
    pub skill_name: String,
    pub content: String,
    pub description: String,
    pub spans: Vec<TextSpan>,
    #[serde(default)]
    pub protected: Vec<TextSpan>,
    #[serde(default)]
    pub legacy: Option<Box<TranslationInput>>,
}

pub struct Unit {
    pub prefix: usize,
    pub span: TextSpan,
    pub text: String,
    pub protected: Vec<String>,
    pub formatting: Vec<(bool, bool)>,
    ordinary_parts: Vec<String>,
}
pub struct Plan {
    pub input: TranslationInput,
    pub units: Vec<Unit>,
    pub hash: String,
}

fn token_pattern() -> &'static Regex {
    static TOKENS: OnceLock<Regex> = OnceLock::new();
    TOKENS.get_or_init(|| Regex::new(r"⟦SM(\d+)_(\d+)⟧").unwrap())
}

pub fn prose_parts(unit: &Unit) -> Vec<String> {
    let placeholder = token_pattern();
    placeholder.split(&unit.text).map(str::to_owned).collect()
}

pub fn translation_parts(unit: &Unit) -> &[String] {
    &unit.ordinary_parts
}

pub fn join_parts(unit: &Unit, parts: &[String]) -> Result<String, AppError> {
    let originals = prose_parts(unit);
    let full = parts.len() == originals.len();
    if !full && parts.len() != translation_parts(unit).len() {
        return Err(AppError::network("译文普通文本片段缺失，已保留原文。"));
    }
    let mut text = String::new();
    let mut translated = parts.iter();
    for (index, original) in originals.iter().enumerate() {
        let supplied = if full || original.bytes().any(|b| b.is_ascii_alphabetic()) {
            Some(translated.next().unwrap())
        } else {
            None
        };
        let part = if full || original.bytes().any(|b| b.is_ascii_alphabetic()) {
            supplied.unwrap()
        } else {
            original
        };
        if part.contains("⟦SM") {
            return Err(AppError::network(
                "译文混入技术标记或丢失说明，已保留原文。",
            ));
        }
        if supplied.is_some() {
            // Preserve source boundaries even when a model trims its JSON fields.
            // Spaces around code/emphasis delimiters affect CommonMark parsing.
            let leading = &original[..original.len() - original.trim_start().len()];
            let trailing = &original[original.trim_end().len()..];
            text.push_str(leading);
            text.push_str(part.trim());
            text.push_str(trailing);
        } else {
            text.push_str(part);
        }
        if index < unit.protected.len() {
            text.push_str(&format!("⟦SM{}_{}⟧", unit.prefix, index));
        }
    }
    if !parts
        .iter()
        .any(|part| part.chars().any(char::is_alphabetic))
    {
        return Err(AppError::network("译文缺少普通说明，已保留原文。"));
    }
    restore(unit, &text)?;
    Ok(text)
}

fn source<'a>(input: &'a TranslationInput, field: &str) -> Result<&'a str, AppError> {
    match field {
        "content" => Ok(&input.content),
        "description" => Ok(&input.description),
        _ => Err(AppError::invalid_input("翻译片段来源无效。")),
    }
}

pub fn source_hash(input: &TranslationInput) -> String {
    source_hash_for_rule(input, RULE_VERSION)
}

pub fn source_hash_for_rule(input: &TranslationInput, rule: &str) -> String {
    let mut hasher = Sha256::new();
    for text in [
        &input.skill_name,
        &input.content,
        &input.description,
        super::ai_translation::MODEL,
        rule,
        "zh-CN",
    ] {
        hasher.update((text.len() as u64).to_le_bytes());
        hasher.update(text.as_bytes());
    }
    for span in input.spans.iter().chain(&input.protected) {
        hasher.update(span.field.as_bytes());
        hasher.update((span.start as u64).to_le_bytes());
        hasher.update((span.end as u64).to_le_bytes());
    }
    hex::encode(hasher.finalize())
}

pub fn summary_hash(name: &str, description: &str) -> String {
    summary_hash_for_rule(name, description, RULE_VERSION)
}

pub fn summary_hash_for_rule(name: &str, description: &str, rule: &str) -> String {
    source_hash_for_rule(
        &TranslationInput {
            skill_name: name.into(),
            content: String::new(),
            description: description.into(),
            spans: vec![],
            protected: vec![],
            legacy: None,
        },
        rule,
    )
}

fn scan_sensitive(input: &TranslationInput) -> Result<(), AppError> {
    let pattern = Regex::new(r#"(?i)(?:AIza[A-Za-z0-9_-]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_+/=-]{24,})"#).unwrap();
    if pattern.is_match(&input.content) || pattern.is_match(&input.description) {
        return Err(AppError::invalid_input("文档可能含有密钥或敏感信息，已阻止发送到 Google。请先制作去除敏感信息的阅读副本；原文件未修改。"));
    }
    Ok(())
}

fn protect(
    raw: &str,
    name: &str,
    prefix: usize,
    shields: Vec<(usize, usize)>,
    formats: Vec<(usize, usize)>,
) -> (String, Vec<String>, Vec<(usize, usize)>) {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| Regex::new(r#"(?x)
        https?://[^\s<>]+ | (?:[A-Za-z]:\\|~/|\./|\.\./|/)[^\s<>,;]+ |
        [A-Za-z0-9_.-]+(?:[/\\][A-Za-z0-9_.-]+)+ |
        [A-Za-z0-9_-]+\.(?:md|json|ya?ml|toml|tsx?|jsx?|mjs|cjs|py|sh|ps1|mp4|html|css|exe|txt)\b |
        \$\{[^}]+\} | \$[A-Za-z_][A-Za-z0-9_]* | %[A-Za-z_][A-Za-z0-9_]*% |
        --?[A-Za-z][A-Za-z0-9_-]*(?:=[^\s,;]+)? |
        \b\d+(?:[._xX]\d+)*(?:%|px|ms|s|fps|k|K)?\b |
        \b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b | \b(?:API|JSON|YAML|HTML|CSS|CLI|SDK|HTTP|HTTPS|SQL|GSAP)\b | \b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_-]+\b |
        Claude\s+Code | Google\s+Gemini | Skills\s+Manager |
        \bhyperframes\s+(?:remove-background|init|add|render|transcribe|tts|preview|validate|doctor)\b |
        \b(?:Codex|Claude|Gemini|Pi|GitHub|HyperFrames|hyperframes|GSAP|Whisper|FFmpeg|ffmpeg|HeyGen|ElevenLabs|Kokoro|React|Tauri|TypeScript|JavaScript|Python|OpenAI|Remotion|Lottie|Three\.js)\b |
        \r?\n | \\. | [&][A-Za-z0-9\#]+; | [*\[\]\\<>~|`]
    "#).unwrap());
    let mut protected = Vec::new();
    let mut ranges: Vec<(usize, usize)> = pattern
        .find_iter(raw)
        // An option must start at a word boundary: the suffix of talking-head
        // or mix-blend is ordinary prose, not a command-line flag.
        .filter(|m| {
            !(m.as_str().starts_with('-')
                && m.start() > 0
                && raw[..m.start()]
                    .chars()
                    .next_back()
                    .is_some_and(|ch| ch.is_alphanumeric()))
        })
        .map(|m| (m.start(), m.end()))
        .collect();
    if !name.is_empty() {
        ranges.extend(
            raw.match_indices(name)
                .map(|(start, _)| (start, start + name.len())),
        );
    }
    ranges.extend(shields);
    ranges.sort_by_key(|(start, end)| (*start, std::cmp::Reverse(*end)));
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in ranges {
        if let Some(previous) = merged.last_mut() {
            if start <= previous.1 {
                previous.1 = previous.1.max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    let mut result = String::new();
    let mut cursor = 0;
    let positions = merged.clone();
    for (start, end) in merged {
        if start < cursor {
            continue;
        }
        result.push_str(&raw[cursor..start]);
        result.push_str(&format!("⟦SM{prefix}_{}⟧", protected.len()));
        let mut value = raw[start..end].as_bytes().to_vec();
        // CommonMark underscores cannot emphasize a Chinese word inside another word.
        // Normalize only AST-confirmed formatting delimiters; code and identifiers stay exact.
        for (left, right) in &formats {
            for offset in (*left).max(start)..(*right).min(end) {
                if value[offset - start] == b'_' {
                    value[offset - start] = b'*';
                }
            }
        }
        protected.push(String::from_utf8(value).unwrap());
        cursor = end;
    }
    result.push_str(&raw[cursor..]);
    (result, protected, positions)
}

pub fn prepare(input: TranslationInput) -> Result<Plan, AppError> {
    if input.content.len() + input.description.len() > 2 * 1024 * 1024
        || input.spans.len() > 20000
        || input.skill_name.len() > 200
    {
        return Err(AppError::invalid_input(
            "文档超出本次翻译的安全大小限制（2 MB），请分章节阅读；没有截断原文。",
        ));
    }
    if input.legacy.as_ref().is_some_and(|old| {
        old.legacy.is_some()
            || old.content != input.content
            || old.description != input.description
            || old.skill_name != input.skill_name
    }) {
        return Err(AppError::invalid_input("旧缓存对应的原文不一致。"));
    }
    scan_sensitive(&input)?;
    for shield in &input.protected {
        let value = source(&input, &shield.field)?;
        if shield.start >= shield.end
            || shield.end > value.len()
            || !value.is_char_boundary(shield.start)
            || !value.is_char_boundary(shield.end)
        {
            return Err(AppError::invalid_input(
                "Markdown 保护范围异常，已保留原文。",
            ));
        }
    }
    let mut ends = [0, 0];
    let mut units = Vec::new();
    for span in &input.spans {
        let raw_source = source(&input, &span.field)?;
        let index = if span.field == "content" { 0 } else { 1 };
        if span.start < ends[index]
            || span.start >= span.end
            || span.end > raw_source.len()
            || !raw_source.is_char_boundary(span.start)
            || !raw_source.is_char_boundary(span.end)
        {
            return Err(AppError::invalid_input("翻译片段位置异常，已保留原文。"));
        }
        let raw = &raw_source[span.start..span.end];
        ends[index] = span.end;
        if raw.contains("⟦SM") || raw.len() > 12000 {
            return Err(AppError::invalid_input("翻译片段结构异常，已保留原文。"));
        }
        let prefix = units.len();
        let shields = input
            .protected
            .iter()
            .filter(|shield| {
                shield.field == span.field && shield.start < span.end && shield.end > span.start
            })
            .map(|shield| {
                (
                    shield.start.max(span.start) - span.start,
                    shield.end.min(span.end) - span.start,
                )
            })
            .collect();
        let formats = input
            .protected
            .iter()
            .filter(|shield| {
                shield
                    .kind
                    .as_deref()
                    .is_some_and(|kind| kind.starts_with("format"))
                    && shield.field == span.field
                    && shield.start < span.end
                    && shield.end > span.start
            })
            .map(|shield| {
                (
                    shield.start.max(span.start) - span.start,
                    shield.end.min(span.end) - span.start,
                )
            })
            .collect();
        let (text, protected, positions) =
            protect(raw, &input.skill_name, prefix, shields, formats);
        let formatting = positions
            .iter()
            .map(|(start, end)| {
                let opening = input.protected.iter().any(|shield| {
                    shield.field == span.field
                        && shield.kind.as_deref() == Some("format-open")
                        && shield.start == span.start + start
                });
                let closing = input.protected.iter().any(|shield| {
                    shield.field == span.field
                        && shield.kind.as_deref() == Some("format-close")
                        && shield.end == span.start + end
                });
                (opening, closing)
            })
            .collect();
        // Entirely technical fragments need no network request.
        let prose = token_pattern().replace_all(&text, "");
        if prose.bytes().any(|b| b.is_ascii_alphabetic()) {
            units.push(Unit {
                prefix,
                span: span.clone(),
                protected,
                formatting,
                ordinary_parts: token_pattern()
                    .split(&text)
                    .filter(|part| part.bytes().any(|b| b.is_ascii_alphabetic()))
                    .map(str::to_owned)
                    .collect(),
                text,
            });
        }
    }
    let hash = source_hash(&input);
    Ok(Plan { input, units, hash })
}

pub fn restore(unit: &Unit, translated: &str) -> Result<String, AppError> {
    if translated.trim().is_empty()
        || translated.contains(['\n', '\r'])
        || translated.len() > 8 * (unit.text.len() + 100)
    {
        return Err(AppError::network(
            "译文为空、被截断或段落结构异常，已保留原文。请手动重试。",
        ));
    }
    let placeholder = token_pattern();
    let mut counts = vec![0; unit.protected.len()];
    let mut expected = 0;
    for captures in placeholder.captures_iter(translated) {
        let index = captures[2]
            .parse::<usize>()
            .map_err(|_| AppError::network("技术标识校验失败，已保留原文。"))?;
        if captures[1].parse::<usize>().ok() != Some(unit.prefix) || index >= counts.len() {
            return Err(AppError::network("技术标识校验失败，已保留原文。"));
        }
        if index != expected {
            return Err(AppError::network(
                "本地技术标识顺序校验失败，该片段保留英文。",
            ));
        }
        expected += 1;
        counts[index] += 1;
    }
    if counts.iter().any(|count| *count != 1) || translated.matches("⟦SM").count() != counts.len()
    {
        return Err(AppError::network(
            "代码、路径或技术标识在译文中丢失或重复，已保留原文。请手动重试。",
        ));
    }
    // Escape prose only. Placeholder underscores must never be escaped before restoration.
    let escape = |text: &str| {
        let mut escaped = String::new();
        for ch in text.chars() {
            if ch.is_ascii_punctuation() {
                escaped.push('\\');
            }
            escaped.push(ch);
        }
        escaped
    };
    let mut safe = String::new();
    let mut cursor = 0;
    let source_parts = prose_parts(unit);
    let segment = |text: &str, left: Option<usize>, right: Option<usize>| {
        let mut value = text.to_owned();
        if left.is_some_and(|index| unit.formatting[index].0 && !unit.formatting[index].1) {
            value = value.trim_start().to_owned();
        }
        if right.is_some_and(|index| unit.formatting[index].1 && !unit.formatting[index].0) {
            value = value.trim_end().to_owned();
        }
        if let Some(index) = left.filter(|index| unit.formatting[*index].1) {
            let original = &source_parts[index + 1];
            if (original.starts_with(char::is_whitespace) || value.starts_with(char::is_alphabetic))
                && !value.starts_with(char::is_whitespace)
            {
                value.insert(0, ' ');
            }
        }
        if let Some(index) = right.filter(|index| unit.formatting[*index].0) {
            let original = &source_parts[index];
            if original.ends_with(char::is_whitespace) && !value.ends_with(char::is_whitespace) {
                value.push(' ');
            }
        }
        value
    };
    let mut left = None;
    for caps in placeholder.captures_iter(translated) {
        let index = caps[2].parse::<usize>().unwrap();
        let found = caps.get(0).unwrap();
        safe.push_str(&escape(&segment(
            &translated[cursor..found.start()],
            left,
            Some(index),
        )));
        safe.push_str(&unit.protected[index]);
        cursor = found.end();
        left = Some(index);
    }
    safe.push_str(&escape(&segment(&translated[cursor..], left, None)));
    Ok(safe)
}

// Re-encode a verified legacy paragraph using the new local protection ranges.
pub fn import_restored(unit: &Unit, restored: &str) -> Result<String, AppError> {
    let unescape = Regex::new(r"\\([[:punct:]])").unwrap();
    let mut output = String::new();
    let mut cursor = 0;
    for (index, protected) in unit.protected.iter().enumerate() {
        let position = restored[cursor..]
            .find(protected)
            .ok_or_else(|| AppError::network("旧缓存技术标识不匹配，该片段待重试。"))?
            + cursor;
        output.push_str(&unescape.replace_all(&restored[cursor..position], "$1"));
        output.push_str(&format!("⟦SM{}_{}⟧", unit.prefix, index));
        cursor = position + protected.len();
    }
    output.push_str(&unescape.replace_all(&restored[cursor..], "$1"));
    restore(unit, &output)?;
    Ok(output)
}

pub fn assemble(
    plan: &Plan,
    translations: &[Option<String>],
) -> Result<(String, String), AppError> {
    if translations.len() != plan.units.len() {
        return Err(AppError::network("译文片段数量异常，已保留原文。"));
    }
    let mut content = plan.input.content.clone();
    let mut description = plan.input.description.clone();
    for (unit, translated) in plan.units.iter().zip(translations).rev() {
        let target = if unit.span.field == "content" {
            &mut content
        } else {
            &mut description
        };
        if let Some(translated) = translated {
            target.replace_range(unit.span.start..unit.span.end, translated);
        }
    }
    Ok((content, description))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(raw: &str) -> TranslationInput {
        TranslationInput {
            skill_name: "sample-skill".into(),
            content: raw.into(),
            description: String::new(),
            spans: vec![TextSpan {
                field: "content".into(),
                start: 0,
                end: raw.len(),
                kind: None,
            }],
            protected: vec![],
            legacy: None,
        }
    }
    #[test]
    fn protects_paths_flags_products_and_identifiers() {
        let plan = prepare(input(
            "Read C:\\Skills\\SKILL.md with Codex and --dry-run using $API_KEY in sample-skill.",
        ))
        .unwrap();
        let unit = &plan.units[0];
        let translated = format!("请阅读 {}", unit.text);
        let restored = restore(unit, &translated).unwrap();
        for token in [
            "C:\\Skills\\SKILL.md",
            "Codex",
            "--dry-run",
            "$API_KEY",
            "sample-skill",
        ] {
            assert!(restored.contains(token));
        }
        assert!(restore(unit, "中文但丢失标识").is_err());
        assert!(restore(unit, &format!("{} ⟦SM0_0⟧", unit.text)).is_err());
    }
    #[test]
    fn preserves_surrounding_code_and_markdown_bytes() {
        let raw = "# Heading\r\n\r\n```json\r\n{\"key\":\"value\"}\r\n```\r\n";
        let mut source = input(raw);
        source.spans[0] = TextSpan {
            field: "content".into(),
            start: 2,
            end: 9,
            kind: None,
        };
        let plan = prepare(source).unwrap();
        let (result, _) = assemble(&plan, &[Some("标题".into())]).unwrap();
        assert_eq!(result, raw.replacen("Heading", "标题", 1));
    }
    #[test]
    fn hash_invalidates_content_model_rule_and_description_changes() {
        let first = input("Read notes");
        let mut changed = first.clone();
        changed.description = "Updated".into();
        assert_ne!(source_hash(&first), source_hash(&changed));
        changed = first.clone();
        changed.content.push('!');
        assert_ne!(source_hash(&first), source_hash(&changed));
    }
    #[test]
    fn blocks_sensitive_content_and_invalid_spans() {
        assert!(prepare(input("Token sk-abcdefghijklmnopqrstuvwxyz1234567890")).is_err());
        let mut malformed = input("中文 Read");
        malformed.spans[0].start = 1;
        assert!(prepare(malformed).is_err());
    }
    #[test]
    fn rejects_missing_output_and_new_lines() {
        let plan = prepare(input("Read notes")).unwrap();
        assert_eq!(assemble(&plan, &[None]).unwrap().0, "Read notes");
        assert!(restore(&plan.units[0], "添加\n步骤").is_err());
        assert_eq!(
            restore(&plan.units[0], "新 *标记* [链接]").unwrap(),
            "新 \\*标记\\* \\[链接\\]"
        );
    }

    #[test]
    fn plain_parts_restore_technical_tokens_without_trusting_model_token_ids() {
        let plan = prepare(input("Read C:\\Skills\\SKILL.md with Codex at 30fps.")).unwrap();
        let unit = &plan.units[0];
        let parts = translation_parts(unit)
            .iter()
            .map(|_| "中文说明".to_string())
            .collect::<Vec<_>>();
        let joined = join_parts(unit, &parts).unwrap();
        let restored = restore(unit, &joined).unwrap();
        for token in ["C:\\Skills\\SKILL.md", "Codex", "30fps"] {
            assert!(restored.contains(token));
        }
        let mut bad = parts.clone();
        bad[0] = "⟦SM999_0⟧".into();
        assert!(join_parts(unit, &bad).is_err());
        assert!(join_parts(unit, &[]).is_err());
    }
}
