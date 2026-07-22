# Contributing to tulip-frameworks-js

Thanks for helping bring more languages to the gate. The bar matches the rest
of Tulip: typed, linted, and tested — `pnpm run check` must be clean before a PR.

## Development setup

```bash
git clone https://github.com/tuliplabs-ai/tulip-frameworks-js.git
cd tulip-frameworks-js
pnpm install
pnpm run check    # lint + typecheck + build + tests with coverage
```

Useful scripts:

```bash
pnpm run test         # vitest
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # oxlint
pnpm run format       # oxfmt
```

## Design rules

- **No policy logic in this client.** Decisions come from the Tulip gateway's
  `POST /v1/admit`; this package stays a thin, typed transport.
- Keep the public surface small and mirrored on the Python `admit()` semantics
  (allowed / held for a human / denied).
- Tests run offline — mock the gateway; no network in CI.

## Pull requests

- Conventional Commit titles (`feat:`, `fix:`, `docs:` …).
- CI must be green.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for coordinated disclosure.
