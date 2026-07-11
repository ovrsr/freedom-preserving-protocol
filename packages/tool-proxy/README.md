# @ovrsr/fpp-tool-proxy

Shared reference implementation for harnesses that need an MCP/sidecar
interception path (in addition to, or instead of, native PreToolUse hooks).

```ts
import { createToolProxy } from "@ovrsr/fpp-tool-proxy";
import { createEnforcementRuntime } from "@ovrsr/fpp-enforcement-core";

const runtime = createEnforcementRuntime(config, adapter);
const proxy = createToolProxy(runtime, async (tool, params) => realInvoke(tool, params));

await proxy.call("Bash", { command: "echo hi" }, { toolCallId: "1" });
// ToolProxyDeniedError if disposition is deny/abstain
```

Cursor / Claude Code / Codex adapters prefer native hooks; import this proxy
when wiring an MCP tool gateway or custom sidecar.
