// Committed config — nothing secret here. The Worker URL is public by
// nature; the Worker's x-app-key check is the gate, and the Anthropic key
// lives only in Worker secrets. For local verification against wrangler dev,
// temporarily point WORKER_URL at http://127.0.0.1:8787 (don't commit that).
window.CONFIG = {
  WORKER_URL: 'https://mirage-api.jamienliston.workers.dev',
};
