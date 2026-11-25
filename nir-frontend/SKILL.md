---
name: nir-frontend
description: Build customer and operator features in nir-frontoffice or nir-backoffice, review storefront UX, and coordinate changes to @909labs/nir-ui. Extends build-frontend-feature with NIR design language, app routing and data contracts, and shared-component ownership.
metadata:
  requires:
    - skill:build-frontend-feature
---

# NIR frontend features

Load [build-frontend-feature](../build-frontend-feature/SKILL.md) first. When using a skill registry, resolve it by name. Apply its interview, feature delivery, and verification workflow. Read the target app’s AGENTS.md, the route and navigation setup, and its component barrel. Use the relevant [consumer walkthrough](references/consumer-flows.md) to trace the actual data contract. Paths in that reference are relative to the indicated consumer checkout.

## Add a page and its data flow

Wire the page into the app's route tree and give its audience a way to reach it. For a storefront page, use the theme's lazy route helper, market and sign-in rules, page metadata, and translations. For a staff page, register the V1 page rule and navigation permission alongside the route. Test direct entry as well as navigation.

Follow the local three-layer pattern. Put the typed backend HTTP call in the app’s API client module. Expose it through a registered React Router loader or action, then consume that router operation from the page or feature hook. The router URL can differ from the backend path and method. Frontoffice commonly uses `BackendResponse` and action-specific results; backoffice V1 uses `V1ApiResponse`. Read the actual return type before deciding which layer unwraps the result.

Keep editable inputs with their form and derive display values during render. One effect should synchronize one external concern. A fetcher can retain its last result between submissions. Use the app's response or mutation helper to associate completion with the current request and target. Show a skeleton while the first read is unresolved, even on the frame before the fetcher enters its loading state. Show an empty state only after a successful empty response. Keep an existing list usable on a later-page error when retrying that page is safe.

## Find the component the app can ship

For storefront components owned by the app, start in the consuming feature. When another feature in the same theme needs the same behavior, promote the reusable part to that theme’s components directory. When a second theme uses it, promote it to the app-wide registry in `src/components/index.ts`. Keep business rules and feature state in the owning feature. Promotion within the storefront does not by itself require a package release. Use the ownership decision below when the shared control lacks required behavior.

1. Start in the app's component registry and inspect its wrapper. Frontoffice adapters supply storefront behavior such as translations and router links. Backoffice adapters can add operator touch targets and layout behavior. For example, both apps already wrap the shared Button. Use the existing wrapper for a save action and pass its pending and disabled states.
2. Check the consumer manifest, lockfile entry for `node_modules/@909labs/nir-ui`, and installed package exports. Follow the public component, icon, hook, or utility barrel to the actual symbol and props. A local workspace link can expose a newer component than CI installs. Compare with the pinned package before promising an API or changing a version.
3. **When the needed control or behavior is genuinely missing, use AskUser before deciding where to implement it.** Explain the closest wrapper or composition, which consumers might reuse it, the keyboard/focus cost, and the package release or upgrade required. Recommend an owner and wait for the decision. Example for a proposed searchable hierarchical picker: “Both apps need the same keyboard tree interaction, and neither pinned package exposes it. I recommend extending nir-ui and keeping domain data in each app. Should we extend nir-ui or compose a local control for this feature?” Verify those premises in the actual checkout before asking.
4. If a shared change is chosen, keep the primitive free of app routes, permissions, API clients, and translations. Accept accessible labels and app actions as props. Update the public export, component tests, and Storybook story. Use the documented local link workflow to exercise affected consumers. Verify the intended released or preview version for reproducible builds. Publishing a package is a separate action.

## Apply the design language to the surface

Both apps consume semantic colors, spacing and control treatments from the shared system. Use its theme roles for surfaces, text, brand actions, danger, and focus. Follow the component’s focus-visible treatment, overlay layering, and reduced-motion support. Check supported appearances in the target app. The storefront can pin a light appearance while the package supports light and dark themes.

**Frontoffice.** Let the product, pricing, and next action lead. Transactional pages use calm surfaces, legible hierarchy, and concise copy explaining the consequence of an action or how to recover. Campaign pages can use more expressive imagery and typography. Preserve responsive shopping behavior, visible focus, and the app's locale coverage. Translate visible strings and accessible names through the owning namespace.

**Backoffice.** Optimize for repeated operator decisions. Keep record identity, status, and the next valid action visible. Reuse the app's responsive list/table and toolbar patterns. Preserve filters, selected rows, and drafts through updates or errors. Follow staff route and navigation permissions and the app's visible-disabled convention for restricted actions. Keep API authorization at the server boundary. Supply operator-facing copy through the app.

For a modal form with an external footer, connect the submit button to the form ID so Enter and pointer submission follow the same path. Reuse the existing dialog focus and recovery behavior. For expensive content in a mounted collapsible, start the read on expansion and choose caching or refresh based on freshness needs.

## Exercise the consuming app

For a requested **storefront design review**, walk the rendered page as a customer with a concrete task before inspecting the implementation. Start with anything that prevents task completion, then examine hesitation, consistency with comparable screens, and polish. For each finding, identify the step and viewport, describe what the customer saw and its consequence, and cite the copy, screenshot, or reproducible interaction. If the app cannot be rendered, label source-based observations and identify the interaction still to check.

For example, if the cart labels a subtotal “Total” and the payment screen first explains the shipping charge, show the two labels and the amount change. Recommend clarifying the subtotal when a quote requires an address; an earlier estimate is an option if reliable data exists. Present the tradeoff and let the user choose before editing the UI.

Use its real navigation, active route registry, permissions or sign-in, and locale configuration. Verify the initial load, empty and populated states, mutation failure and recovery, and late responses where applicable. For a shared visual change, also render the package story and try the behavior in both apps at relevant widths, with keyboard and reduced motion. Verify against the consumer’s current scripts and CI. Record exactly which flows ran.
