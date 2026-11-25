---
name: build-backend-feature
description: Build or extend a feature in an existing backend, from a new API endpoint or persisted operation to a job, webhook, or provider integration. Use the host's contracts and stack to design the change, implement it, prove its behavior, and prepare it for review.
---

# Build a backend feature

## Establish the behavior

Start with the observable request. Who initiates the operation, what may they act on, what changes durably, and how will the caller recognize success or failure? Trace one nearby feature from its caller through the mounted route or worker to the database and tests. Check the repository instructions, API contract, existing schema, permission policy, CI, and relevant runbook. Use the evidence to settle questions the code already answers.

Look for an existing operation, query, validator, platform facility, or installed dependency that meets the need. Extend it where its semantics fit. Choose the smallest change that preserves the contract, data integrity, and verification. A shorter diff that drops a permission check or leaves a replay unsafe is unfinished.

For a consequential gap, use **AskUser**, one question at a time. Explain what the code establishes, offer a recommendation and its tradeoff, and wait before implementing the dependent behavior. If the client lacks a question picker, ask the same single question in chat. For example:

- Every neighboring endpoint and the client type agree on cursor pagination. Reuse the cursor and ordering directly.
- The route requires login, but existing policy only covers staff cancellation. Before adding customer cancellation, ask “May a customer cancel only shipments they own before dispatch? I recommend that limit because dispatch starts carrier work.” Use the answer to define both the allowed and denied cases.

## Implement four responsibilities

| Responsibility | Decision it owns |
| --- | --- |
| Routing or dispatch | Register the public route, event subscription, or job at the real entry point. Attach the host's authentication and fixed permission checks where applicable. |
| Controller or handler | Validate the wire input, derive actor identity from trusted context, call the operation, and map its result and typed errors to the host's contract. For events, this includes acknowledgement or retry semantics. |
| Service | Enforce resource ownership, transitions, and business invariants. Coordinate repositories and providers, and choose the transaction boundary. |
| Repository | Own storage queries, constraints, locks, and durable writes. Use the same transaction for decisions and writes that must succeed together. |

Keep these responsibilities distinct in the host's native layout. They can share a module or reuse existing components. Preserve versioning, field casing, missing versus null or false, status codes, and pagination that callers rely on. Update existing schemas, generated contracts, or client fixtures through their normal workflow when the public contract changes.

For an implementation walkthrough covering a new persisted feature and an existing mutation, read [the TypeScript API examples](references/nir-api.md). For a Go implementation of the same boundaries and a carrier callback, read [the shipping examples](references/go-shipping.md). Each reference identifies its source checkout. Use the comparable implementation in the actual target repository.

## Check the failure that matters

- **Writes.** State what must remain true under retries or simultaneous requests. Pick an existing uniqueness constraint, conditional update, lock, or idempotency mechanism that enforces it. Keep external effects outside replayable database transactions. Where commit or provider acceptance is uncertain, reconcile the original operation before issuing another one.
- **Async work.** Establish acknowledgement, retry ownership, and how abandoned work becomes recoverable. A retry should resume from durable state. Verify the boundary between applying the effect and recording completion. See the [duplicate webhook and lost reply walkthroughs](references/go-shipping.md).
- **Schema changes.** Make mixed-version reads and writes work across rollout. Rehearse the upgrade on representative existing rows, including a rerun after partial progress. Remove an old representation after older readers and writers have retired. See the [two-version migration exercise](references/nir-api.md).
- **Operations.** Trace new configuration through the host's loader and deployment settings. Identify a feature-specific failure signal, a safe correlation identifier, and a recovery action. For a provider timeout, show how to locate the pending operation and distinguish confirmed rejection from acceptance with a lost reply. Keep tokens and sensitive payloads out of diagnostics.

## Prove and deliver the change

For a new persisted endpoint, run a request through the mounted route against a disposable database. Assert the response status and serialized fields, then independently read the persisted effect. Exercise the relevant denial or rollback path and check the database afterward. Isolated service tests help pinpoint a defect. The mounted test also catches missing registrations, middleware, serialization, and transaction wiring. Exercise relevant races or replay paths with overlapping operations or injected failure.

Run the host's required checks. Compare the diff against the requested behavior and review it for compatibility and unintended changes. For an authorized PR, publish the branch, open the review with the behavior and test evidence, and follow required CI to green. Include migration order, a feature health signal, recovery steps, and any unverified coverage where relevant. If checks are blocked, report the failing check and its effect on readiness. Handoff is a PR ready for human review. Merging or promoting a release requires its own authorization.
