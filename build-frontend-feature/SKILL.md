---
name: build-frontend-feature
description: Build or change a user-facing feature in a web frontend, from page and component design through routing, state, API interactions, accessibility, and rendered verification. Use the host framework and design system, or establish a visual direction when the project leaves it open.
---

# Build a frontend feature

## Start from the user's task

Identify the person, their entry point, the action they take, and the result they should be able to see. Trace one comparable journey in the target app from the link or control through the route, view, data boundary, and tests. Check project instructions, component exports, design tokens, and the actual API contract. Reuse the smallest existing operation or control that supports the behavior.

Use **AskUser** for one consequential gap at a time. State what the repository establishes, the remaining choice, your recommendation, and why it matters. Wait on work that depends on that answer. For example, an editor already preserves drafts on validation errors. Reuse that behavior. If the server rejects a stale save and the product has no conflict policy, ask whether to keep the draft and offer to load the latest version. If a question picker is unavailable, ask the same single question in chat.

## Shape the page and interaction

For a flow with business branches, map only the combinations that change the outcome. For each, record the actor, relevant data, event or timing, expected screen, and permitted side effect. Check the current rules against the API contract, callers, and tests. For example, a wholesale order qualifies when the customer presses Submit, then the server rejects the changed quantity. Establish whether the UI should preserve the draft for correction or offer retail pricing. If the rule is open, use AskUser before choosing. Turn the agreed branches into checks for what the user sees and whether a write occurs, including a retry when relevant.

- Place the page in the host's routing structure. Wire a real entry point and check direct navigation, refresh, back navigation, and access rules where they affect the task. Colocate controls used by one feature. Look through the shared registry before adding a new primitive.
- Follow existing visual language, copy, and interaction patterns. Where direction is open, derive it from the audience and content. Choose a typographic hierarchy, a restrained palette with an intentional accent, and spacing and density that suit the task. Use imagery, asymmetry, texture, or motion when they help communicate something specific. A product listing should let the reader compare products at a glance. An editorial landing page can give one image and headline most of the space.
- Start with semantic controls and accessible names. Use links for navigation and buttons for actions. Keep validation near the input, connect errors to fields, manage focus across dialogs, and respect reduced motion. Adapt the interaction to narrow screens, touch, and keyboard use. Preserve the user's place when a list refreshes.

## Connect data and state

Trace the host's transport, route or query layer, and view before writing a new fetch. Check wire casing, nulls, error shapes, and identity. Keep server results with the host's read/cache mechanism, shareable filters in the URL where conventional, and editable drafts with the form that owns them. Derive values during rendering when possible. In React, handle user intent in event handlers, use effects to synchronize external state, and extract a hook when it clarifies ownership. Use the framework's equivalent in other stacks.

For a remote read, distinguish first load, successful empty result, populated result, and error with recovery. For a local filter over static data, show matches or an empty result and a way to clear the filter. During refresh, keep useful data visible when the contract permits. Bind a mutation to the submitted record and guard repeat submissions. On success, update or invalidate the affected data. On failure, preserve user input and show a retry that targets the same record. Check late responses when the user navigates, changes a filter, or switches records.

## Verify and hand off

Enter through the rendered app. Perform the action and check the resulting screen, URL or data, including persistence after refresh where relevant. Walk the consequential failure path when the operation can fail. Use the keyboard for the main flow, check focus and accessible labels, and try narrow and wide layouts. For a permission-sensitive feature, exercise a restricted user as well. Run the smallest automated checks that catch a regression and the host’s required build and CI checks. A mocked router test proves view and routing behavior within its fixture. Report browser, server, or device coverage that remains unavailable.

For an authorized PR, self-review the change, open the review with the observable behavior and verification evidence, and follow required CI to green. State any blocker and its impact on readiness. Handoff is a PR ready for human review. Merge and release follow the owner's instructions.
