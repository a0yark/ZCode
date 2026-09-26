# 关闭官方账号登录，保留 API 接入

## 背景

本分支不再接入 Z.ai / BigModel 官方账号体系（OAuth 登录、Coding Plan / Start Plan / 团队套餐）。
模型接入只保留不依赖账号的方式：

- 从模板创建的 Z.ai API、BigModel API 供应商（填 API Key）；
- 完全自定义的 OpenAI / Anthropic 兼容供应商。

## 状态所有者

唯一开关：`ACCOUNT_LOGIN_ENABLED`（`packages/shared/src/accountLogin.ts`），当前为 `false`。
UI 各入口与 services 层 OAuth provider 的默认启用状态都读这个常量，不另设第二个开关。

| 层                                                               | 行为（开关关闭时）                                                                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| services：`zaiProviderConfig` / `bigmodelProviderConfig`         | provider 默认 `enabled=false`。`listProviders` 为空，`restoreCachedSessionState` 返回 `signed-out`，`startLogin` 拒绝。仍可用 `ZAI_OAUTH_ENABLED` / `BIGMODEL_OAUTH_ENABLED` 环境变量显式覆盖。 |
| Root 启动门禁：`shouldEnableProviderAvailabilityLoginEntryGuard` | 返回 `false`，首次启动没有可用模型时不打开 WelcomeScreen，直接进入主界面。                                                                                                                      |
| Root：会话过期 / 重新认证                                        | 不消费 JWT 失效重启标记，`handleReauthenticationRequired` 不打开登录页；`useRootOAuthEffects` 不订阅 JWT 失效广播。                                                                             |
| Root：`onLogin`                                                  | 不向侧边栏、设置页和命令下发登录入口。                                                                                                                                                          |
| 侧边栏头像                                                       | 未登录时显示 “ZCode” 和 “Z” 头像，不显示“未登录”；隐藏“升级套餐”菜单项。                                                                                                                        |
| 设置 → 模型供应商                                                | 隐藏预置账号供应商（Start Plan）、Coding Plan 与团队套餐条目以及连接方式切换；只剩自定义供应商分组。列表为空时直接显示模板选择器。                                                              |

## 不变量

- `user` 始终为 `null`：登录只能经由 OAuth，而 OAuth provider 已被禁用。
- 分享入口依赖 `user`（`WorkspaceHeaderActionSection`），因此自动隐藏；用量页的 Coding Plan 标签依赖已订阅的套餐来源，也会自动隐藏。
- `platform.notifyRendererReady()` 仍由 `useRootOAuthEffects` 调用，启动握手不受影响。
- OAuth 会话恢复仍会执行一次，结果是 `signed-out`，随后把 `isRestoringOAuthSession` 置为 `false`，启动门禁因此能正常结束。

## 失效的功能

Coding Plan / Start Plan 套餐与用量、会话分享、ZCode 官方 MCP 额度。它们都依赖官方账号。

## 迁移边界

- 如果与官方 ZCode 共用数据目录，残留的 OAuth active provider 会在启动恢复时因为 provider 被禁用而清除。
- CLI（`apps/zcode-cli`）终端版的 `login` 命令不在这次范围内。
- 恢复登录：把 `ACCOUNT_LOGIN_ENABLED` 改回 `true` 即可，不需要回滚其它代码。

## 验收

1. 全新数据目录启动桌面版：不出现登录页，直接进入主界面。
2. 侧边栏头像显示 ZCode，菜单中没有“登录”“升级套餐”。
3. 设置 → 模型供应商：没有 Z.ai / BigModel 账号卡片；列表为空时显示模板选择器。用 BigModel API 模板填 Key 后，可以在聊天中选中该供应商的模型。
4. `pnpm typecheck`、`pnpm lint` 通过。
