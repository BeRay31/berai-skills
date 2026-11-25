# Trace a feature through each NIR app

Work from the root of the named checkout. Use the current source and locked dependencies for the feature you are changing. These traces illustrate the responsibilities that the two apps share and the contracts each one owns.

## Frontoffice · remove a saved address

1. Reach the protected account page through its auth route. In `src/routes/Auth/Account/AddressSection.tsx` the customer opens a confirmation for a specific address. The section captures the target UUID, resets the fetcher response guard, and submits the ID to `DELETE_ADDRESS_URL`. Keeping the target identity matters when the displayed list changes during the request.
2. Follow registration in `src/routes/api/user/index.ts` to `src/routes/api/user/deleteAddress.action.ts`. The form POSTs to the app's internal router action. Its authenticated handler validates the ID and calls `deleteAddress` from `src/lib/api/user.ts`. The HTTP client sends the backend DELETE and re-fetches the address list. The action refreshes the store country and returns a typed success result with the list, or a failure message.
3. Follow the result back through `useFetcherResponse`. Check that success affects the submitted address and that failure retains the confirmation for retry. The router test reorders the list after a failure and verifies the retry uses the original UUID. It mocks authentication and the HTTP client.
4. For a new page, colocate feature-specific hooks and controls under the relevant theme in `src/routes/`. Follow the neighboring lazy route registration, choose the correct public or protected branch and market, add its navigation entry, and register the translated copy. For a new API domain, check the backend wire type and the internal action/loader result independently. Match the current client's response casing and preserve any action-specific result type.

From `nir-frontoffice` run:

```sh
npm test -- src/routes/Auth/Account/AddressSection.router.test.tsx
```

For browser evidence, use a disposable account and address. Verify the displayed target through cancel, failure/retry, and success. Check that the refreshed list and translated feedback agree with the operation.

## Backoffice · finalize a quality-control record

1. Start from the quality-control detail route in `src/routes/V1/QualityControl/Detail.tsx`. Check view/edit permissions through the live staff auth context, route rules in `src/const/v1-pages.ts`, and navigation visibility. Preserve the operator's ability to see a restricted action in its disabled state. Recheck permission and target identity in action handlers.
2. In `src/routes/V1/QualityControl/hooks/useQualityControlEditor.ts`, follow the guarded read and mutation state. Distinguish the saved record from the editable draft. Preserve the draft and rejection reason on failure; block another finalize while the submitted mutation is pending.
3. Follow `QC_SAVE_URL` through `src/routes/api/v1/quality-control/index.ts` to `src/routes/api/v1/quality-control/save.action.ts`. The action dispatches create, save, or finalize by intent and returns `V1ApiResponse<QualityControlRecord>`. The API client in `src/lib/api/v1/quality-control.ts` calls the matching backend operation using `BackOfficeAPIService`. Binding the internal URL to an action keeps UI code independent of transport details.
4. The router test renders the detail page with its action routes and controlled API and auth fixtures. It exercises duplicate finalization, read-only controls, and a version conflict where the operator can keep edits or explicitly load the latest version. For a new operator flow, guard the action during revalidation, announce the result, and restore a useful focus target.

From `nir-backoffice` run:

```sh
TZ=Asia/Jakarta npm test -- --run src/routes/V1/QualityControl/qualityControl.router.test.tsx
```

For browser evidence, use a test record and appropriate staff roles. Verify the denied action, inspect the proposed stock impact before confirming, then verify the resulting record state. The router fixture covers client behavior; server authorization and inventory effects need their own evidence.

## Reuse a control across different package versions

Read the dependency spec and installed and locked versions in **the consuming app**. In the checkouts used for these traces, frontoffice pins 0.4.3 and backoffice pins 0.5.4. Both export the shared Button from the package root and provide `src/components/Button/Button.tsx` as a local adapter. The storefront adapter supports button, router link, and anchor semantics. The operator adapter preserves backoffice touch sizing. Prefer the local adapter for a routine page action.

When an interaction exceeds the installed control's contract, compare the app wrapper, shared component props, and any newer public export. Give the user a concrete choice between an app composition, a consumer upgrade if the capability already exists, or a shared package extension. Include which consumers would benefit and what would need testing. Use the sibling nir-ui checkout's development workflow only for a package change the user selected.
