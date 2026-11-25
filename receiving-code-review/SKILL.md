---
name: receiving-code-review
description: Address feedback on a diff or pull request. Use when a reviewer requests changes, raises a possible bug, or proposes a design that needs checking against current behavior.
---

# Address code review feedback

Read the full thread and identify the reviewed revision, target branch, and current checkout. Read the current diff and any uncommitted changes touching the finding. If a line moved, trace its behavior in the current implementation. A comment on an older revision may already be resolved.

For each distinct finding, identify the claimed failure, its trigger, and the caller or contract it affects. Inspect the relevant source and tests. When feasible, run the smallest check that distinguishes the reviewer’s explanation from the current behavior.

- **Confirmed.** Fix the cause within the requested scope, preserving callers’ supported inputs. If several comments describe the same defect, fix it once and account for each thread. Check the failing scenario and a neighboring case that should still work.
- **Already addressed or contradicted.** Identify the current path, revision, test, or observed result that settles the claim. Explain the technical reason for retaining the behavior. For example, if a reviewer believes an explicit zero falls back to the default, exercise zero and a missing value through the caller to demonstrate the distinction.
- **Undetermined.** Say which evidence is missing. If two plausible interpretations change a product contract, ask the user one focused question with the tradeoff and a recommendation. Continue independent findings while the decision is open.

Review the combined diff and run the affected checks. Then draft a short response for each thread with the disposition, the change or reason, and what was actually verified. Distinguish an untested assumption from a reproduced result. Publish replies or resolve threads only when that external action was authorized.
