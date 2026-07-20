# WEB-P2 — CSS Modules / Tailwind migration plan for `styles.css`

**Status:** Accepted (plan only — no migration in this change)  
**Date:** 2026-07-20  
**File:** `apps/cadence-web/src/styles.css` (~618 lines as of 2026-07-20)

## Context

Cadence web uses one global, unscoped stylesheet (BEM-ish class names). Report 04 flagged
class-name collision risk once the file approaches ~800–1000 lines, especially with a second
contributor. AI Admin `frontend/` already uses Tailwind; Cadence does not.

## Decision

**Do not migrate now.** Start an incremental CSS Modules (or Tailwind) migration when
`styles.css` crosses **~800 lines** or when a new major surface needs isolation — whichever
comes first.

## Migration approach (when triggered)

1. **Per-feature, not big-bang.** Convert one feature folder at a time (`features/settings`,
   `features/onboarding`, …) to CSS Modules co-located with components.
2. **Keep global tokens.** Extract design tokens (colors, type scale, spacing) into
   `:root` / a tiny `tokens.css` that Modules import — brand atmosphere stays shared.
3. **Prefer Modules over Tailwind for Cadence** unless the team explicitly wants stack
   parity with AI Admin; Cadence’s voice/layout is hearth-first and already custom CSS.
4. **Gate:** each converted feature deletes its global selectors from `styles.css` in the
   same PR; no dual-definition leave-behinds.
5. **Do not** add Cadence to the AI Admin Tailwind pipeline as a shortcut — separate apps.

## Non-goals

- Rewriting visual design while migrating.
- Sharing a stylesheet with AI Admin `frontend/`.
