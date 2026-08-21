# Agent Note: Plugin list Discover view browses the GitHub `dsh-plugin` topic

Status: implemented

English | [中文](2026-08-21-plugin-inventory-discover-github-topic.zh.md)

## Problem

The Plugins settings tab listed only the installed Loader inventory. Users had no in-app way to find third-party plugins from the `dsh-plugin` GitHub topic, and had to leave the product to browse repositories or compare popularity.

## Decision

`PluginInventorySettingsTab` now owns a two-view toggle (Installed | Discover). The installed catalog is unchanged. The Discover view fetches the public GitHub repository search for `topic:dsh-plugin` (`sort=stars&order=desc&per_page=100`) straight from the browser: no CSP restricts `connect-src`, and the client connection package already uses `globalThis.fetch`. Archived repositories are removed and the remainder is re-sorted by `stargazers_count` descending so the client owns the order. Each card is a link to the repository (`target="_blank"`, `rel="noreferrer"`) showing the full name, a two-line description, the star count with a decorative star glyph, and the primary language. The existing search field filters both views; switching views resets the query. New `zh`/`en` locale keys cover the toggle, the Discover states, and the card labels. Loading, error+retry, empty, and no-match states mirror the installed view, and transport details stay out of the failure copy.

The GitHub payload is consumed through a minimal local interface (`DiscoveredPlugin`, `GitHubSearchResponse`) that types only the consumed fields; a failed or rate-limited fetch surfaces the generic failure state.

## Alternatives considered

**Serve the topic through a new `api-remotes` remote like `pluginInventory.list`.** Rejected because the GitHub search API is public, read-only, and CORS-open; a Host round-trip would add a remote method, Host plumbing, and transport states for a browser-only browse surface.

**Reuse the `dsh-web` search/fetch capability.** Rejected because that seam is the agent's tool surface on the Host, not a settings-UI browse surface, and it carries provider configuration the tab does not need.

**Paginate the whole topic (9,871 repositories).** Rejected because the top 100 by stars is the browse surface; pagination is recorded as deferred work instead of growing the first implementation.

## Consequences

The Plugins tab now has a second view that surfaces the top 100 `dsh-plugin` topic repositories ordered by stars with counts visible, hiding archived repositories. The browser performs the fetch, so GitHub's unauthenticated search quota bounds the surface; rate limits or network failures show the generic failure state with retry. The `settings-chrome` e2e golden (`apps/web/tests/snapshots/settings-chrome/plugins.expected.md`) now includes the toggle buttons and must be re-recorded.

## Testing

Package tests cover the view switch, archive filtering and star-descending order, client-side filtering across both views, and the GitHub failure-to-retry path; all 11 package tests pass. The full repository build (`pnpm run build`) passes.
