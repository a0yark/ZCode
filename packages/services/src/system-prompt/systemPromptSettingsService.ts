import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SYSTEM_PROMPT_SETTINGS_PATH_SEGMENTS,
  createDefaultSystemPromptSettings,
  systemPromptSettingsSchema,
  type SystemPromptSettings,
} from "@zcode/shared";
import { atomicWriteText } from "../fs/atomicFileUtils.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getDataBaseDir } from "../paths.js";
import type {
  ISystemPromptSettingsService,
  SystemPromptSettingsReadResult,
} from "./systemPromptSettings.js";

const logger = createServiceLogger("systemPromptSettingsService");

function getSettingsFile(): string {
  // CLI 以同样的规则（ZCODE_DATA_BASE_DIR 或用户主目录）解析路径，两端必须指向同一文件。
  return join(getDataBaseDir(), ...SYSTEM_PROMPT_SETTINGS_PATH_SEGMENTS);
}

async function readSettingsFile(filePath: string): Promise<SystemPromptSettingsReadResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "ok", settings: createDefaultSystemPromptSettings() };
    }
    throw error;
  }

  try {
    const parsed = systemPromptSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return { status: "ok", settings: parsed.data };
    }
    logger.warn(undefined, "invalid system prompt settings, using defaults:", parsed.error.message);
    return {
      status: "invalid",
      settings: createDefaultSystemPromptSettings(),
      error: parsed.error.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(undefined, "invalid system prompt settings json, using defaults:", message);
    return { status: "invalid", settings: createDefaultSystemPromptSettings(), error: message };
  }
}

export function createSystemPromptSettingsService(): ISystemPromptSettingsService {
  // 串行化写入：设置页连续保存时后一次必须基于前一次落盘后的状态。
  let writeQueue: Promise<unknown> = Promise.resolve();
  const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
    const queued = writeQueue.then(task, task) as Promise<T>;
    writeQueue = queued.catch(() => {});
    return queued;
  };

  return {
    async getSettings(): Promise<SystemPromptSettingsReadResult> {
      return readSettingsFile(getSettingsFile());
    },

    async saveSettings(settings: SystemPromptSettings): Promise<SystemPromptSettings> {
      const validated = systemPromptSettingsSchema.parse(settings);
      await enqueueWrite(async () => {
        const filePath = getSettingsFile();
        await mkdir(dirname(filePath), { recursive: true });
        await atomicWriteText(filePath, JSON.stringify(validated, null, 2));
      });
      logger.info(undefined, "system prompt settings saved", {
        builtinOverrides: Object.keys(validated.builtin).length,
        customCount: validated.custom.length,
      });
      return validated;
    },
  };
}
