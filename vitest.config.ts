// Copyright 2026 Tulip Labs
// SPDX-License-Identifier: Apache-2.0
//
// The ≥95% coverage gate (the tuliplabs org-wide rule). `vitest run --coverage`
// fails the build if any of lines/functions/branches/statements drops below 95.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
