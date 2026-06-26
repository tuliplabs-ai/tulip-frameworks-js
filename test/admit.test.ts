// Copyright 2026 Tulip Labs
// SPDX-License-Identifier: Apache-2.0
//
// Offline unit tests — a fake fetch stands in for the gateway, so no network and
// no running server. Helpers live at module scope so test bodies stay branch-free.

import { expect, test } from "vitest";

import { admit, AdmissionError, gateTool, requestDecision } from "../src/index.js";

interface Routed {
  status?: number;
  json: unknown;
}
type Router = (url: string, init: RequestInit) => Routed;

function mockFetch(router: Router): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const r = router(String(url), init ?? {});
    const status = r.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  }) as unknown as typeof fetch;
}

const ALLOW = {
  outcome: "allow",
  allowed: true,
  reason: "ok",
  checks: [],
  approval_id: null,
  audit_id: "a1",
};
const DENY = {
  outcome: "deny",
  allowed: false,
  reason: "denied",
  checks: ["x"],
  approval_id: null,
  audit_id: "a2",
};
const HOLD = {
  outcome: "require_human",
  allowed: false,
  reason: "labels ['production'] require human approval",
  checks: [],
  approval_id: "ap1",
  audit_id: "a3",
};

const isAdmitPost = (url: string, init: RequestInit): boolean =>
  url.endsWith("/v1/admit") && init.method === "POST";

/** A stateful router that holds, then approves after `threshold` polls. */
function approveAfter(threshold: number): { router: Router; consumed: () => boolean } {
  let polls = 0;
  let consumed = false;
  const router: Router = (url, init) => {
    if (isAdmitPost(url, init)) {
      return { json: HOLD };
    }
    if (url.endsWith("/consume")) {
      consumed = true;
      return { json: { state: "consumed" } };
    }
    polls += 1;
    return { json: { state: polls >= threshold ? "approved" : "pending", decided_by: "ciso" } };
  };
  return { router, consumed: () => consumed };
}

const denyAfterHold: Router = (url, init) =>
  isAdmitPost(url, init) ? { json: HOLD } : { json: { state: "denied", decided_by: "ciso" } };

test("requestDecision marshals the action and returns the decision", async () => {
  let sent: any;
  const fetchImpl = mockFetch((_url, init) => {
    sent = JSON.parse(String(init.body));
    return { json: ALLOW };
  });
  const d = await requestDecision(
    { name: "fs_write", environment: "dev", tags: ["t"] },
    { fetchImpl },
  );
  expect(d.outcome).toBe("allow");
  expect(d.allowed).toBe(true);
  expect(sent.action.name).toBe("fs_write");
  expect(sent.action.blast_radius).toBe(1);
  expect(sent.action.environment).toBe("dev");
  expect(sent.action.tags).toStrictEqual(["t"]);
  expect(sent.policy_ref).toBe("default");
});

test("admit throws AdmissionError on deny", async () => {
  const fetchImpl = mockFetch(() => ({ json: DENY }));
  await expect(admit({ name: "exec" }, { fetchImpl })).rejects.toThrow(AdmissionError);
});

test("admit polls require_human, approves, then consumes once", async () => {
  const { router, consumed } = approveAfter(2);
  const d = await admit(
    { name: "exec", environment: "production" },
    { fetchImpl: mockFetch(router), pollIntervalMs: 1 },
  );
  expect(d.allowed).toBe(true);
  expect(consumed()).toBe(true);
});

test("admit throws when a held action is denied by a human", async () => {
  const fetchImpl = mockFetch(denyAfterHold);
  await expect(
    admit({ name: "exec", environment: "production" }, { fetchImpl, pollIntervalMs: 1 }),
  ).rejects.toThrow(AdmissionError);
});

test("gateTool soft: ALLOW runs the tool", async () => {
  const fetchImpl = mockFetch(() => ({ json: ALLOW }));
  const ran: Array<{ id: string }> = [];
  const gated = gateTool(
    (a: { id: string }) => {
      ran.push(a);
      return `did:${a.id}`;
    },
    (a) => ({ name: "act", asset: a.id }),
    { fetchImpl },
  );
  expect(await gated({ id: "x" })).toBe("did:x");
  expect(ran).toStrictEqual([{ id: "x" }]);
});

test("gateTool soft: REQUIRE_HUMAN returns a held result and the tool never runs", async () => {
  const fetchImpl = mockFetch(() => ({ json: HOLD }));
  const ran: Array<{ id: string }> = [];
  const gated = gateTool(
    (a: { id: string }) => {
      ran.push(a);
      return "ran";
    },
    () => ({ name: "act", environment: "production" }),
    { fetchImpl },
  );
  const res = await gated({ id: "y" });
  expect(res).toStrictEqual({
    status: "held_for_approval",
    outcome: "require_human",
    reason: "labels ['production'] require human approval",
    approvalId: "ap1",
  });
  expect(ran).toStrictEqual([]);
});
