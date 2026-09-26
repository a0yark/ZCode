// ============================================================
// User System Prompts Section Builder
// ============================================================

import { resolveEnabledCustomSystemPrompts, type SystemPromptSettings } from "@zcode/shared";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

/** 设置页“自定义提示词”：启用条目按顺序以空行拼接，作为稳定 system 段追加在内置稳定段之后。 */
export function buildUserSystemPromptsSection(
  settings: SystemPromptSettings | undefined,
): ContextSection | null {
  const prompts = resolveEnabledCustomSystemPrompts(settings);
  if (prompts.length === 0) {
    return null;
  }

  const content = prompts.join("\n\n");
  return {
    name: "User System Prompts",
    source: "user_system_prompts",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
