// ============================================================
// System Prompt Settings Source
// ============================================================

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ContextSourceDiagnostic } from "@zcode/contracts";
import {
  SYSTEM_PROMPT_SETTINGS_PATH_SEGMENTS,
  systemPromptSettingsSchema,
  type SystemPromptSettings,
} from "@zcode/shared";

const ZCODE_DATA_BASE_DIR_ENV_KEY = "ZCODE_DATA_BASE_DIR";

/** 与 services 的 getAppConfigDir() 对齐：`<ZCODE_DATA_BASE_DIR | 用户主目录>/.zcode/v2/system-prompts.json`。 */
export function resolveSystemPromptSettingsPath(env: NodeJS.ProcessEnv): string {
  const baseDir = env[ZCODE_DATA_BASE_DIR_ENV_KEY]?.trim() || homedir();
  return join(baseDir, ...SYSTEM_PROMPT_SETTINGS_PATH_SEGMENTS);
}

/**
 * 读取设置页写入的系统提示词配置。文件不存在等价于全部默认；
 * 内容损坏时记录 diagnostic 并按默认处理，不能让一份坏配置阻断会话启动。
 */
export async function readSystemPromptSettings(
  env: NodeJS.ProcessEnv,
  diagnostics: ContextSourceDiagnostic[],
): Promise<SystemPromptSettings | undefined> {
  const filePath = resolveSystemPromptSettingsPath(env);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      diagnostics.push({
        code: "system_prompt_settings_read_failed",
        message: error instanceof Error ? error.message : "Failed to read system prompt settings",
        path: filePath,
      });
    }
    return undefined;
  }

  try {
    const parsed = systemPromptSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
    diagnostics.push({
      code: "system_prompt_settings_invalid",
      message: parsed.error.message,
      path: filePath,
    });
  } catch (error) {
    diagnostics.push({
      code: "system_prompt_settings_invalid",
      message: error instanceof Error ? error.message : "Invalid system prompt settings JSON",
      path: filePath,
    });
  }
  return undefined;
}
