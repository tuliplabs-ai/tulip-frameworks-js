// Copyright 2026 Tulip Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * tulip-frameworks-js — gate a TypeScript/JS agent's actions through Tulip's
 * control gate: the SAME policy + hash-chained audit chain as Python agents,
 * via the gateway `POST /v1/admit` RPC. No policy logic lives here — the
 * decision stays server-side; this client only marshals an Action, calls the
 * gateway, and runs the side effect locally on ALLOW.
 *
 * This is the SDK's `admit()`, split across the wire (see DESIGN-admit-rpc.md).
 */

export type Outcome = "allow" | "require_human" | "deny";

/** The proposed action — field names mirror `tulip.control.Action`. */
export interface Action {
  name: string;
  asset?: string;
  blastRadius?: number;
  environment?: string;
  kind?: string;
  tags?: string[];
}

export interface GateOptions {
  /** Gateway base URL. Default `http://127.0.0.1:8420`. */
  gatewayUrl?: string;
  /** Names a server-side policy. Default `"default"`. */
  policyRef?: string;
  /** Who is acting — per-principal rules + audit. Default `"agent"`. */
  principal?: string;
  /** Optional; dedupe identical proposals (e.g. OpenClaw's idempotencyKey). */
  idempotencyKey?: string;
  /** Inject a fetch implementation (for tests). Default global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface AdmitOptions extends GateOptions {
  /** Poll interval while a held action awaits a human. Default 1000ms. */
  pollIntervalMs?: number;
  /** Give up waiting for a human after this long. Default 300000ms. */
  timeoutMs?: number;
}

/** The gateway's decision — `admit()`'s answer. */
export interface Decision {
  outcome: Outcome;
  allowed: boolean;
  reason: string;
  checks: string[];
  approvalId: string | null;
  auditId: string;
}

/** Thrown when an action is denied or a held action is denied/times out. */
export class AdmissionError extends Error {
  readonly decision: Decision;
  constructor(decision: Decision) {
    super(`action ${decision.outcome}: ${decision.reason}`);
    this.name = "AdmissionError";
    this.decision = decision;
  }
}

const DEFAULT_GATEWAY = "http://127.0.0.1:8420";

function gatewayUrl(opts: GateOptions): string {
  return opts.gatewayUrl ?? DEFAULT_GATEWAY;
}

function http(opts: GateOptions): typeof fetch {
  return opts.fetchImpl ?? fetch;
}

/** One round-trip: POST the action, return the raw decision (no polling). */
export async function requestDecision(action: Action, opts: GateOptions = {}): Promise<Decision> {
  const res = await http(opts)(`${gatewayUrl(opts)}/v1/admit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      principal: opts.principal ?? "agent",
      policy_ref: opts.policyRef ?? "default",
      idempotency_key: opts.idempotencyKey ?? null,
      action: {
        name: action.name,
        asset: action.asset ?? "",
        blast_radius: action.blastRadius ?? 1,
        environment: action.environment ?? "unknown",
        kind: action.kind ?? "",
        tags: action.tags ?? [],
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`POST /v1/admit failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  return {
    outcome: body.outcome as Outcome,
    allowed: Boolean(body.allowed),
    reason: String(body.reason ?? ""),
    checks: (body.checks as string[] | undefined) ?? [],
    approvalId: (body.approval_id as string | null | undefined) ?? null,
    auditId: String(body.audit_id ?? ""),
  };
}

/**
 * The full gate, blocking — this IS `admit()` across the wire. ALLOW returns;
 * REQUIRE_HUMAN polls until a human approves (then consumes, single-use) or
 * denies/times out (throws); DENY throws. Use for deterministic pipelines.
 */
export async function admit(action: Action, opts: AdmitOptions = {}): Promise<Decision> {
  const decision = await requestDecision(action, opts);
  if (decision.outcome === "allow") return decision;
  if (decision.outcome === "deny" || decision.approvalId === null) {
    throw new AdmissionError(decision);
  }

  const base = gatewayUrl(opts);
  const f = http(opts);
  const id = decision.approvalId;
  const interval = opts.pollIntervalMs ?? 1000;
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);

  while (Date.now() <= deadline) {
    const state = (await (await f(`${base}/v1/admit/approval/${id}`)).json()) as Record<
      string,
      unknown
    >;
    if (state.state === "approved") {
      await f(`${base}/v1/admit/approval/${id}/consume`, { method: "POST" });
      return {
        ...decision,
        outcome: "allow",
        allowed: true,
        reason: `approved by ${state.decided_by || "human"}`,
      };
    }
    if (state.state === "denied") {
      throw new AdmissionError({ ...decision, reason: `denied by ${state.decided_by || "human"}` });
    }
    await sleep(interval);
  }
  throw new AdmissionError({ ...decision, reason: "approval timed out" });
}

/** A held/denied result returned by `gateTool` in soft mode (no blocking). */
export interface HeldResult {
  status: "held_for_approval" | "denied";
  outcome: Outcome;
  reason: string;
  approvalId: string | null;
}

type ToolFn<A, R> = (args: A) => Promise<R> | R;

/**
 * Wrap a tool so its action clears the gate first — soft mode (no blocking):
 * ALLOW runs the tool; REQUIRE_HUMAN / DENY return a held/denied result the
 * agent loop can read and react to. Mirrors the Python `gate_*_tool` soft mode.
 */
export function gateTool<A, R>(
  fn: ToolFn<A, R>,
  toAction: (args: A) => Action,
  opts: GateOptions = {},
): (args: A) => Promise<R | HeldResult> {
  return async (args: A): Promise<R | HeldResult> => {
    const decision = await requestDecision(toAction(args), opts);
    if (decision.allowed) {
      return await fn(args);
    }
    return {
      status: decision.outcome === "deny" ? "denied" : "held_for_approval",
      outcome: decision.outcome,
      reason: decision.reason,
      approvalId: decision.approvalId,
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
