/**
 * Broker NDJSON client for the ZCode Computer Use permission broker.
 *
 * Wire contract (verified against @zcode/zcode-cua-helper-runtime 0.6.3):
 *   request  line: {"id":<n>, "method":<string>, "params":<object>}
 *   response line: {"id":<n>, "ok":true, "result":<any>} |
 *                  {"id":<n>, "ok":false, "error":{"code","message","details?"}}
 *   first request on a connection must be `authenticate`; `ping` negotiates
 *   clientApiVersion (server replies {serverApiVersion}).
 *   IPC version: 2. Line limit 16 MiB, request timeout 15 s server-side.
 */
import { createConnection } from "node:net";

export const CUA_BROKER_IPC_VERSION = 2;
const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const PING_TIMEOUT_MS = 15_000;
const AUTH_TIMEOUT_MS = 15_000;

export class BrokerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "BrokerError";
    this.code = code;
    this.details = details ?? {};
  }
}

function isNamedPipe(path) {
  return process.platform === "win32" && path.startsWith("\\\\.\\pipe\\");
}

/**
 * One long-lived broker connection. Reconnects transparently per request when
 * the pipe drops (helper restart), re-running authenticate on the fresh pipe.
 */
export class BrokerClient {
  #socketPath;
  #identity;
  #socket = null;
  #nextId = 1;
  #pending = new Map();
  #buffer = "";
  #connectPromise = null;

  constructor(options) {
    this.#socketPath = options.socketPath;
    this.#identity = options.identity ?? {};
  }

  get socketPath() {
    return this.#socketPath;
  }

  #ensureConnected() {
    if (this.#socket) return Promise.resolve(this.#socket);
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = this.#connect().finally(() => {
      this.#connectPromise = null;
    });
    return this.#connectPromise;
  }

  #connect() {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.#socketPath);
      socket.setEncoding("utf8");
      socket.setNoDelay(true);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`CUA broker connect timed out: ${this.#socketPath}`));
      }, CONNECT_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        this.#socket = socket;
        this.#buffer = "";
        socket.on("data", (chunk) => this.#onData(chunk));
        socket.on("error", () => this.#dropSocket());
        socket.on("close", () => this.#dropSocket());
        resolve(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  #dropSocket() {
    const socket = this.#socket;
    this.#socket = null;
    this.#buffer = "";
    if (socket) socket.destroy();
    for (const [, waiter] of this.#pending) waiter.reject(new BrokerError("connection_closed", "CUA broker connection closed"));
    this.#pending.clear();
  }

  #onData(chunk) {
    this.#buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = frame && frame.id != null ? this.#pending.get(frame.id) : undefined;
      if (!waiter) continue;
      this.#pending.delete(frame.id);
      if (frame.ok) waiter.resolve(frame.result ?? null);
      else {
        const error = frame.error ?? {};
        waiter.reject(new BrokerError(error.code ?? "internal", error.message ?? "broker error", error.details));
      }
    }
  }

  #send(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new BrokerError("timeout", `CUA broker request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.#socket.write(JSON.stringify({ id, method, params }) + "\n");
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async call(method, params = {}, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    await this.#ensureConnected();
    // Authenticate is idempotent on a fresh connection; the broker allows
    // re-authenticate on the same connection too (marks it authenticated).
    try {
      await this.#send("authenticate", this.#identity, AUTH_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof BrokerError && error.code === "method_not_found") {
        // Broker without authenticate gate (older ABI) — proceed.
      } else {
        throw error;
      }
    }
    return await this.#send(method, params, timeoutMs);
  }

  async ping() {
    const result = await this.call("ping", { clientApiVersion: CUA_BROKER_IPC_VERSION }, { timeoutMs: PING_TIMEOUT_MS });
    return result?.serverApiVersion ?? null;
  }

  close() {
    this.#dropSocket();
  }
}

export function isNamedPipePath(path) {
  return isNamedPipe(path);
}
