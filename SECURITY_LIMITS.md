# Jev API abuse controls

## Limits

- `JEV_GLOBAL_DAILY_LIMIT`: **100** questions globally per UTC day, with 10/minute globally. The demo remains anonymous, so rotating client-supplied identifiers cannot reset the shared budget.

A private mutation reserves the budget before requesting a service token or calling AI Gateway. Empty questions and inputs over 500 characters are rejected before reservation. The gateway call has a 20-second timeout. The Decisions request retains its fixed 20-answer choice set; responses are limited to 64 KiB, probabilities are restricted to known choices and finite numbers between zero and one, and model metadata is bounded. Provider error bodies are neither returned nor stored. Real question records remain separate from operational quota counters.

## Reservation behavior and schema

The additive `abuseLimits` table has `key: string`, `windowStart: number`, and `used: number`, indexed by `by_key`. Each scope reuses its counter row. No existing business records, API keys, or data need migration or deletion.

All applicable counters are checked and incremented in one mutation before paid work or its scheduler entry. Conflicting requests rely on [Convex atomic transactions and OCC](https://docs.convex.dev/database/advanced/occ). Failed provider attempts still consume reservations; there are no refunds that could permit retry abuse. Daily windows reset at midnight UTC, with fixed minute/hour windows where listed. These limits count requests, rather than estimating a dollar balance.

The new environment variables are optional numeric daily ceilings. Unset, empty, negative, fractional, or malformed values use the documented default; integers above 100000 also use the default. An explicit `0` stops that operation. There is no bypass flag. Per-user limits use the authenticated server identity. Anonymous demos retain shared global limits.

## Review and setup

Changes are local and uncommitted. No deploy, merge, push, credential rotation, or real provider/deployment test was run. Root should review the diff, deploy the additive schema with the functions through the normal project workflow, and smoke-test the normal flow. Existing provider credentials remain required and unchanged. Defaults apply without adding any environment variables.


## Validation

Run `bun --no-env-file test tests/security.test.ts`. These tests invoke registered Convex handlers against a test database with mocked providers; they do not contact a deployment.

Run `./node_modules/.bin/tsc -p convex --noEmit --pretty false` for backend types. Run `./node_modules/.bin/tsc --noEmit --pretty false` for app types.

Expected test count after this change: 4.

## Files changed

- `SECURITY_LIMITS.md`
- `convex/_generated/api.d.ts`
- `convex/abuse.ts`
- `convex/jev.ts`
- `convex/schema.ts`
- `tests/security.test.ts`
- `tests/support.ts`
