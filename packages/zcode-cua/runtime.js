/**
 * Computer Use producer runtime.
 *
 * Implements the 14 public Computer Use tools on top of the helper broker
 * (NDJSON named pipe). Behavior contract follows the official producer:
 *   - session key = workspaceKey + remoteSessionId + sessionId; per session
 *     element token registry; "observe once, act on index" loop.
 *   - element targets address the latest observation of that app by integer
 *     index; coordinate targets are integers inside the latest raster.
 *   - errors are fail-closed: action_sent=false when nothing was dispatched.
 *
 * Tool -> broker mapping (verified against helper 0.6.3):
 *   list_apps           -> list_applications
 *   list_windows        -> list_windows {app_ref}
 *   get_app_state       -> capture_app {app_ref, include_screenshot}
 *   left_click          -> element_perform_action {native, action:"AXPress"}
 *                           | click {point, button, clicks, modifiers}
 *   left_click_drag     -> drag {start, end, modifiers}
 *   scroll              -> scroll {point, direction, amount}
 *   type                -> type_text_to_app | type_text / element_set_value
 *   set_value           -> element_set_value {native, value}
 *   select_text         -> element_select_text {native, text_range?}
 *   key                 -> press_key_to_app | press_key {text, modifiers}
 *                           (hold_seconds -> hold_key)
 *   perform_action      -> element_perform_action {native, action}
 *   paste               -> paste {text, format, app_ref}
 *   request_access      -> request_access
 *   stop_computer_control -> controller_takeover + controller_stop
 */
import { BrokerClient } from "./broker-client.js";

const TOOL_NAMES = Object.freeze([
  "list_apps",
  "list_windows",
  "get_app_state",
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
  "request_access",
  "stop_computer_control",
]);

const READ_ONLY_TOOLS = new Set(["list_apps", "list_windows", "get_app_state", "request_access"]);
const MAX_SESSION_COUNT = 128;
const CAPTURE_APP_TIMEOUT_MS = 30_000;

function sessionKeyFor(context) {
  const workspaceKey =
    context.workspaceKey?.trim() ||
    context.workspaceIdentity?.trim() ||
    context.workspacePath?.trim() ||
    "__unknown_workspace__";
  return [workspaceKey, context.remoteSessionId?.trim() || "__local__", context.sessionId.trim()].join("\0");
}

function toolResult(text, structured) {
  const result = { content: [{ type: "text", text }] };
  if (structured !== undefined) result.structuredContent = structured;
  return result;
}

function toolError(text, details) {
  const result = { isError: true, content: [{ type: "text", text }] };
  if (details !== undefined) result.structuredContent = details;
  return result;
}

/** Per-session state: the latest element tokens per app (by pid). */
class SessionElements {
  #byApp = new Map(); // pidKey -> { native, role, bounds, title }[]
  #lastPid = null;
  register(pid, elements) {
    const key = String(pid);
    this.#byApp.set(key, elements);
    this.#lastPid = key;
  }
  resolve(pid, index) {
    const list = this.#byApp.get(String(pid));
    if (!list) return null;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
    return list[index];
  }
  lastFor(pid) {
    return this.#byApp.get(String(pid)) ?? null;
  }
  get lastPid() {
    return this.#lastPid;
  }
  dispose() {
    this.#byApp.clear();
    this.#lastPid = null;
  }
}

function parseTarget(rawTarget) {
  if (!rawTarget || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    throw new Error('target must be {"type":"element","index":N} or {"type":"coordinate","x":N,"y":N}');
  }
  const type = rawTarget.type;
  if (type === "element") {
    const index = rawTarget.index;
    if (!Number.isInteger(index) || index < 0) throw new Error("element target index must be a non-negative integer");
    return { type, index };
  }
  if (type === "coordinate") {
    const { x, y } = rawTarget;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error("coordinate target x/y must be integer pixels in the latest raster");
    }
    return { type, x, y };
  }
  throw new Error(`unknown target type: ${String(type)}`);
}

function appRefKey(appRef, session) {
  if (!appRef || typeof appRef !== "object") {
    const lastPid = session?.elements?.lastPid;
    return lastPid ?? "focused";
  }
  if (typeof appRef.pid === "number" && appRef.pid > 0) return String(appRef.pid);
  if (typeof appRef.bundle_id === "string" && appRef.bundle_id.trim()) return `b:${appRef.bundle_id.trim()}`;
  if (typeof appRef.name === "string" && appRef.name.trim()) return `n:${appRef.name.trim()}`;
  const lastPid = session?.elements?.lastPid;
  return lastPid ?? "focused";
}

function normalizeModifiers(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

export function createComputerUseRuntime(options = {}) {
  const env = options.env ?? process.env;
  const socketPath = options.brokerSocketPath ?? env.ZCODE_CUA_PERMISSION_BROKER_SOCKET?.trim();
  if (!socketPath) {
    throw new Error("Computer Use runtime requires a broker socket path (brokerSocketPath option or ZCODE_CUA_PERMISSION_BROKER_SOCKET).");
  }
  const broker = new BrokerClient({
    socketPath,
    identity: {
      client_type: "zcode_cua_mcp",
      ...(env.ZCODE_CUA_WORKSPACE_KEY ? { workspace_key: env.ZCODE_CUA_WORKSPACE_KEY } : {}),
      ...(env.ZCODE_CUA_SESSION_ID ? { session_id: env.ZCODE_CUA_SESSION_ID } : {}),
    },
  });
  const ensureBrokerAvailable = options.ensureBrokerAvailable;

  const sessions = new Map();

  function sessionFor(context) {
    const key = sessionKeyFor(context);
    let session = sessions.get(key);
    if (!session) {
      if (sessions.size >= MAX_SESSION_COUNT) {
        const oldest = sessions.keys().next().value;
        const evicted = sessions.get(oldest);
        sessions.delete(oldest);
        evicted?.elements.dispose();
      }
      session = { elements: new SessionElements() };
      sessions.set(key, session);
    }
    return session;
  }

  async function ensureBroker() {
    if (ensureBrokerAvailable) await ensureBrokerAvailable();
  }

  async function callBroker(method, params, options2) {
    await ensureBroker();
    return await broker.call(method, params, options2);
  }

  /** Resolve an element target to a native token + owner pid. */
  async function resolveElementTarget(session, input, method) {
    const target = parseTarget(input.target);
    if (target.type !== "element") throw new Error(`${method}: element target required`);
    const pidKey = appRefKey(input.app_ref, session);
    const element = session.elements.resolve(pidKey, target.index);
    if (!element) {
      throw new Error(
        `${method}: element index ${target.index} is not registered for this app; call get_app_state first and re-pick the index from that fresh observation.`,
      );
    }
    return element;
  }

  /** Resolve any target (element or coordinate) to broker action params. */
  async function resolveActionTarget(session, input, method) {
    const target = parseTarget(input.target ?? input.from_target);
    if (target.type === "element") {
      const pidKey = appRefKey(input.app_ref, session);
      const element = session.elements.resolve(pidKey, target.index);
      if (!element) {
        throw new Error(
          `${method}: element index ${target.index} is not registered for this app; call get_app_state first and re-pick the index from that fresh observation.`,
        );
      }
      return { kind: "element", element };
    }
    return { kind: "coordinate", x: target.x, y: target.y };
  }

  async function observeApp(session, input) {
    const params = { app_ref: input.app_ref ?? {} };
    if (input.include_screenshot !== undefined) params.include_screenshot = input.include_screenshot;
    if (input.disable_diffing === true) params.force_full = true;
    const result = await callBroker("capture_app", params, { timeoutMs: CAPTURE_APP_TIMEOUT_MS });
    if (!result || typeof result !== "object") throw new Error("capture_app returned no app state; call get_app_state again.");
    const elements = result.elements;
    if (!Array.isArray(elements) || !result.app || !result.window) {
      throw new Error("capture_app returned no structured element tree; call get_app_state again.");
    }
    const pid = result.app.pid;
    session.elements.register(pid, elements);
    return result;
  }

  function appStateText(result) {
    const lines = [];
    const { app, window, elements } = result;
    lines.push(`app: ${app.name ?? ""} (pid ${app.pid})`);
    if (window) lines.push(`window: ${window.title ?? ""} [${(window.bounds ?? []).join(",")}]`);
    lines.push(`elements: ${elements.length}`);
    return lines.join("\n");
  }

  const handlers = new Map();

  handlers.set("list_apps", async (input) => {
    const apps = await callBroker("list_applications", {});
    const list = Array.isArray(apps) ? apps : [];
    const lines = list.map((a, i) => `${i}: ${a.name ?? ""} pid=${a.pid} active=${!!a.active} bundle_id=${a.bundle_id ?? ""}`);
    return toolResult(`list_apps: ${list.length} applications\n${lines.join("\n")}`, { apps: list });
  });

  handlers.set("list_windows", async (input) => {
    const windows = await callBroker("list_windows", { app_ref: input.app_ref ?? {} });
    const list = Array.isArray(windows) ? windows : [];
    const lines = list.map((w, i) => `${i}: ${w.title ?? ""} window_id=${w.window_id} focused=${!!w.focused}`);
    return toolResult(`list_windows: ${list.length} windows\n${lines.join("\n")}`, { windows: list });
  });

  handlers.set("get_app_state", async (input) => {
    const session = sessionFor(input.context);
    const result = await observeApp(session, input);
    const screenshot = result.window?.screenshot ?? result.screenshot ?? null;
    const content = [{ type: "text", text: appStateText(result) }];
    if (screenshot) {
      // Screenshot bytes flow as an image block, mirroring the official
      // producer's media attachment (base64 PNG in structured content).
      content.push({ type: "image", data: screenshot, mimeType: "image/png" });
    }
    return {
      content,
      structuredContent: {
        app: result.app,
        window: result.window,
        elements: result.elements,
        ...(screenshot ? { screenshot } : {}),
      },
    };
  });

  handlers.set("left_click", async (input) => {
    const session = sessionFor(input.context);
    const resolved = await resolveActionTarget(session, input, "left_click");
    const button = input.mouse_button ?? "left";
    const clicks = input.click_count ?? 1;
    const modifiers = normalizeModifiers(input.modifiers);
    if (resolved.kind === "element") {
      const { element } = resolved;
      const pressable = (element.actions ?? []).includes("AXPress");
      if (pressable) {
        const result = await callBroker("element_perform_action", {
          native: element.native,
          action: "AXPress",
        });
        return toolResult(`AXPress dispatched on element index (semantic a11y press).`);
      }
      // Fall back to a raw click at the element center.
      const b = element.bounds;
      if (!Array.isArray(b) || b.length !== 4) throw new Error("left_click: element has no usable bounds for a raw click; action_sent=false.");
      const result = await callBroker("click", {
        point: { x: Math.floor(b[0] + b[2] / 2), y: Math.floor(b[1] + b[3] / 2) },
        button,
        clicks,
        ...(modifiers ? { modifiers } : {}),
        strategy: input.strategy === "event" ? "event" : "auto",
      });
      return toolResult("Raw click dispatched at element center.");
    }
    const result = await callBroker("click", {
      point: { x: resolved.x, y: resolved.y },
      button,
      clicks,
      ...(modifiers ? { modifiers } : {}),
      strategy: input.strategy === "event" ? "event" : "auto",
    });
    return toolResult("Click dispatched.");
  });

  handlers.set("scroll", async (input) => {
    const session = sessionFor(input.context);
    const resolved = await resolveActionTarget(session, input, "scroll");
    const point = resolved.kind === "element"
      ? (() => {
          const b = resolved.element.bounds;
          if (!Array.isArray(b) || b.length !== 4) throw new Error("scroll: element has no usable bounds; action_sent=false.");
          return { x: Math.floor(b[0] + b[2] / 2), y: Math.floor(b[1] + b[3] / 2) };
        })()
      : { x: resolved.x, y: resolved.y };
    await callBroker("scroll", {
      point,
      direction: input.scroll_direction ?? "down",
      amount: clamp(input.scroll_amount ?? 10, 0, 100),
      strategy: input.strategy === "event" ? "event" : "auto",
    });
    return toolResult("Scroll dispatched.");
  });

  handlers.set("left_click_drag", async (input) => {
    const session = sessionFor(input.context);
    const from = await resolveActionTarget(session, { ...input, target: input.from_target }, "left_click_drag");
    const to = await resolveActionTarget(session, { ...input, target: input.to }, "left_click_drag");
    const toPoint = (r) => {
      if (r.kind === "coordinate") return { x: r.x, y: r.y };
      const b = r.element.bounds;
      if (!Array.isArray(b) || b.length !== 4) throw new Error("left_click_drag: element has no usable bounds; action_sent=false.");
      return { x: Math.floor(b[0] + b[2] / 2), y: Math.floor(b[1] + b[3] / 2) };
    };
    const start = toPoint(from);
    const end = toPoint(to);
    const modifiers = normalizeModifiers(input.modifiers);
    await callBroker("drag", { start, end, ...(modifiers ? { modifiers } : {}) });
    return toolResult("Drag dispatched.");
  });

  handlers.set("type", async (input) => {
    const session = sessionFor(input.context);
    const text = typeof input.text === "string" ? input.text : "";
    if (!text) return toolResult("type: empty text; nothing sent.");
    if (input.target) {
      const resolved = await resolveActionTarget(session, input, "type");
      if (resolved.kind === "element") {
        await callBroker("element_set_value", { native: resolved.element.native, value: text });
        return toolResult("Typed via element_set_value (a11y, background-safe).");
      }
    }
    await callBroker("type_text", { text });
    return toolResult("Typed globally (verified foreground window).");
  });

  handlers.set("set_value", async (input) => {
    const session = sessionFor(input.context);
    const resolved = await resolveElementTarget(session, input, "set_value");
    const value = typeof input.value === "string" ? input.value : "";
    await callBroker("element_set_value", { native: resolved.native, value });
    return toolResult("Value set via a11y element_set_value.");
  });

  handlers.set("select_text", async (input) => {
    const session = sessionFor(input.context);
    const resolved = await resolveElementTarget(session, input, "select_text");
    const params = { native: resolved.native };
    if (input.text_range && Array.isArray(input.text_range) && input.text_range.length === 2) {
      params.text_range = input.text_range;
    }
    await callBroker("element_select_text", params);
    return toolResult("Text selection dispatched via a11y.");
  });

  handlers.set("key", async (input) => {
    const text = typeof input.text === "string" ? input.text : "";
    if (!text) throw new Error("key: text chord required; action_sent=false.");
    const holdSeconds = typeof input.hold_seconds === "number" && input.hold_seconds > 0 ? input.hold_seconds : null;
    const modifiers = normalizeModifiers(input.modifiers);
    const chord = modifiers ? `${modifiers}+${text}` : text;
    if (holdSeconds !== null) {
      await callBroker("hold_key", { text: chord, hold_seconds: holdSeconds });
      return toolResult(`Key hold dispatched (${holdSeconds}s).`);
    }
    await callBroker("press_key", { text: chord });
    return toolResult("Key press dispatched.");
  });

  handlers.set("perform_action", async (input) => {
    const session = sessionFor(input.context);
    const resolved = await resolveElementTarget(session, input, "perform_action");
    const action = typeof input.action === "string" ? input.action : "";
    if (!action) throw new Error("perform_action: action name required; action_sent=false.");
    await callBroker("element_perform_action", { native: resolved.native, action });
    return toolResult(`Action ${action} dispatched via a11y.`);
  });

  handlers.set("paste", async (input) => {
    const text = typeof input.text === "string" ? input.text : "";
    if (!text) throw new Error("paste: text required; action_sent=false.");
    const params = { text, format: input.format ?? "text" };
    if (input.app_ref) params.app_ref = input.app_ref;
    await callBroker("paste", params);
    return toolResult("Paste dispatched (clipboard saved/restored by helper).");
  });

  handlers.set("request_access", async () => {
    const result = await callBroker("request_access", {});
    return toolResult(JSON.stringify(result, null, 2), result);
  });

  handlers.set("stop_computer_control", async (input) => {
    await callBroker("controller_takeover", {});
    await callBroker("controller_stop", {});
    return toolResult("Computer control stopped (kill switch engaged).");
  });

  function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  }

  return {
    async execute(input) {
      const handler = handlers.get(input.toolName);
      if (!handler) {
        throw new Error(
          `Unknown Computer Use tool: ${input.toolName}. Known tools: ${TOOL_NAMES.join(", ")}.`,
        );
      }
      const session = sessionFor(input.context);
      try {
        return await handler({ ...input.arguments, context: input.context });
      } catch (error) {
        if (error && typeof error === "object" && error.code) {
          return toolError(`${error.message}`, {
            error_code: error.code,
            ...(error.details ?? {}),
          });
        }
        throw error;
      }
    },

    async closeSession(context) {
      const key = sessionKeyFor(context);
      const session = sessions.get(key);
      if (session) {
        sessions.delete(key);
        session.elements.dispose();
      }
    },

    async dispose() {
      for (const [, session] of sessions) session.elements.dispose();
      sessions.clear();
      broker.close();
    },
  };
}

export { TOOL_NAMES, READ_ONLY_TOOLS };
