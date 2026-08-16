// The single source of truth for Mirage's version. Semver.
//
// Loaded two ways from this one file, so the displayed version and the
// service-worker cache name can't drift apart:
//   - index.html loads it as a plain script (before config/app)
//   - service-worker.js pulls it in with importScripts
// Hence `self` rather than `window` — it resolves in both scopes.
//
// Bumping this string is the whole release ritual: it changes the version in
// the UI and invalidates the cached app shell in one move.
self.MIRAGE_VERSION = '0.3.0';
