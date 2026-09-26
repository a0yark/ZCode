// ============================================================
// CLI Prefix Section Builder
// ============================================================

import { DEFAULT_BUILTIN_SYSTEM_PROMPTS } from "@zcode/shared";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

export function buildCliPrefixSection(
  content: string = DEFAULT_BUILTIN_SYSTEM_PROMPTS.cliPrefix,
): ContextSection {
  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
