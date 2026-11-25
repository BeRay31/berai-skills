# NiR API

Set `REPO=909labs/nir-api-service` and inspect `release.yml`, `deploy.yml`, and `db-operations.yml` on the release branch, currently `nir-addl-features`. Deployment and database operations are separate workflows.

## Determine the database delta

For each environment, use the actual running source SHA and image digest or a verified deployment receipt. Diff that SHA to the candidate, including `src/db/schema/`, `drizzle/migrations/`, data migration code, PR rollout instructions and changed queries. Look for backfills, new constraints and dependencies on other services. A new Drizzle model can require SQL even if the file list has no new migration.

Build one row per required operation, separately for staging and production:

| Environment | File and exact Git SHA | Required result and apply order | Job/run evidence | Read-only verification | Status |
| --- | --- | --- | --- | --- | --- |

Inspect Database Operations runs and the **Apply SQL** job and execution step for the exact environment, checked-out revision, and file contents. Workflows may contain several skipped jobs. A successful overall run, the same filename at another revision, or a staging receipt cannot prove production application. Verify the resulting catalog definitions, indexes or backfill condition using authorized read-only access when available. Select only aggregate or schema information needed. Never include credentials or customer records in release notes.

Classify each row as applied and verified, pending, or unresolved. If the desired state already exists through another path, record the evidence and its provenance. If a backfill’s completion cannot be established, or an earlier operation failed partway, resolve that uncertainty before attempting it again. When SQL is required and missing, stop for a reviewed, committed SQL file matching the model. It may live at a separate immutable migration SHA. Preview its statements, transaction behavior, effects on the currently serving version, and verification query. A change incompatible with the live version needs an agreed rollout sequence before publishing. If the full deployed-to-candidate diff needs no database work, record that conclusion for the environment.

## Apply approved SQL

Use the environment authorized at the relevant checkpoint. Pin `SQL_SHA` to the commit containing the reviewed file. The workflow's `git_ref` default can point elsewhere. Dispatch only rows verified as pending. Apply in dependency order, one file per dispatch. Record the returned run ID and verify it before continuing to the next file.

```sh
gh workflow run db-operations.yml -R "$REPO" --ref nir-addl-features \
  -f operation=apply-sql -f environment="$ENVIRONMENT" \
  -f git_ref="$SQL_SHA" -f sql_file="$SQL_FILE"
gh run watch "$RUN_ID" -R "$REPO" --exit-status
gh run view "$RUN_ID" -R "$REPO" --json jobs,url
```

Inspect the apply step, transaction commit if applicable, and resulting database state. Preserve evidence of previously applied files. A failed action requires inspection before a retry. Keep routine release SQL within Database Operations; a forced schema push, schema reset or direct SSH write exceeds the scope of a file-specific approval.

## Stage, promote and verify

The version tag triggers `release.yml` (CI, immutable ECR publication, staging deployment). Locate it with `gh run list -R "$REPO" --workflow release.yml --branch "$VERSION" --event push` and match its head SHA and staging job. Verify the version and commit tags and `staged-<digest hex>` all resolve to the same ECR digest. Read the environment’s deployment receipt and match the running container to that digest. Check `/health`, `/ready` including database readiness, and a changed feature using a read-only request. Follow the separate Integration Diagnostics run associated with this deployment.

On resume, if publication succeeded and the staging job needs recovery, use the repository's existing deployment path for that published version. If ECR lacks the required artifact, investigate publication first. The immutable publish workflow can require a fresh version after a partial attempt. Return to candidate approval before cutting a new version.

After checkpoint 3 and verification of production SQL:

```sh
gh workflow run deploy.yml -R "$REPO" --ref nir-addl-features \
  -f environment=production -f version="$VERSION" -f confirm_production=true
gh run watch "$RUN_ID" -R "$REPO" --exit-status
```

Match the production container digest to staging and repeat readiness, changed-feature and diagnostic checks. If installation fails, report the serving revision and schema state. Inspect compatibility before proposing a rollback where SQL has already committed.
