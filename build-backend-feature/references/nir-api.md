# Implement a persisted feature in TypeScript

Paths and commands in this example are relative to a checkout of `nir-api-service`. The stack is Express, Zod, Drizzle, and PostgreSQL.

## Add staff creation of a quality-control draft

Work from the caller's goal. A staff member records observations and optional allocations, receives a draft ID and version, and can finalize that draft later. Keeping creation and finalization separate lets staff edit observations before a decision changes stock.

1. **Mount the operation.** Follow `src/app.ts` to the v1 router, then `src/routes/api/v1/index.ts` to `src/routes/api/v1/quality-control.ts`. That router requires authenticated staff. Its collection POST requires the update permission, even though a staff member with the view permission can list records.
2. **Define the HTTP boundary.** In `src/controllers/api/v1/quality-control/quality-control.ts`, the create handler parses the body with `createSchema`, gets the performer from authenticated context, and returns HTTP 201 with `{ success: true, data }`. Capture the returned ID and version in the client contract. Pass errors through the host's central middleware.
3. **Create one durable draft.** In `src/services/v1/quality-control/records.ts`, follow `createRecord`. It takes the harvest lock, resolves the draft against existing domain data, creates the record, and replaces its allocations in one transaction. The lock is specific to this workflow. When adding a different feature, identify which writer can invalidate its decision before choosing a lock. Staff activity is recorded after this transaction.
4. **Reuse the storage operation.** `src/repositories/v1/quality-control.ts` owns the record and allocation queries. Pass the service's transaction into both writes. A failed allocation write must leave no partial draft. For a similar feature, extend an existing repository method if it already supports the transaction and required fields.
5. **Prove what the caller and database see.** The integration fixture mounts the real domain router and error middleware, creates a staff session, and exercises unauthenticated, read-only, malformed, and valid requests. It creates the draft, finalizes with the returned version, and independently reads stock. Companion tests cover failed journal writes and competing stock consumption. When adding an endpoint, also read its own new rows by the ID returned to the caller and assert a denied request leaves the initial state intact. See `tests/integration/services/v1/quality-control.test.ts`.

## Change a mutation whose permission depends on its target

Trace `PATCH /v1/service-channels/:id` from `src/routes/api/v1/service-channels.ts` through `src/controllers/api/v1/service-channels/service-channels.ts` and its sibling `validation.ts`. An omitted switch preserves its value. An explicit false changes it. Keep both cases in the contract.

The route authenticates staff. In `src/services/v1/service-channels/admin.ts`, the operation loads the row and derives its required permission from the stored category. In `src/services/v1/service-channels/toggle.ts`, disabling checkout without confirmation invokes a locked check on the remaining enabled channels. `src/repositories/v1/service-channel.ts` receives the transaction for the check and update. Permission tests isolate the staff wrapper. Database tests in `tests/integration/services/service-channels/toggle.test.ts` cover the mutation separately. Use this example when deciding where a resource-dependent permission belongs.

## Rehearse a two-version migration

Suppose a deployed client still reads a display label while a new backend needs a normalized reference. An immediate rename breaks the old reader. Add the new representation first and deploy code that can read historical rows. While old writers are live, keep the old representation authoritative or use a compatible synchronization mechanism so their edits cannot leave stale references. Backfill in rerunnable batches. Reconcile missing or mismatched rows before switching reads. Retire the old field only after old writers and the app rollback window are gone.

Verify on a disposable database with an existing row, an old-version write during backfill, a new-version write, and a restarted backfill. Assert both versions read equivalent values across the overlap. Rehearse an app rollback against the expanded schema. The NIR vocabulary tests provide a concrete model for reruns, edited rows, collisions, and preservation of historical snapshots. The mixed-version exercise above extends that coverage for a proposed schema change. See `tests/integration/services/v1/quality-control-vocabulary.test.ts` and `drizzle/migrations/README.md`.

## Run the examples

Use the checkout's dependencies and toolchain. Set `INTEGRATION_DB_URL` to a **new empty, disposable local PostgreSQL database** ending in `_test` for the bootstrap command. Include the test username, password, host, port, and database name in the URL. The runner checks the destination, sets up the schema, and runs the quality-control workflow and vocabulary suites. Omit `--bootstrap` when repeating against that initialized test database.

```sh
node tests/integration/run-market-release.mjs --bootstrap --quality-control
bun run test --run tests/unit/services/v1/service-channels/admin.test.ts
```
