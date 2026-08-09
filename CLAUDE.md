# Mirage — Conventions

A private journaling PWA with a "second pass": after writing, Claude reflects
the entry back (what went well, what could've been better, a grounding check on
self-criticism, and vocabulary suggestions), plus a mid-write word-lookup
drawer.

## Stack

- **Front-end:** vanilla HTML/CSS/JS, no build step, no framework. The only
  backend calls are plain `fetch`es to the Worker.
- **Backend:** one Cloudflare Worker (`worker.js`, mirrors the Amazing/Pubwedda
  worker pattern) as the Anthropic proxy, plus a Cloudflare KV namespace
  (`ENTRIES`) for stored journal entries. No database server, no auth accounts.
- **Hosting:** static front-end on GitHub Pages, served straight from the
  `main` branch root (no build step); Worker on workers.dev via
  `wrangler deploy`.

## Architecture

- Single `index.html` shell. Views (`gate`, `write`, `reflect`, `list`,
  `detail`) are sections toggled by a `hidden` class — no router.
- `js/` plain scripts in dependency order: `version` → `config` → `app`.
- `js/version.js` is the **single source of truth for the version** (semver, on
  `self` so it loads in both the page and the service worker). The entry list
  renders it; `service-worker.js` derives `CACHE` from it via `importScripts`.
  Never hard-code a version or cache name anywhere else.
- The passphrase lives in localStorage (`mirage-app-key`) and is sent as
  `x-app-key` on every request; a 401 clears it and returns to the gate.
- The in-progress draft persists in localStorage (`mirage-draft`), cleared on
  save.
- The horizon gradient shifts with the local hour (dawn/day/dusk/night).

## Worker API (all routes require `x-app-key`)

| Route | Does |
|---|---|
| `POST /reflect {text}` | sanitised entry → reflection prompt → `claude-sonnet-5`, returns `{reflection}` JSON (wentWell / couldBeBetter / criticism / vocab) |
| `POST /words {reaching}` | word-lookup prompt → `{words: [≤4 candidates]}` |
| `POST /entry {text, reflection, note}` | store entry in KV, return `{id}` |
| `GET /entries` | stored entries, most recent first (KV key metadata only — no body reads) |
| `GET /entry?id=…` | one stored entry, full record |
| `POST /delete {id}` | remove a stored entry |

- KV layout: `entry:<zero-padded-ts>-<rand>` → `{id, date, text, reflection,
  note}` with `{date, preview}` as key metadata. Timestamp-first keys make
  KV's lexicographic list order chronological.
- Sonnet 5 rules baked in: no `thinking` param (omitting it runs adaptive
  thinking by default), no sampling params (`temperature` etc. 400), no
  assistant prefill, and check `stop_reason === "refusal"` before reading
  content.
- Raw `fetch` to the Messages API (dependency-free worker); one manual retry
  on 429/529/5xx since there's no SDK doing it for us.

## Secrets — non-negotiable

- **The Anthropic key lives only in Worker secrets**
  (`wrangler secret put ANTHROPIC_API_KEY`), read via `env`. Never in the
  front-end, never committed.
- `APP_PASSPHRASE` is also a Worker secret; every route rejects requests
  whose `x-app-key` header doesn't match (no open relay).
- `js/config.js` (Worker URL) is **committed** — the URL is public by nature
  and there is no build step. Only Worker secrets are sensitive. Never put a
  key in `config.js`.
- `.dev.vars` (local `wrangler dev` secrets) stays gitignored.

## Safety rules

- Free-text input is capped and sanitised **server-side** (length limits,
  control characters stripped) before reaching a prompt or KV.
- Model output and stored text are rendered with `textContent` / element
  construction only. Never `innerHTML` a raw string — including entry text
  and reflections coming back from KV.

## Conventions

- Australian English everywhere: UI copy, prompts, docs, commit messages.
- Mobile-first CSS; the primary target is a phone home-screen install.
- The service worker caches the app shell cache-first. **Bump `MIRAGE_VERSION`
  in `js/version.js`** (`sh scripts/bump-version.sh`) on any change to
  `index.html`, `css/`, or `js/*.js`, or installed clients keep old files. The
  cache name follows automatically; nothing else to touch. The registration
  passes `updateViaCache: 'none'` so the imported `version.js` is revalidated
  on update checks — don't drop that.
- Deploy the Worker with `wrangler deploy` (KV namespace id lives in
  `wrangler.jsonc`).

## File editing rules

Never use str_replace on these files — always write the complete file
directly, no diffs:

- js/app.js
- index.html
- worker.js

When asked to edit any of these files, read the current file in full first,
then write the complete replacement directly to disk.
