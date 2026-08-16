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
  `detail`) are sections toggled by a `hidden` class — no router. The `write`
  view doubles as the editor for a saved entry (Save changes / Cancel instead
  of Finish writing, no reflect step).
- `js/` plain scripts in dependency order: `version` → `config` → `app`.
- `js/version.js` is the **single source of truth for the version** (semver, on
  `self` so it loads in both the page and the service worker). The entry list
  renders it; `service-worker.js` derives `CACHE` from it via `importScripts`.
  Never hard-code a version or cache name anywhere else.
- The passphrase lives in localStorage (`mirage-app-key`) and is sent as
  `x-app-key` on every request; a 401 clears it and returns to the gate.
- The in-progress draft persists in localStorage (`mirage-draft`), cleared on
  save. An in-progress *edit* persists separately under `mirage-edit`
  (`{id, date, original, text}`) so it never overwrites that draft and survives
  a reload; cancelling clears it and hands the draft back untouched.
- The entry list is drawn from an in-memory model (`entries` in `js/app.js`),
  never straight from a response. `renderList()` is a pure projection of it;
  `loadList()` is the only thing that refills it from `GET /entries`. Mutations
  the app makes patch the model directly (`dropListEntry` / `patchListEntry`),
  always *after* the Worker confirms — never optimistically, so a failed call
  leaves the list showing what's actually stored. Don't re-read `/entries`
  after a write: it's built from KV key metadata, the slowest surface to
  reflect one, and it will hand back a pre-mutation list. Saving a *new* entry
  is the deliberate exception (the server assigns its date and preview) and
  doubles as the resync point.
- The horizon gradient shifts with the local hour (dawn/day/dusk/night).

## Worker API (all routes require `x-app-key`)

| Route | Does |
|---|---|
| `POST /reflect {text}` | sanitised entry → reflection prompt → `claude-sonnet-5`, returns `{reflection}` JSON (wentWell / couldBeBetter / criticism / vocab) |
| `POST /words {reaching}` | word-lookup prompt → `{words: [≤4 candidates]}` |
| `POST /entry {text, reflection, note}` | store a new entry in KV, return `{id}` |
| `POST /entry {id, text}` | edit that entry in place, return `{id, updated}` |
| `POST /reflection {id, reflection}` | replace an entry's reflection only |
| `GET /entries` | stored entries, most recent first (KV key metadata only — no body reads) |
| `GET /entry?id=…` | one stored entry, full record |
| `POST /delete {id}` | remove a stored entry |

- KV layout: `entry:<zero-padded-ts>-<rand>` → `{id, date, updated, text,
  reflection, reflectionStale, note}` with `{date, updated, preview}` as key
  metadata. Timestamp-first keys make KV's lexicographic list order
  chronological.
- Editing rewrites the same key, so `date` (created) and the entry's place in
  the list never move; `updated` is stamped separately and drives the "edited"
  marker. An edit keeps the stored reflection and note untouched but sets
  `reflectionStale` when the text changed — the detail view then labels the
  reflection and offers a re-run. Re-running goes through `/reflection`, which
  leaves `updated` alone: re-reading an entry isn't editing it. Nothing
  re-reflects automatically.
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
