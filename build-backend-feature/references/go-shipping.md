# Implement and recover a carrier callback in Go

Paths and commands here are relative to `909-ship-api`. This service uses chi and PostgreSQL. Keep its HTTP contract and existing package layout when adding a callback.

## Map the four responsibilities

| Responsibility | Shipping implementation |
| --- | --- |
| Routing | `cmd/server/router_tenant.go` registers inbound callback routes with a provider-facing rate limit. The GoSend callback is mounted at `POST /api/v1/webhooks/inbound/gosend`. |
| Handler | `internal/handler/v1/inbound/webhooks.go` bounds and decodes the request, passes the callback credential, context, and payload to the processor, and returns HTTP 200 on success. |
| Service | `internal/service/webhook/inbound.go` handles provider-specific verification and status interpretation. Follow `internal/service/webhook/inbound_claim.go` for the decision to apply, acknowledge, or ask for a retry. |
| Repository | `internal/repository/postgres/provider_webhook_event.go` persists event claims and checks the claim token when recording completion or releasing ownership. |

## Walk through a duplicate delivery

A carrier sends the same event while the first request is processing. Use a stable provider/event identity. One worker owns the claim and applies the update. A concurrent delivery receives a retryable result. After the first worker marks the event processed, a later replay can succeed without repeating the update. If application fails, release the claim so the same event can retry.

A crash after the business update and before the completion marker leaves an ambiguous event. The claim token protects ownership of the marker. To make a new effect safe across this gap, commit the effect with its marker when they share a transaction, or make application idempotent by the event identity. Inject a stop at that boundary and replay against storage. Assert a single business effect and eventual completion. The existing focused Go tests use fakes to cover concurrent delivery and retry after failure. A new durable implementation also needs this database-level crash test.

## Walk through a lost booking reply

A provider accepts a booking, but the worker times out before receiving the airway bill. A second create could buy another shipment. Keep the original shipment and booking reference in a recoverable state. Look up the original attempt with the carrier. If the carrier confirms acceptance, attach the recovered reference and complete the existing operation. If the outcome remains uncertain, keep it available for investigation. Use the provider's supported retry path only after establishing that doing so is safe.

For a new carrier, test a callback arriving *before* the reply is reconciled. Persist a merchant attempt reference before sending the booking. If the carrier echoes it, use it to match the callback. If the callback carries only a carrier-assigned ID, retain it for matching once reconciliation supplies that ID, or use the carrier's documented redelivery contract. Deliver the callback twice, restart the worker, and reconcile. Verify one shipment update and a final processed event.

For the shipping service's recovery decisions, inspect `internal/service/shipment/parcel_recovery.go` and `internal/service/shipment/parcel_recovery_test.go`. The tests distinguish a confirmed rejection from a timeout, a duplicate invoice, or a missing airway bill. For a new integration, simulate a successful provider write followed by a dropped reply. Restart the worker and reconcile. Assert one provider booking, one local shipment, and the recovered reference. An operator should be able to find an aging unresolved booking by shipment or attempt ID and tell whether to check, retry, or escalate.

## Run the focused checks

Run from the shipping repository root. The routing test exercises the mounted path and rate limit. The service tests isolate claim and recovery decisions. These checks run locally without contacting a carrier.

```sh
go test -count=1 ./cmd/server ./internal/service/webhook ./internal/service/shipment \
  -run 'Test(InboundCallbackRoutesAreRateLimited|UnprocessedDuplicateRetriesAfterFailure|ConcurrentDuplicateAppliesOnceAndReturnsRetryableBusy|RecoveryRequiresConfirmedRejection)$'
```
