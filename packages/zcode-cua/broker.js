import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";

export class BrokerError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use broker is unavailable.");
    this.name = "BrokerError";
    this.code = options.code ?? "unavailable";
    if (options.details !== undefined) this.details = options.details;
  }
}

export class CuaHelperError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use Helper is unavailable.");
    this.name = "CuaHelperError";
    this.code = options.code ?? "helper_unavailable";
  }
}

export function isCuaHelperError(value) {
  return value instanceof CuaHelperError;
}

const brokerErrorFactory = (code) => (message, details) =>
  new BrokerError(message ?? code, { code, details });

export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");

export async function callBrokerMethod(_args) {
  throw new BrokerError("Computer Use is not available in this build.");
}

/**
 * Health probe: connect to the helper broker on its named pipe/Unix socket,
 * authenticate (authenticate-first protocol), then read broker_info for the
 * authoritative {pid, bundleId}. The desktop host compares pid against the
 * forked child pid (isExactHealthPid) — a null pid fails the check, so this
 * must return real values from a live broker, never placeholders.
 */
export async function probeHelperHealth(socketPath, options = {}) {
  const net = await import("node:net");
  const timeoutMs = options?.timeoutMs ?? 10_000;
  return await new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding("utf8");
    let buffer = "";
    let nextId = 1;
    const settle = (value) => {
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => settle({ bundleId: null, pid: null }), timeoutMs);
    socket.on("error", () => {
      clearTimeout(timer);
      settle({ bundleId: null, pid: null });
    });
    socket.on("connect", () => {
      socket.write(JSON.stringify({ id: nextId++, method: "authenticate", params: { client_type: "zcode_cua_mcp" } }) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        if (frame?.ok && frame.id === 1) {
          // authenticated; ask for broker_info
          socket.write(JSON.stringify({ id: nextId++, method: "broker_info", params: {} }) + "\n");
          continue;
        }
        if (frame?.id === 2) {
          clearTimeout(timer);
          if (frame.ok) {
            const result = frame.result ?? {};
            settle({
              bundleId: typeof result.bundle_id === "string" ? result.bundle_id : null,
              pid: typeof result.pid === "number" && Number.isInteger(result.pid) && result.pid > 0 ? result.pid : null,
            });
          } else {
            settle({ bundleId: null, pid: null });
          }
        }
      }
    });
  });
}

export function mintBrokerSocketPath(options = {}) {
  // Windows transport is always a named pipe: the helper broker binds with
  // CreateNamedPipe semantics and rejects non-pipe listen paths (fs-node
  // assumptions are POSIX-only). Non-win32 platforms keep the Unix socket.
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\zcode-cua-broker-${randomUUID()}`;
  }
  const dir = typeof options.dir === "string" ? options.dir : tmpdir();
  return join(dir, `zcode-cua-broker-${randomUUID()}.sock`);
}

export function resolveBrokerSocketPath(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = env[BROKER_SOCKET_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv;
  return mintBrokerSocketPath(options);
}

export function parseRequestLine(_line) {
  return undefined;
}

export function okResponse(result) {
  return { ok: true, result };
}

export function errorResponse(message, options = {}) {
  return {
    ok: false,
    error: { message, ...(options.code ? { code: options.code } : {}) },
  };
}

export function errorResponseFromException(error) {
  return errorResponse(error instanceof Error ? error.message : String(error));
}

export function serializeResponse(response) {
  return `${JSON.stringify(response)}\n`;
}

export async function dispatchRequest(_backend, _request) {
  throw new CuaHelperError("Computer Use is not available in this build.");
}

export async function handleRequestLine(_backend, _line) {
  throw new CuaHelperError("Computer Use is not available in this build.");
}

export function isBrokerMethod(_method) {
  return false;
}

export function isReadOnlyBrokerMethod(_method) {
  return false;
}
