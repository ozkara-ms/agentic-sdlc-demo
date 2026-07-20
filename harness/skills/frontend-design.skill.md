---
name: frontend-design
description: Design and implement intentional, production-grade web interfaces for work units that create or materially change user-facing UI. EXAMPLE skill.
owner: dev-fleet
---

# Skill: frontend-design

> The development agent invokes this for user-facing frontend work. It turns a
> functional UI requirement into a coherent, accessible, responsive interface
> without drifting into an unrequested redesign or a generic generated look.

## When to invoke
- A unit creates a page, component, dashboard, form, navigation flow, or other
  user-facing web interface.
- A unit materially changes layout, visual hierarchy, interaction, motion, or
  responsive behavior.
- Do not invoke it for backend-only work or a copy-only edit with no UX impact.

## Inputs
- The approved unit's acceptance criteria, DoD, `requiredTest`, and owned paths.
- Product purpose, target audience, desired tone, and any explicit non-goals.
- Existing brand guidance, design system, tokens, components, and visual assets.
- Framework, browser-support, performance, accessibility, and localization constraints.

## Procedure
1. **Inspect before designing.** Read the existing UI, component library, tokens,
   screenshots, and brand guidance. Reuse established patterns unless the unit
   explicitly authorizes changing them.
2. **Commit to a short design brief.** Record in the unit status or PR description:
   purpose and audience; one clear aesthetic direction; the memorable visual or
   interaction idea; and the constraints that keep it on-brand. If those choices
   are materially ambiguous, stop and ask rather than inventing product direction.
3. **Build a deliberate visual system.** Use the repo's tokens or well-scoped CSS
   variables for color, type, spacing, radius, elevation, and motion. Create clear
   hierarchy and intentional composition; avoid framework defaults and repetitive
   card-grid layouts when they do not fit the product. Do not add a font, icon set,
   or UI dependency unless the unit allows it and `check-deps` can verify it.
4. **Implement the complete experience.** Connect real behavior and cover all
   relevant states: default, hover, focus, active, disabled, loading, empty, success,
   and error. Preserve existing data flow and error handling; a static mock is not a
   completed frontend unit.
5. **Make responsiveness explicit.** Verify the composition at narrow mobile,
   tablet/intermediate, and desktop widths. Prevent clipped content, accidental
   horizontal scrolling, unreadable line lengths, and controls that become unusable
   with touch or zoom.
6. **Make accessibility part of the design.** Use semantic HTML, labels, keyboard
   operation, visible focus, sufficient contrast, sensible source order, and adequate
   target sizes. Motion must be purposeful and respect `prefers-reduced-motion`.
7. **Use assets responsibly.** Prefer supplied or licensed assets and preserve
   attribution requirements. Never copy another product's protected visual identity
   or fabricate brand assets.
8. **Verify the real interface.** Run the unit's required tests and the repository's
   existing UI E2E/Playwright flow when present. Exercise primary interactions,
   keyboard navigation, loading/empty/error states, mobile and desktop viewports,
   overflow, and browser-console errors. Screenshots or visual review are supporting
   evidence, not a substitute for functional checks; an empty or all-skipped UI suite
   is not green.
9. **Report the result.** Include the design brief, implemented states, tested
   viewports, accessibility behavior, and the exact test/E2E outcome in the PR.

## Quality bar
- The interface has a context-specific point of view rather than a generic generated
  aesthetic.
- Visual ambition matches the product and implementation budget: expressive designs
  are fully executed; restrained designs are precise rather than merely sparse.
- Every visual choice supports hierarchy, comprehension, trust, or task completion.
- Existing product conventions win over novelty unless the approved unit calls for a
  redesign.

## Guardrails (never do)
- Never expand a scoped UI unit into a product-wide redesign.
- Never trade accessibility, responsiveness, performance, or working states for visual
  novelty.
- Never introduce an unverified dependency or remote asset to achieve the look.
- Never declare success from a screenshot, static mock, or skipped browser suite.

## Enforcement boundary
This is a **behavior-shaping craft skill**, not a pass/fail gate. Its output is
verified by the unit's required tests, the UI E2E workflow when configured, and human
review. Report that boundary honestly.
