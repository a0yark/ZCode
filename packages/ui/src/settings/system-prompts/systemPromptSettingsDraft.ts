import {
  DEFAULT_BUILTIN_SYSTEM_PROMPTS,
  type BuiltinSystemPromptSectionId,
  type CustomSystemPromptEntry,
  type SystemPromptSettings,
} from "@zcode/shared";

export interface BuiltinSystemPromptState {
  enabled: boolean;
  /** 当前生效文本：有改写时为改写文本，否则为默认文本。 */
  content: string;
  modified: boolean;
}

export function getBuiltinSystemPromptState(
  settings: SystemPromptSettings,
  id: BuiltinSystemPromptSectionId,
): BuiltinSystemPromptState {
  const override = settings.builtin[id];
  const customContent = override?.content?.trim() ? override.content : undefined;
  return {
    enabled: override?.enabled ?? true,
    content: customContent ?? DEFAULT_BUILTIN_SYSTEM_PROMPTS[id],
    modified: customContent !== undefined,
  };
}

/** 启用且没有改写的条目等价于默认，直接移除，保持配置文件只记录真实差异。 */
function withBuiltinOverride(
  settings: SystemPromptSettings,
  id: BuiltinSystemPromptSectionId,
  enabled: boolean,
  content: string | undefined,
): SystemPromptSettings {
  const builtin = { ...settings.builtin };
  const normalizedContent =
    content !== undefined && content.trim() && content.trim() !== DEFAULT_BUILTIN_SYSTEM_PROMPTS[id]
      ? content
      : undefined;
  if (enabled && normalizedContent === undefined) {
    delete builtin[id];
  } else {
    builtin[id] =
      normalizedContent === undefined ? { enabled } : { enabled, content: normalizedContent };
  }
  return { ...settings, builtin };
}

export function withBuiltinEnabled(
  settings: SystemPromptSettings,
  id: BuiltinSystemPromptSectionId,
  enabled: boolean,
): SystemPromptSettings {
  return withBuiltinOverride(settings, id, enabled, settings.builtin[id]?.content);
}

export function withBuiltinContent(
  settings: SystemPromptSettings,
  id: BuiltinSystemPromptSectionId,
  content: string,
): SystemPromptSettings {
  return withBuiltinOverride(settings, id, settings.builtin[id]?.enabled ?? true, content);
}

export function withBuiltinReset(
  settings: SystemPromptSettings,
  id: BuiltinSystemPromptSectionId,
): SystemPromptSettings {
  return withBuiltinOverride(settings, id, settings.builtin[id]?.enabled ?? true, undefined);
}

export function createCustomSystemPromptEntry(
  title: string,
  content: string,
): CustomSystemPromptEntry {
  return { id: crypto.randomUUID(), title: title.trim(), content, enabled: true };
}

export function withCustomUpserted(
  settings: SystemPromptSettings,
  entry: CustomSystemPromptEntry,
): SystemPromptSettings {
  const exists = settings.custom.some((item) => item.id === entry.id);
  return {
    ...settings,
    custom: exists
      ? settings.custom.map((item) => (item.id === entry.id ? entry : item))
      : [...settings.custom, entry],
  };
}

export function withCustomRemoved(
  settings: SystemPromptSettings,
  id: string,
): SystemPromptSettings {
  return { ...settings, custom: settings.custom.filter((item) => item.id !== id) };
}
