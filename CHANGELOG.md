# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-04

### Added
- Initial release of the **kbhint** plugin for GLPI 11.x.
- Inline Knowledge Base suggestions while filling the new end-user **Form** (`/Form/Render/<id>`).
- Combobox-style dropdown anchored under the focused field (Title input or Description section), with a "Matching knowledge base articles" header in Tabler's warning palette.
- Hybrid query model with a compile-time `MATCH_MODE` constant in `plugin/public/js/kbhint.js`:
  - `recall` (default): every title and description token is OR'd as a prefix-match (`token*`); broadest results, ranked by full-text score across all terms.
  - `precision`: title tokens become required (`+token*`), description tokens act as score boosters; description tokens become required when the title is empty.
- Plugin AJAX endpoint at `/plugins/kbhint/ajax/search.php` that runs `KnowbaseItem::getListRequest` server-side under cookie auth, applying GLPI's visibility / FAQ ACL filters.
- Client-side state machine: 300 ms debounce, per-token minimum length of 3 chars, deduplication across fields, capped at 8 tokens; `AbortController` cancels in-flight requests so the latest keystroke always wins.
- TinyMCE-aware description handling: rebinds via `AddEditor` and a polling fallback if TinyMCE attaches after the script loads; reads content via `editor.getContent({format:'text'})`.
- Keyboard accessibility: arrow-key navigation, Enter to follow, Escape to dismiss, ARIA-live count.
- Click-outside dismissal that also catches clicks inside the TinyMCE iframe; focus-into-description reopens the dropdown when description text matches.
- Click on a result opens the article in a new tab (`target=_blank`, `rel=noopener`).
- Docker dev stack (`glpi/glpi:11.0.7` + `mariadb:11`) with bind-mounted plugin directory and `make up | logs | shell | down | nuke`.
- `make dist` target that produces a `kbhint-<version>.tar.bz2` ready to drop into another GLPI 11.x install.
- Documentation: README with install, query model, configuration knobs, manual verification matrix, and notes on the legacy vs Symfony controller endpoint styles.

[Unreleased]: https://github.com/tdido/glpi-kb-hint-plugin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tdido/glpi-kb-hint-plugin/releases/tag/v0.1.0
