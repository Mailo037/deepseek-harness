# Agent Note: Settings section headings share one treatment

Status: implemented

## Problem

Each settings section painted its own title-and-description header in its own CSS module, so the heading block changed as you switched tabs: the title was 16px/500 (Models), 18px/600 (Plugins, Agent presets), or 14px/600 (Access restrictions), over a description at 13px or 14px, inside a container at 12px or 20px gap and 720px, 760px, or full width. Navigating between tabs visibly shifted the section's rhythm.

## Decision

Settings sections render their header through one `SectionHeading` primitive exported from `@deepseek-ai/dsh-client-ui-primitives`, which draws a 16px/24 weight-600 title over a 14px/22 description in a single 4px-gapped block. The four header-bearing sections — Models, Plugins, Agent presets, and Access restrictions (fs-deny) — use it in place of their own `<h2>`/`<p>` plus the per-package `.title` / `.intro` / `.heading` / `.groupTitle` / `.hint` rules, which are removed. Their `.section` containers are aligned to `gap: 12px` and `max-width: 720px` so the content column lines up across tabs. About, General, and Remote devices keep their own content and are unchanged.

## Alternatives considered

### Per-package CSS aligned by hand
Synchronizing the four module sheets each time the design shifts would leave the same duplication to re-fix — the duplicated rules are the defect, not a symptom.

### A shell-owned header slot
Moving the header into the Settings shell would require every section to declare and fill new owner props, a wider change than the inconsistency warrants.

## Consequences

The header is now one source of truth: a heading change edits one primitive instead of four module sheets, and the tabs cannot diverge again. The trade-off is a narrower free hand per section — a section needing a bespoke header must unbundle the primitive instead of restyling one rule.
