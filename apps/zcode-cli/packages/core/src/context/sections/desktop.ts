import { DEFAULT_BUILTIN_SYSTEM_PROMPTS } from "@zcode/shared";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

export function buildDesktopContextSection(
  content: string = DEFAULT_BUILTIN_SYSTEM_PROMPTS.desktopContext,
): ContextSection {
  return createDesktopSection("ZCode Desktop Context", "desktop_context", content);
}

function createDesktopSection(
  name: string,
  source: ContextSection["source"],
  content: string,
): ContextSection {
  return {
    name,
    source,
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
