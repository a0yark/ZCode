// ============================================================
// PowerShell 7 (pwsh) command construction for the Bash tool
// ============================================================
// 规格见 specs/powershell-bash-shell.md。

/**
 * 固定启动参数：不加载 profile，保证行为确定且启动快；命令正文走 -EncodedCommand。
 * 必须显式传 `-OutputFormat Text`：-EncodedCommand 在输出重定向时默认把错误流序列化为 CLIXML
 * （`#< CLIXML <Objs …>`），模型看到的就不是可读错误信息了（Linux 上用 pwsh 7.4 复现过）。
 */
const PWSH_BASE_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-OutputFormat",
  "Text",
] as const;

/**
 * 中文 Windows 上 pwsh 默认按系统代码页（如 gb2312）输出，进度条也会混进管道输出；
 * 统一切到无 BOM 的 UTF-8 并关闭进度流，输出解码器即可按 UTF-8 处理。
 */
const PWSH_PRELUDE = [
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$ProgressPreference = 'SilentlyContinue'",
].join("\n");

/**
 * `pwsh -Command` 默认只返回 0/1，会吞掉原生程序的退出码。
 * 必须紧跟在用户命令之后读取 `$?`，任何中间语句都会重置它。
 */
function buildExitCodeStatements(): string[] {
  return [
    "$__zcodeOk = $?",
    "$__zcodeCode = if ($__zcodeOk) { 0 } elseif ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { $LASTEXITCODE } else { 1 }",
  ];
}

/** 普通执行：命令后按上面的规则设置进程退出码。 */
function wrapPowerShellCommandWithExitCode(command: string): string {
  return [command, ...buildExitCodeStatements(), "exit $__zcodeCode"].join("\n");
}

/** cwd 捕获：成功时把最终目录以无 BOM UTF-8 写入临时文件，然后按同样规则退出。 */
export function createPowerShellCwdCaptureCommand(command: string, cwdFilePath: string): string {
  return [
    command,
    ...buildExitCodeStatements(),
    `if ($__zcodeCode -eq 0) { [System.IO.File]::WriteAllText(${powerShellSingleQuote(cwdFilePath)}, $PWD.ProviderPath) }`,
    "exit $__zcodeCode",
  ].join("\n");
}

/**
 * 生成 pwsh 参数。始终追加退出码尾声：cwd 捕获包装过的命令自带 `exit`，尾声不可达，不影响结果。
 */
export function createPowerShellArgs(command: string): string[] {
  const script = `${PWSH_PRELUDE}\n${wrapPowerShellCommandWithExitCode(command)}`;
  return [...PWSH_BASE_ARGS, "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

function powerShellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
