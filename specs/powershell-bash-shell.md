# Bash 工具支持 PowerShell 7（Windows）

## 目标

“设置 → 常规 → 集成终端 Shell”在 Windows 上新增 **PowerShell 7** 选项。选中后，新会话中 Bash 工具的命令交给 `pwsh.exe` 执行，模型按 PowerShell 语法写命令。

“自动选择”的行为保持不变：优先 Git Bash，找不到时回退 cmd.exe。PowerShell 7 只能手动选择。

## 探测（services `listIntegratedTerminalShellOptions`）

按顺序取第一个可执行文件：

1. `%ProgramFiles%\PowerShell\7\pwsh.exe`、`%ProgramFiles%\PowerShell\7-preview\pwsh.exe`（含 `C:\Program Files` 回退）；
2. PATH 中的 `pwsh`（覆盖 Microsoft Store 安装的 `WindowsApps\pwsh.exe` 应用执行别名、winget、scoop 等）。

选项：`{ dialect: "pwsh", id: "pwsh:<path>", label: "PowerShell 7" }`。Windows PowerShell 5.1（`powershell.exe`）不在范围内。

## 状态与传递

- 设置值沿用 `AppSettings.integratedTerminalShell`，`dialect` 枚举新增 `"pwsh"`（shared 与 CLI contracts 的 `ExecutionShellDialect` 同步新增）。
- 会话创建时由 protocol 层映射为 `ExecutionShellSelection`（`display.name = "PowerShell 7"`），并随会话快照持久化；恢复会话时校验路径仍可执行。
- 模型通过环境段 `Shell: PowerShell 7` 得知当前 shell。

## 执行语义（CLI adapters）

- 启动：`pwsh.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand <base64(UTF-16LE)>`，`shell: false`。用 `-EncodedCommand` 传命令，避免 Windows 命令行二次转义。不加载用户 profile，保证行为确定、启动快。
- 前导：把 `[Console]::OutputEncoding` 和 `$OutputEncoding` 设为无 BOM 的 UTF-8，避免中文系统默认代码页（如 gb2312）造成乱码；`$ProgressPreference = 'SilentlyContinue'`，防止进度条污染输出。
- 退出码：`pwsh -Command` 默认只返回 0/1。命令后追加尾声：
  - 最后一条语句成功时，返回 0；
  - 失败且 `$LASTEXITCODE` 非零时，返回 `$LASTEXITCODE`，保留原生程序的退出码；
  - 其余失败情况返回 1。
- cwd 捕获（`captureCwdAfterSuccess`）：成功时把 `$PWD.ProviderPath` 以无 BOM 的 UTF-8 写入临时文件，与 cmd、posix 的语义一致。
- 不支持的能力（与 cmd 一致）：shell 初始化快照、启动脚本、内置 find/grep 函数前缀。

## 验收

1. 装有 PowerShell 7 的 Windows 上，设置下拉框出现 “PowerShell 7”；未安装时不出现。
2. 选中后新会话执行 `Get-ChildItem`、`$PSVersionTable.PSVersion.Major` 正常，中文输出不乱码。
3. `cmd /c exit 3` 的退出码为 3；`Get-Item not-exist` 的退出码为 1；成功命令为 0。
4. `Set-Location` 到子目录后，下一次 Bash 调用的工作目录跟随变化。
5. `pnpm typecheck`、`pnpm lint` 通过；CLI 相关包 `tsc --noEmit` 通过。
