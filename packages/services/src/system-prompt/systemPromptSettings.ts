import type { SystemPromptSettings } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export type SystemPromptSettingsReadResult =
  | { status: "ok"; settings: SystemPromptSettings }
  /** 文件存在但内容不合法；设置页提示用户，保存时才会覆盖。 */
  | { status: "invalid"; settings: SystemPromptSettings; error: string };

/**
 * 系统提示词设置（`<dataBaseDir>/.zcode/v2/system-prompts.json`）的唯一写入方。
 * CLI 在会话 context 初始化时读取同一文件，修改对新会话生效。详见 specs/system-prompt-settings.md。
 */
export interface ISystemPromptSettingsService {
  /** 读取当前设置；文件不存在时返回默认（全部内置段启用、无自定义提示词）。 */
  getSettings(): Promise<SystemPromptSettingsReadResult>;
  /** 整份替换写入；schema 不合法时抛错且不改动文件。返回规范化后的设置。 */
  saveSettings(settings: SystemPromptSettings): Promise<SystemPromptSettings>;
}

export const ISystemPromptSettingsService = createServiceDescriptor<ISystemPromptSettingsService>(
  ServiceChannels.SystemPromptSettings,
);
