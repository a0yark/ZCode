# @zcode/zcode-cua

Computer Use runtime package for Windows.

## Layout

- `dist/windows-helper.js` — Helper broker bundle (NDJSON named-pipe server;
  spawns, binds `--socket <pipe> --parent-pid <pid>`, reports control frames
  `transport_ready`/`ready` over fork IPC or stdout JSON lines).
- `build/Release/ax_native.node` — Windows x64 native addon (UI Automation,
  WGC/DXGI capture, global input, clipboard). Self-contained N-API module;
  loads under plain Node (no Electron requirement).
- `runtime.js` — `createComputerUseRuntime()`: the producer runtime that
  implements the 14 public Computer Use tools
  (`list_apps`, `list_windows`, `get_app_state`, `left_click`, `scroll`,
  `left_click_drag`, `type`, `set_value`, `select_text`, `key`,
  `perform_action`, `paste`, `request_access`, `stop_computer_control`)
  on top of the broker protocol.
- `broker-client.js` — broker NDJSON client (authenticate-first, IPC
  version 2, per-request timeout, transparent reconnect).

## Runtime contract

```js
import { createComputerUseRuntime } from "@zcode/zcode-cua";

const runtime = createComputerUseRuntime({
  brokerSocketPath: "\\\\.\\pipe\\zcode-cua-...", // or env ZCODE_CUA_PERMISSION_BROKER_SOCKET
});
const result = await runtime.execute({
  toolName: "get_app_state",
  arguments: { app_ref: { pid: 1234 }, include_screenshot: true },
  context: { sessionId: "s1", runtimeScope: "main", workspaceKey: "ws" },
});
await runtime.closeSession(context);
await runtime.dispose();
```

## Windows helper bootstrap (dev)

The repo's service layer (`resolveWindowsCuaRuntime`) resolves this package
via the `zcodeCuaRuntime` contract in `package.json` when
`ZCODE_CUA_DEV_ROOT` points at this directory; packaged builds resolve
`resources/tools/cua-helper` + `runtime-manifest.json` instead.

Helper spawn:

```
node dist/windows-helper.js --socket \\.\pipe\<name> --parent-pid <pid>
# env: ZCODE_CUA_HELPER_ADDON=<abs path to build/Release/ax_native.node>
```

## Broker protocol summary

- request: `{"id":<n>,"method":"<name>","params":{}}` (one JSON per line)
- response: `{"id":<n>,"ok":true,"result":...}` or `{"id":<n>,"ok":false,"error":{"code","message","details?"}}`
- first call on a connection: `authenticate` (params: `client_type`,
  `workspace_key`, `session_id`, `thread_id`); `ping` carries
  `clientApiVersion` (server: 2).
- 43 broker methods; element actions address elements by the `native` token
  issued in the latest `capture_app` observation of that app.

License: Apache-2.0.
