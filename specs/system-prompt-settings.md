# 系统提示词设置

## 目标

在“设置 → 系统提示词”中：

1. **内置段**：逐段列出主 Agent 系统提示词中可编辑的内置段，每段可以改写、停用、恢复默认。
2. **自定义提示词**：可以添加、编辑、删除、启用或停用多条自定义提示词，按列表顺序追加到系统提示词中。

修改对**新会话**生效。已有会话在开始时已固定系统提示词（同时保证 prompt cache 命中），不做热更新。

## 状态所有者与存储

- 唯一事实源：`<dataBaseDir>/.zcode/v2/system-prompts.json`。`dataBaseDir` 取 `ZCODE_DATA_BASE_DIR`，未设置时取用户主目录。与 `onboarding-record.json` 同目录。
- 写入方：`ISystemPromptSettingsService`（services，host 进程），整份文档替换写入，写入串行化，原子写。
- 读取方：
  - 设置页通过该 service 读写；
  - CLI 在会话 context 初始化时由 `NodeContextSourceAdapter` 读取，结果放进 `ContextSourceSnapshot.systemPromptSettings`。会话内 context 刷新复用同一 snapshot。
- 文件不存在，等价于全部默认。文件损坏（JSON 或 schema 不合法）时，CLI 忽略并记录 diagnostic，按默认处理；设置页显示读取失败，不覆盖原文件。

## 数据结构（`packages/shared/src/system-prompt-settings.ts`）

```jsonc
{
  "version": 1,
  "builtin": {
    // 缺省 = 默认文本且启用
    "communication": { "enabled": true, "content": "改写后的文本" },
    "security": { "enabled": false },
  },
  "custom": [
    { "id": "…", "title": "仅用于设置页显示", "content": "发给模型的正文", "enabled": true },
  ],
}
```

可编辑的内置段 ID 及其对应位置：

| ID                  | 对应段落                         | 说明                                                     |
| ------------------- | -------------------------------- | -------------------------------------------------------- |
| `cliPrefix`         | CLI Prefix（第一条 system 消息） | `You are ZCode, an interactive coding agent`             |
| `identity`          | Agent Identity 开场句            | 有 Output Style 且未改写时，沿用 Output Style 专用开场句 |
| `security`          | Agent Identity 安全条款          |                                                          |
| `harness`           | Agent Identity `# Harness`       |                                                          |
| `desktopContext`    | ZCode Desktop Context            | 仅在桌面端注入该段时生效                                 |
| `communication`     | Dynamic Behavior（沟通风格）     |                                                          |
| `contextManagement` | Context management               |                                                          |

默认文本定义在 shared 里，CLI 与设置页共用，保证“恢复默认”和实际行为一致。

不开放编辑的段：Memory（内含运行时路径）、Environment、gitStatus、Skills、AGENTS.md、currentDate（都是运行时数据）。

## 注入规则

- 内置段：`enabled=false` 时跳过该段；有 `content` 且去掉首尾空白后不为空时，替换默认文本。
- 自定义提示词：按顺序取 `enabled=true` 且内容不为空的条目，正文之间用空行拼接，作为稳定段 `User System Prompts` 放在内置稳定段之后（第二条 system 消息末尾）。标题不发给模型。
- 仅作用于主 Agent 的默认提示词路径。以下情况不受影响：
  - 会话配置了 `systemPrompt`（整段替换路径）；
  - 动态工作流子代理（沿用默认安全条款与 Harness）；
  - Explore / general-purpose 等子代理。

## 限制

- 单条内容上限 20,000 字符；自定义条目最多 50 条。超出时 service 以校验错误拒绝写入。
- 远程工作区的 agent 运行在远端机器上，读取远端机器上的文件；设置页只编辑本机文件。

## 验收

1. 未创建配置文件时，渲染出的系统提示词与改动前逐字一致。
2. 停用 `security` 后，新会话的系统提示词中不再出现安全条款；恢复默认后重新出现。
3. 改写 `communication` 后，新会话使用改写后的文本。
4. 添加两条自定义提示词、停用其中一条，新会话只包含启用的那条；删除后不再出现。
5. `pnpm typecheck`、`pnpm lint`、`pnpm --dir apps/zcode-cli typecheck`、`pnpm --dir apps/zcode-cli lint` 通过。
