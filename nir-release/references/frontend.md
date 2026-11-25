# NiR frontends

Use this procedure for `909labs/nir-backoffice` or `909labs/nir-frontoffice`. Both use `ci-cd.yml`. Skip the API migration inventory and every Database Operations dispatch. Read the selected repository's workflow to confirm inputs, environments, and verification jobs. Use the standard production target for this skill.

## Identify and stage the candidate

Resolve each serving deployment from a successful environment deploy job. Check which commit was actually built, including the dispatch input or checkout step on manual runs. Corroborate this with the environment's served entry document and hashed assets. The previous production baseline can lag the latest GitHub Release.

Publishing a version tag triggers checks followed by a staging deploy. Find the tag run with `gh run list -R "$REPO" --workflow ci-cd.yml --branch "$VERSION" --event push`. Match the SHA and staging job. A successful branch build can have a skipped deploy job. If the staging run already exists, follow it. If it genuinely never started, confirm tag resolution and workflow triggers before using the workflow's staging dispatch at the same ref.

Check that the environment build, S3 upload of entry and assets, and CloudFront invalidation succeeded. Verify the invalidation completed and fetch the changed route and its referenced assets. A SPA can return HTML with HTTP 200 for a missing JavaScript file; check the asset content and the release-specific route or UI behavior. If staging requires login, use an authorized session or inspect the configured S3 origin and CDN invalidation. Describe what that proves and give the operator the authenticated flow to exercise at checkpoint 2.

## Promote the tested ref

Use the tag for both the workflow ref and checkout input. Apply the three checkpoints in the main skill. Backoffice uses full verification:

```sh
gh workflow run ci-cd.yml -R 909labs/nir-backoffice --ref "$VERSION" \
  -f environment=production -f ref="$VERSION" -f verification=full
```

Frontoffice uses its standard production workflow inputs:

```sh
gh workflow run ci-cd.yml -R 909labs/nir-frontoffice --ref "$VERSION" \
  -f environment=production -f ref="$VERSION"
```

Standard Frontoffice staging uses the tag's automatic preview. If a change specifically needs a locale preview, identify the applicable staging storefront from the workflow and include it in the test plan. Treat separate in-store or international targets as separate requests.

Watch the returned run through the production deploy job. Match its checked-out commit to the user-tested tag. Each environment builds with its own frontend configuration. Verify the public route, current entry-to-chunk mapping and relevant release content against the production upload after invalidation. Record any signed-in flows that only the operator exercised on staging.
