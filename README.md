# Mirage

A private journaling PWA. Write freely; afterwards a reflection layer (Claude)
reads the entry back — what went well, what could've been better, a gentle
grounding check on self-criticism, and words you leaned on — plus a mid-write
"reaching for a word?" drawer. Saved entries stay editable: an edit rewrites
the entry in place, keeps the date it was written, and notes when it was last
changed.

Static front-end (GitHub Pages, no build step) + one Cloudflare Worker with a
KV namespace for storage and as the Anthropic proxy. See `CLAUDE.md` for
conventions and the Worker API.

## First-time setup

1. Create the KV namespace and paste its id into `wrangler.jsonc`:

   ```sh
   wrangler kv namespace create ENTRIES
   ```

2. Set the Worker secrets:

   ```sh
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put APP_PASSPHRASE
   ```

3. Deploy the Worker and confirm the URL matches `js/config.js`:

   ```sh
   wrangler deploy
   ```

4. Push to GitHub and enable Pages (deploy from `main` branch root).

5. Open the site, enter the passphrase, add to home screen.

## Local development

- Worker: `wrangler dev` with secrets in `.dev.vars` (gitignored):

  ```
  ANTHROPIC_API_KEY=sk-ant-…
  APP_PASSPHRASE=…
  ```

- Front-end: `python3 -m http.server 8000`, and temporarily point
  `WORKER_URL` in `js/config.js` at `http://127.0.0.1:8787` (don't commit).

## Releasing front-end changes

`js/version.js` holds the one version constant (semver). It's what the entry
list displays *and* what the service worker builds its cache name from, so the
two can't drift. Bump it on any change to `index.html`, `css/`, or `js/*.js`:

```sh
sh scripts/bump-version.sh          # patch: 0.1.0 -> 0.1.1
sh scripts/bump-version.sh minor    # 0.1.0 -> 0.2.0
sh scripts/bump-version.sh 1.2.3    # explicit
```

or just edit the string in `js/version.js` by hand — same thing. Then commit
and push; installed clients pick up the new shell on next load.
