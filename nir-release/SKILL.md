---
name: nir-release
description: Guide a NiR API, Backoffice, or Frontoffice release through GitHub Releases and GitHub Actions. Use when an operator wants to cut a version, stage it for human testing, or resume its production promotion.
---

# Release NiR

Use one repository and one candidate commit per release. Read the [API procedure](references/api.md) for `nir-api-service` or the [frontend procedure](references/frontend.md) for `nir-backoffice` and `nir-frontoffice`. Check the workflow definitions at the selected ref. Perform the routine checks yourself and wait for a human reply at each of the three checkpoints below.

## 1. Review and approve the candidate

Identify the full repository name, release branch, merged PRs and full candidate SHA. Confirm the SHA is reachable from the release branch. Report other changes that would ship with the requested PR. Collect three baselines:

| Evidence | Decision |
| --- | --- |
| Latest published stable GitHub Release and its tag | Compare its commit to the candidate. Draft release notes from the whole range and link the comparison. |
| All remote stable version tags, including tags without Releases | Propose the next unused patch version unless the operator requested a different bump. Sort by semantic version. Recheck the proposed tag before the first write and again immediately before publishing. |
| Last verified deployed revision in **each** environment | Compare staging → candidate and production → candidate independently. Use these ranges for rollout requirements and test suggestions. |

Use `gh api "repos/$REPO/releases/latest"`, remote Git tags (peel annotated tags to commits), and successful environment-specific **deploy jobs** corroborated by the running API digest or frontend assets. A branch CI run alone cannot establish deployment. If there is no prior release, identify the first-release baseline with the operator. Explain divergent ancestry or unknown deployed revisions before requesting approval.

For the API, include the per-environment migration review from the API procedure. For frontends, go directly to the release summary.

**Ask and wait:** “Approve publishing **VERSION** at **SHA** as Latest and deploying it to staging?” Include repository, notes, compare link, both deployed versions, test focus and, for the API, each proposed staging SQL file and pinned revision. Resolve missing rollout inputs first. Approval covers the displayed candidate and staging operations.

## Publish and verify staging

1. For the API, apply only outstanding approved staging prerequisites and carry forward verified receipts **before creating the tag**. Tag creation can immediately trigger staging.
2. Publish a stable GitHub Release with the reviewed notes. Supply the full SHA so branch movement cannot change the candidate. For a new version, use the operator-authenticated CLI:

   ```sh
   gh release create "$VERSION" -R "$REPO" --target "$SHA" --latest \
     --title "$VERSION" --notes-file "$NOTES_FILE"
   ```

   This publishes the Release and creates its tag. If a matching tag already exists at the approved SHA, use `--verify-tag` when creating its missing Release. If a draft exists, inspect its target and notes, then publish the approved draft. Reuse an already published matching Release. A tag at a different SHA is a collision: stop and present the existing ref. Verify the remote tag’s peeled SHA, published status, and the repository’s Latest release.
3. Find the staging run for this workflow, tag and SHA. Record its URL and run attempt. Follow queued and running jobs to completion, including the **staging deployment job**. Check for delayed or already completed runs before any retry. If the trigger never appeared, inspect workflow triggers and available artifacts using the repository procedure. Preserve immutable tags.
4. Verify the deployed version and changed path on staging. Report diagnostics separately from deployment success. Investigate failures and explain their impact. A release-related failure or stale deployment blocks sign-off. Disclose any independently established pre-existing issue to the tester.

## 2. Get the user's staging test result

Send the staging URL, version, run link, and a short checklist derived from the changed behavior. Include an expected result for each step. For example, a shipping change might ask the tester to open a failed booking and confirm the available actions for its carrier.

**Ask and wait:** “Did these checks pass on staging for **VERSION**?” Record the reply against the tested SHA. If the user reports failure, record the failed step and stop the promotion. GitHub Latest already points to the published release. Report which version production still serves.

## 3. Approve and perform production promotion

After the user confirms staging testing passed, recheck the tag, staged revision, current production baseline and any pending production SQL. Show the tested version and SHA, the API digest when applicable, production changes, open diagnostic findings and the prior verified release. If the planned changes have shifted, explain the difference and revise the proposal.

**Ask separately and wait:** “Approve the listed production changes and deployment of **VERSION** now?” Staging test confirmation, an initial request to deploy both environments, or an unattended timeout cannot satisfy this checkpoint.

After approval, follow the repository procedure: apply only outstanding approved production prerequisites, verify them, promote the tested version, and monitor the production job and diagnostics. Verify live behavior with a read-only smoke check. Link the Release, comparisons, both environment runs, applicable SQL runs and results. Distinguish human testing, automated verification and remaining issues.

## Resuming a release

Recover the repo, tag, SHA, Release URL, environment baselines, SQL receipts, deployment runs and recorded approvals from the conversation and remote state. Reuse completed steps, monitor active runs and ask only for missing decisions. A different candidate needs fresh approval and staging testing. Check the actual target after a partial failure before retrying SQL or a deployment. If production already serves the requested version, verify it and report that state. Do not repeat a successful promotion.
