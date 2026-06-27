# tulip-frameworks-js

**Gate a TypeScript/JS agent's actions through Tulip's control gate — the same
policy and tamper-evident audit chain as Python agents, over one HTTP call.**

[Tulip](https://tulipagents.ai) is **the safest way to build agentic AI** — a
full-stack agent SDK where control is native. `tulip-frameworks-js` brings **just
that control layer** to an agent you built outside Python. Tulip's control gate
(`admit()`) decides whether an agent's action runs, holds for a human, or is denied —
and records every decision. This client lets a **non-Python** agent (OpenClaw, a
Vercel AI SDK / LangChain.js tool, your own loop) reach that same gate by calling the
Tulip gateway's `POST /v1/admit` RPC. No policy logic lives in this client; the
decision stays server-side, so every agent in every language crosses **one** policy +
audit point.

This is the Python SDK's `admit()`, split across the wire — one engine, thin clients
(the Open Policy Agent model).

## Install

```bash
npm install tulip-frameworks-js
```

It talks to a running gateway:

```bash
pip install "tulip-gateway[server]"
uvicorn --factory tulip_gateway.http.admit:create_admit_app --port 8420
```

## Gate a tool — soft mode (agent-loop friendly)

```ts
import { gateTool } from "tulip-frameworks-js";

const refund = (args: { orderId: string; amount: number }) =>
  payments.refund(args.orderId, args.amount); // this moves money

const safeRefund = gateTool(
  refund,
  (args) => ({ name: "refund", asset: args.orderId, kind: "payment", environment: "production" }),
  { policyRef: "default", principal: "agent:openclaw:main" },
);

const result = await safeRefund({ orderId: "ord-9", amount: 250 });
// production → { status: "held_for_approval", reason: "…require human approval", approvalId: "…" }
// the refund never ran; a human decides out of band.
```

## Block until a human decides — deterministic flows

```ts
import { admit, AdmissionError } from "tulip-frameworks-js";

try {
  await admit(
    { name: "exec", asset: "deploy.sh", environment: "production" },
    { principal: "agent:1" },
  );
  await runIt(); // reached only on ALLOW (or once a human approves)
} catch (e) {
  if (e instanceof AdmissionError) console.log("blocked:", e.decision.reason);
}
```

`admit()` returns on **allow**; on **require_human** it polls the gateway until a
human approves (then consumes the single-use approval) or denies/times out; on
**deny** it throws.

## API

| Export                          | What it does                                                             |
| ------------------------------- | ------------------------------------------------------------------------ |
| `requestDecision(action, opts)` | One round-trip → the raw `Decision` (no polling).                        |
| `admit(action, opts)`           | The full blocking gate: poll a held action, then consume.                |
| `gateTool(fn, toAction, opts)`  | Wrap a tool; soft mode returns a held/denied result instead of blocking. |

`Action`: `{ name, asset?, blastRadius?, environment?, kind?, tags? }` — mirrors
`tulip.control.Action`. `opts`: `gatewayUrl` (default `http://127.0.0.1:8420`),
`policyRef` (default `"default"`), `principal`, `idempotencyKey`, `fetchImpl`.

## OpenClaw

OpenClaw's before-tool-call hook maps a tool call to an `Action` and calls `admit`
before the side effect runs. Its actions are then gated by the **same `policyRef`**
and land in the **same audit chain** as the Python agents — no TS reimplementation of
the gate.

## Develop

```bash
pnpm install
pnpm run check   # oxlint + tsc --noEmit + tsdown build + vitest
```

Built with the oxc toolchain (**oxlint** / **oxfmt**) + **tsdown** + **vitest**,
matching the org's TypeScript stack. Apache-2.0.
