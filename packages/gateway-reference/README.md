# @ovrsr/fpp-gateway-reference

**Not a production gateway.** This package is a **feature-flagged, non-default**
in-process stub for CI demos of gateway-shaped disposition
(`tool request → enforcement-core → execute/skip`).

It is **not** an OpenClaw plugin and must not be packaged or installed as one.

```ts
import { createGatewayReferenceRouter } from "@ovrsr/fpp-gateway-reference";
import { createEnforcementRuntime } from "@ovrsr/fpp-enforcement-core";

const runtime = createEnforcementRuntime(config, adapter);
const router = createGatewayReferenceRouter({
  enabled: true, // required — default is false
  runtime,
  invoke: async (tool, params) => realInvoke(tool, params),
});

await router.route("Shell", { command: "echo hi" }, { toolCallId: "1" });
```

See RFC: `docs/rfc/0001-voluntary-constitutional-layer.md`.
