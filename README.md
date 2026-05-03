# glpi-kb-hint-plugin

A GLPI 11.x plugin that surfaces Knowledge Base article suggestions inline as the user types in the new end-user **Form**. Title and description text are combined into a single MySQL boolean-mode full-text query. The combination strategy is configurable (compile-time constant `MATCH_MODE` in `plugin/public/js/kbhint.js`):

- **`recall`** (default) — every token from title and description becomes `token*` (OR with prefix wildcard). Wider net; all matching articles are returned and ranked together.
- **`precision`** — title tokens become required (`+token*`), description tokens only boost the score. Articles that don't satisfy a title term are excluded even if the description matches. If the title is empty, description tokens become the required terms.

Clicking a suggestion opens the article in a new tab.

## Layout

```
.
├── docker-compose.yml      # GLPI 11.x + MariaDB dev stack
├── .env.example            # copy to .env
├── Makefile                # make up | logs | shell | down | nuke
└── plugin/                 # bind-mounted into the container as plugins/kbhint
    ├── setup.php
    ├── hook.php
    ├── plugin.xml
    ├── src/KbHint.php
    ├── ajax/search.php      # legacy-style PHP endpoint: KB full-text search
    ├── public/              # GLPI 11 serves /plugins/<key>/<file> from here
    │   ├── js/kbhint.js
    │   └── css/kbhint.css
    └── locales/en_GB.po
```

The bind mount in `docker-compose.yml` maps `./plugin` to `/var/www/glpi/plugins/kbhint` inside the container, so edits on the host are picked up live (just hard-refresh the browser to bust JS caches).

## Prerequisites

- Docker (daemon running) **and** the Compose v2 plugin or standalone `docker-compose`. On Arch: `sudo pacman -S docker-compose`. On Debian/Ubuntu: `sudo apt-get install docker-compose-plugin`.
- A free TCP port for GLPI HTTP (`GLPI_HTTP_PORT`, default 8080).

## Bring up the dev stack

```sh
make up
make logs    # follow GLPI logs until the install wizard is ready
```

Browse `http://localhost:8080`:

1. **Installer** runs once. Pick "Install", point GLPI at the DB:
   - SQL server: `db`
   - SQL user: `glpi`
   - SQL password: `glpi` (or whatever you set in `.env`)
   - Database: `glpi`
2. After install, log in as `glpi` / `glpi` (default GLPI super-admin).
3. **Activate the plugin**: `Setup → Plugins`. You should see "KB Hint" listed (because the bind mount drops it into `plugins/kbhint`). Click "Install", then "Enable". Or, from a shell: `make shell` then `php /var/www/glpi/bin/console plugin:install kbhint && php /var/www/glpi/bin/console plugin:activate kbhint`.
4. **Seed Knowledge Base entries**: `Tools → Knowledge base → Add`. Create at least:
   - Title: `VPN connection troubleshooting`, body mentions "tunnel".
   - Title: `Reset password procedure`, body mentions any other distinctive phrase.
   - Tick "Visible in the FAQ" if you want to test from anonymous forms.
5. **Pick a Form**: `Administration → Forms`. The default `Report an issue` (id 1) and `Request a service` (id 2) ship with a `Title` short-text and `Description` long-text. Copy the public URL: `http://localhost:8080/Form/Render/{id}`.

## Manual verification

| Scenario | Steps | Expected |
| --- | --- | --- |
| Golden path | Open the form URL, type `vpn` in the title input. | Dropdown appears under the title with the VPN article. Clicking opens a new tab on `front/knowbaseitem.form.php?id=…`. |
| Negative | Type `asdfgh`. | No dropdown, no console errors. |
| Description-only query (recall) | Leave the title empty; type a phrase that exists only in the article body (e.g. `tunnel`) into the description editor. | Dropdown anchors under the description section and shows the VPN article. The single query sent is `tunnel*`. |
| Combined recall query | Type `vpn` in the title and `pass` in the description. | Dropdown shows both articles. The single query is `vpn* pass*` and the FT engine ranks results by combined relevance. |
| Precision-mode required term | Switch `MATCH_MODE` to `'precision'`, hard-refresh, then type `xyzzy` (no match) in the title and `vpn` (matches an article body) in the description. | Dropdown stays empty. The query is `+xyzzy* vpn*`; the required title term excludes everything regardless of the booster. |
| Anonymous | If the form's access control allows public access, open it in a private window. | The plugin AJAX endpoint replies normally if GLPI started a session; if it 302s back to login, the JS catches it and silently disables itself. The form still submits in either case. |
| Keyboard a11y | With the dropdown visible, press `↓` / `↑` to move selection, `Enter` to follow the highlighted link, `Escape` to dismiss. | Selection moves; `Enter` opens a new tab; `Escape` hides the dropdown. |

## How the JS finds inputs

The plugin loads on every page but bails immediately unless `location.pathname` matches `/Form/Render/<id>`. From there it queries `<form id="forms_form_answers">` for the first `<section data-glpi-form-renderer-question>` containing a short-text input (treated as the **title**) and the first one containing a `<textarea>` (treated as the **description**). If TinyMCE has wrapped the textarea, the plugin reads through `tinymce.get(id).getContent({format:'text'})`; if TinyMCE has not initialised yet, it subscribes to `AddEditor` and polls for up to 10 s.

The dropdown anchors to the title `<input>` for title-driven queries, and to the description `<section>` (not the TinyMCE container) for description-driven queries. The section is the most reliable element to position against because it is always laid out regardless of TinyMCE's init state, while the original textarea may be hidden by the editor.

This means: **the first short-text question in DOM order is what the plugin treats as the title.** If your form has multiple short-text questions and you want a different one to drive suggestions, reorder it to the top.

## How the search works

Front-end calls `GET /plugins/kbhint/ajax/search.php?q=<expression>`. The endpoint runs `KnowbaseItem::getListRequest(['contains' => q, 'faq' => is_anonymous], 'search')` against the GLPI core, which performs a MySQL full-text `MATCH AGAINST(... IN BOOLEAN MODE)` over `glpi_knowbaseitems(name, answer)` with the visibility / FAQ ACL filters applied.

`kbhint.js` builds the boolean expression on every keystroke (debounced 300 ms):

1. Tokenize the title and description into word tokens (Unicode letters and digits, ≥ 3 chars, deduped, capped at 8 total).
2. **In `recall` mode (default):** every token becomes `token*` and the whole list is joined with spaces, e.g. `vpn* tunnel* pass*`. MySQL boolean mode treats unprefixed tokens as optional, so this is effectively an OR with prefix wildcards; matching articles are ranked by relevance across all terms.
3. **In `precision` mode:** title tokens become `+token*` (required), description tokens stay `token*` (score boost). If the title is empty, description tokens become the required terms.
4. The combined string is sent as `q`. GLPI's `KnowbaseItem::computeBooleanFullTextSearch` preserves boolean operators when present, so the expression survives untouched into the SQL `MATCH AGAINST`.

There is exactly one request per keystroke; latest-request-wins via `AbortController` prevents stale results from racing the current input.

We deliberately avoid `/apirest.php` because the form-render page does not expose a `Session-Token`, so cookie auth via a plugin endpoint is the only practical path.

### Note on the "legacy" endpoint style

`ajax/search.php` is what GLPI itself calls a *legacy* script: a PHP file under `<plugin>/{ajax,front,report}/` that `include('../../../inc/includes.php')`, runs its own session bootstrap, and `echo`es JSON. The naming comes from GLPI core (`LegacyRouterListener`, `LegacyFileLoadController`, `LegacyItemtypeRouteListener`); 11.x still relies on this path pervasively and core itself ships hundreds of such scripts, so it is fully supported and not deprecated.

The modern alternative in 11.x is a Symfony controller:

- A class under `plugin/src/Controller/SearchController.php` extending `Glpi\Controller\AbstractController`.
- An action with `#[Route('/Search', name: 'kbhint_search', methods: ['GET'])]`, resolved by `PluginsRouterListener` under `/plugins/kbhint/Search`.
- Controller registered as a public service in a plugin DI config (the `PluginContainer` mechanism, sparsely documented for third-party plugins as of 11.0.7).
- Returning a `JsonResponse` instead of `echo json_encode(...)`.

For one read-only endpoint the controller route is overkill (extra class, autoload wiring, DI registration), and the plugin-side service-registration story is not yet well-documented. If we add more endpoints, or once that documentation lands, porting `ajax/search.php` to a controller is a mechanical change; the JS URL can stay the same by giving the controller route the matching path.

## Configuration knobs (compile-time)

Constants near the top of `plugin/public/js/kbhint.js`:

- `MIN_QUERY_LEN = 3` (per-token threshold; also matches MySQL InnoDB FT minimum word length default, so shorter tokens would not match anything anyway).
- `DEBOUNCE_MS = 300`.
- `MAX_RESULTS = 5`.
- `MAX_TOKENS = 8` (across title and description combined; keeps the URL bounded and avoids pathological queries on long descriptions).
- `MATCH_MODE = 'recall' | 'precision'` (default `'recall'`; see the summary at the top of this README for the trade-off).

A real config UI is out of scope for v1.

## Out of scope for v1

- Admin config UI.
- Multi-language re-ranking using KnowbaseItem translations.
- Attach-to-ticket on submit.
- Classic ticket form coverage (`front/ticket.form.php`).
- FAQ-only proxy for anonymous forms (today, GLPI's session check on the AJAX endpoint redirects unauthenticated users to login; the JS catches the non-OK response and disables itself silently).
- Marketplace packaging.

## License

GPLv3+
