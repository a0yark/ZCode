// ============================================================
// Identity Section Builder
// ============================================================

import {
  DEFAULT_BUILTIN_SYSTEM_PROMPTS,
  resolveBuiltinSystemPromptText,
  type SystemPromptSettings,
} from "@zcode/shared";
import type { ContextSection } from "../types.js";
import type { OutputStylePromptConfig } from "../types.js";
import { estimateTokens } from "../utils.js";

const OUTPUT_STYLE_IDENTITY_INTRO =
  "You respond to the user according to the active Output Style below while using ZCode's tools and instructions.";

/** 安全 IMPORTANT 行：交互式身份与工作流子代理身份共用，逐字同一份。 */
export function buildSecurityNotice(): string {
  return DEFAULT_BUILTIN_SYSTEM_PROMPTS.security;
}

/**
 * `# Harness` 块：稳定运行时约束，不属于 output style 可替换的 coding instructions，
 * 也是工作流子代理身份（sections/workflow-actor.ts）逐字复用的那一段。
 */
export function buildHarnessBlock(): string {
  return DEFAULT_BUILTIN_SYSTEM_PROMPTS.harness;
}

/** Agent Identity 由三部分组成；null 表示该部分被用户在系统提示词设置中停用。 */
export interface IdentitySectionParts {
  intro: string | null;
  security: string | null;
  harness: string | null;
}

function resolveDefaultIdentityIntro(outputStyle?: OutputStylePromptConfig): string {
  return outputStyle ? OUTPUT_STYLE_IDENTITY_INTRO : DEFAULT_BUILTIN_SYSTEM_PROMPTS.identity;
}

/** 按系统提示词设置解析身份段三部分；开场句未改写时沿用与 Output Style 相关的默认值。 */
export function resolveIdentitySectionParts(
  settings: SystemPromptSettings | undefined,
  outputStyle?: OutputStylePromptConfig,
): IdentitySectionParts {
  return {
    intro: resolveBuiltinSystemPromptText(
      settings,
      "identity",
      resolveDefaultIdentityIntro(outputStyle),
    ),
    security: resolveBuiltinSystemPromptText(settings, "security"),
    harness: resolveBuiltinSystemPromptText(settings, "harness"),
  };
}

function buildIdentityPrompt(parts: IdentitySectionParts): string {
  // 保持与改造前逐字一致：开场句与安全条款组成首块（以空行开头），Harness 以空行分隔追加。
  const identityBlock = [parts.intro, parts.security].filter(
    (part): part is string => part !== null,
  );
  const blocks = [
    ...(identityBlock.length > 0 ? [`\n${identityBlock.join("\n\n")}`] : []),
    ...(parts.harness !== null ? [parts.harness] : []),
  ];
  return blocks.join("\n\n");
}

export function buildIdentitySection(
  outputStyle?: OutputStylePromptConfig,
  parts?: IdentitySectionParts,
): ContextSection | null {
  const content = buildIdentityPrompt(parts ?? resolveIdentitySectionParts(undefined, outputStyle));
  if (!content.trim()) {
    return null;
  }

  return {
    name: "Agent Identity",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
