import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CuaHelperError } from "./broker.js";

export const HELPER_ADDON_ENV = "ZCODE_CUA_HELPER_ADDON";
export const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";

const UNAVAILABLE = "Computer Use is not available in this build.";

function unavailableReject() {
  return Promise.reject(new CuaHelperError(UNAVAILABLE));
}

export function buildHelperOpenArgs(_spec, _launcherPid) {
  return [];
}

export async function resolveHelperPermissionSubjectIdentity(_appPath) {
  throw new CuaHelperError(UNAVAILABLE);
}

export function isCuaLocalDevelopmentRuntime(_env, _compiledLocalDevelopmentRuntime) {
  return false;
}

export function createCuaHelperInstaller(_options) {
  return {
    ensureInstalled: unavailableReject,
    verifyInstalled: unavailableReject,
  };
}

export const defaultCuaHelperVerifierDependencies = {
  readExecutableArchs: unavailableReject,
  verifyCodeSignature: unavailableReject,
  verifyTeamIdentifier: unavailableReject,
};

export function cuaBrokerRefreshMarkerPath(_socketPath) {
  return undefined;
}

export async function publishCuaBrokerRefreshMarker(_socketPath, _options) {
  return { path: undefined };
}

export function loadRealNativeAddon(_options) {
  throw new CuaHelperError(UNAVAILABLE);
}

export function resolvePackagedNativeAddonPath(_options) {
  return undefined;
}

export function resolveInTreeAddonPath(_options) {
  return undefined;
}

export function createAxReadOnlyMethods(_source, _registry, _options) {
  return {};
}

export const ROLE_TO_KIND = {};

export function roleToKind(_role) {
  return undefined;
}

export class CuaHelperLifecycleManager {
  #dispose;
  #current;
  #disposed = false;
  constructor(dispose) {
    this.#dispose = dispose;
    this.#current = undefined;
  }
  async acquire(options) {
    if (typeof options?.isAdmitted === "function" && !options.isAdmitted()) {
      return undefined;
    }
    const managed = options?.create?.();
    this.#current = managed;
    return managed;
  }
  peek() {
    return this.#current;
  }
  get disposed() {
    return this.#disposed;
  }
  async dispose(managed) {
    this.#disposed = true;
    await this.#dispose?.(managed ?? this.#current);
  }
}

export class CuaProductHelperWorkspaceRegistry {
  setEnabled(_context, _enabled) {}
}

export function createProductCuaHelperHost(_options) {
  return createUnavailableCuaHelperHost();
}

function createUnavailableCuaHelperHost() {
  return {
    get running() {
      return false;
    },
    get socketPath() {
      return null;
    },
    get pluginAuthority() {
      return null;
    },
    get reservedTransport() {
      return undefined;
    },
    start: unavailableReject,
    stop: async () => {},
    restart: unavailableReject,
    restartAfterCurrentStart: unavailableReject,
    waitForTransport: unavailableReject,
    checkHealth: unavailableReject,
    queryScreenCaptureProbe: async () => ({
      ok: false,
      reason: UNAVAILABLE,
    }),
    queryScreenRecordingPreflight: async () => undefined,
    queryPermissionStatus: async () => ({}),
  };
}

const OFFICIAL_CUA_PLUGIN_ID = "computer-use@zcode-plugins-official";
const ZCODE_PROJECT_CONFIG_BASENAMES = ["zcode.json", join(".zcode", "config.json")];
const WORKTREE_MARKER = ".git";

function hasWorktreeMarker(dir) {
  try {
    const stats = statSync(join(dir, WORKTREE_MARKER));
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

/** 从 dir 向上收集配置目录;命中 worktree 标记(.git)即停,结果按外层优先排序。 */
function getProjectConfigDirectories(dir) {
  const out = [];
  let current = dir;
  for (;;) {
    out.push(current);
    if (hasWorktreeMarker(current)) return out.reverse();
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [dir];
}

function discoverZCodeProjectConfigPaths(workingDirectory) {
  const start = resolve(workingDirectory ?? process.cwd());
  return getProjectConfigDirectories(start).flatMap((dir) =>
    ZCODE_PROJECT_CONFIG_BASENAMES.map((base) => join(dir, base)).filter((path) => existsSync(path)),
  );
}

function readJsonObject(path) {
  try {
    return readObject(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function resolveOfficialCuaPluginEnablementState(options) {
  let mcpFeatureEnabled = true;
  let pluginsEnabled = true;
  let pluginEnabled = false;
  let configured = false;
  const configPaths = [
    ...(options.userConfigPath ? [options.userConfigPath] : []),
    ...discoverZCodeProjectConfigPaths(options.workingDirectory),
    ...(options.projectConfigPath ? [options.projectConfigPath] : []),
  ];
  for (const configPath of configPaths) {
    const config = readJsonObject(configPath);
    if (!config) continue;
    if (hasOwn(config, "features")) {
      const features = readObject(config.features);
      if (features) {
        if (hasOwn(features, "mcp")) mcpFeatureEnabled = features.mcp === true;
      } else {
        mcpFeatureEnabled = false;
      }
    }
    if (hasOwn(config, "plugins")) {
      const plugins = readObject(config.plugins);
      if (!plugins) {
        pluginsEnabled = false;
        pluginEnabled = false;
        configured = true;
        continue;
      }
      if (hasOwn(plugins, "enabled")) pluginsEnabled = plugins.enabled === true;
      if (hasOwn(plugins, "enabledPlugins")) {
        const enabledPlugins = readObject(plugins.enabledPlugins);
        if (enabledPlugins) {
          if (hasOwn(enabledPlugins, options.pluginId)) {
            pluginEnabled = enabledPlugins[options.pluginId] === true;
            configured = true;
          }
        } else {
          pluginEnabled = false;
          configured = true;
        }
      }
    }
  }
  return {
    configured,
    enabled: mcpFeatureEnabled && pluginsEnabled && pluginEnabled,
  };
}

/**
 * 官方 computer-use 插件在 workspace 的启用判定(与 desktop 主进程同源语义):
 * 用户级 ~/.zcode/cli/config.json + workspace 向上发现的 zcode.json/.zcode/config.json
 * 中,features.mcp 与 plugins.enabled 未被关闭,且 plugins.enabledPlugins["computer-use"]
 * 显式为 true。任何一层配置都可以收紧,只有显式 true 才放行。
 */
export function isOfficialCuaPluginEnabledForWorkspace(options = {}) {
  const home = (options.env ?? process.env).HOME?.trim() || homedir();
  return resolveOfficialCuaPluginEnablementState({
    pluginId: OFFICIAL_CUA_PLUGIN_ID,
    workingDirectory: options.workingDirectory,
    projectConfigPath: options.projectConfigPath,
    userConfigPath: options.userConfigPath ?? join(home, ".zcode", "cli", "config.json"),
  }).enabled;
}

export function createCuaProductMcpServerResolver(_host, _options) {
  return {
    async resolveMcpServers(servers, _context) {
      return servers;
    },
    async restart() {
      throw new Error(UNAVAILABLE);
    },
    async restartAfterPermissionGrant(_onboardingSessionId) {
      throw new Error(UNAVAILABLE);
    },
  };
}

export async function waitForCuaHelperStartup(startup, _deadlineMs) {
  return await startup;
}

export function isPotentialZCodeCuaAgentMcpServer(_server) {
  return false;
}

export function isScreenCaptureProbeSuccess(_probe) {
  return false;
}

export function markCuaProductHelperAgentEnvUnavailable(_host) {}

export function hasCuaProductHelperAgentEnvUnavailable(_host) {
  return false;
}

export function clearCuaProductHelperAgentEnvUnavailable(_host) {}

export async function reapOrphanedHelpers(_options) {}

export async function requestHelperAccessibilityPermissionViaLaunchServices(_options) {
  return { ok: false, reason: UNAVAILABLE };
}

export async function requestHelperScreenRecordingPermissionViaLaunchServices(_options) {
  return { ok: false, reason: UNAVAILABLE };
}
