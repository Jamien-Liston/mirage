// Cloudflare Worker — Mirage journal backend (mirrors the Amazing worker pattern).
// Routes (all require the x-app-key header to match the APP_PASSPHRASE secret):
//   POST /reflect    { text }                    -> reflection JSON via claude-sonnet-5
//   POST /words      { reaching }                -> { words: [up to 4 candidates] }
//   POST /entry      { text, reflection, note }  -> store a new entry, return { id }
//   POST /entry      { id, text }                -> edit an entry in place, return { id, updated }
//   POST /reflection { id, reflection }          -> replace an entry's reflection only
//   GET  /entries                                -> stored entries, most recent first (metadata only)
//   GET  /entry?id=…                             -> one stored entry, full record
//   POST /delete     { id }                      -> remove a stored entry
// Secrets required: ANTHROPIC_API_KEY, APP_PASSPHRASE
// KV binding required: ENTRIES (single shared namespace — personal app, no accounts)

const MODEL = 'claude-sonnet-5';
const LIST_LIMIT = 200;
const ID_PATTERN = /^[0-9a-zA-Z-]+$/;
// Control characters stripped from free text; newlines and tabs deliberately kept.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-app-key',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Shared passphrase gate — no open relay.
    if (!env.APP_PASSPHRASE) return json({ error: 'Server missing APP_PASSPHRASE' }, 500);
    if (request.headers.get('x-app-key') !== env.APP_PASSPHRASE) {
      return json({ error: 'Not allowed' }, 401);
    }

    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/reflect') {
        return await handleReflect(await request.json(), env);
      }
      if (request.method === 'POST' && url.pathname === '/words') {
        return await handleWords(await request.json(), env);
      }
      if (request.method === 'POST' && url.pathname === '/entry') {
        return await handleSaveEntry(await request.json(), env);
      }
      if (request.method === 'POST' && url.pathname === '/reflection') {
        return await handleSaveReflection(await request.json(), env);
      }
      if (request.method === 'GET' && url.pathname === '/entry') {
        return await handleGetEntry(url.searchParams.get('id'), env);
      }
      if (request.method === 'GET' && url.pathname === '/entries') {
        return await handleEntries(env);
      }
      if (request.method === 'POST' && url.pathname === '/delete') {
        return await handleDelete(await request.json(), env);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Unhandled error', err);
      return json({ error: 'Something went wrong — try again.' }, 500);
    }
  },
};

// ---- Reflection ----

async function handleReflect(body, env) {
  const text = cleanText(body.text, 20000);
  if (!text) return json({ error: 'Nothing to reflect on yet.' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Server missing Anthropic key' }, 500);

  const raw = await claudeText(env, reflectionPrompt(text), 1000);
  if (raw.error) return json({ error: raw.error }, raw.status);

  let reflection;
  try {
    reflection = JSON.parse(raw.text);
  } catch {
    console.error('Reflection not JSON', raw.text.slice(0, 500));
    return json({ error: "The reflection didn't come back cleanly — try again." }, 502);
  }
  return json({ reflection });
}

function reflectionPrompt(entryText) {
  return `You are a reflection layer inside a private journaling app. Read the journal entry below and respond ONLY with a JSON object, no preamble, no markdown fences.

Schema:
{
  "wentWell": ["1-3 short phrases, in the writer's own terms, of what went well — empty array if nothing"],
  "couldBeBetter": ["1-3 short phrases of what the writer felt should have gone better — empty array if nothing"],
  "criticism": null OR {
    "quote": "a short phrase from the entry where the writer criticises themself",
    "question": "one gentle question testing whether that criticism is grounded in evidence or is a harsher reading than the facts support"
  },
  "vocab": [
    up to 3 items: { "word": "a word the writer repeated or that is doing vague work", "count": times used, "alternatives": ["three", "sharper", "words"] }
  ]
}

Rules: use Australian English. Alternatives must have no definitions attached. Do not invent criticism that isn't there. Keep everything short.

Entry:
"""${entryText}"""`;
}

// ---- Word lookup ----

async function handleWords(body, env) {
  const reaching = cleanText(body.reaching, 300);
  if (!reaching) return json({ error: 'Describe the word you are reaching for.' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Server missing Anthropic key' }, 500);

  const prompt = `Someone is mid-write and reaching for a word. They describe it as: "${reaching}". Respond ONLY with a JSON array of exactly 4 candidate words or short phrases, no definitions, no preamble, no markdown. Australian English.`;
  const raw = await claudeText(env, prompt, 200);
  if (raw.error) return json({ error: raw.error }, raw.status);

  let words;
  try {
    words = JSON.parse(raw.text);
  } catch {
    console.error('Words not JSON', raw.text.slice(0, 300));
    return json({ error: "Couldn't fetch words — try again." }, 502);
  }
  if (!Array.isArray(words)) return json({ error: "Couldn't fetch words — try again." }, 502);
  return json({ words: words.slice(0, 4).map(String) });
}

// ---- Shared Claude call ----

// Raw fetch to the Messages API (dependency-free worker, same as Amazing).
// One retry on 429/529/5xx since there's no SDK doing it for us.
async function claudeText(env, prompt, maxTokens) {
  const payload = {
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  };

  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    if (response.status !== 429 && response.status !== 529 && response.status < 500) break;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
  }

  if (response.status === 429) {
    return { error: 'Mirage is busy right now — try again in a minute.', status: 429 };
  }
  const data = await response.json();
  if (!response.ok) {
    console.error('Anthropic API error', response.status, JSON.stringify(data).slice(0, 500));
    return { error: 'The reflection layer hiccuped — try again.', status: 502 };
  }
  // Check stop_reason before reading content — a refusal has empty or partial content.
  if (data.stop_reason === 'refusal') {
    return { error: "That one couldn't be processed — try rewording.", status: 200 };
  }

  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();
  if (!text) return { error: 'The response came back empty — try again.', status: 502 };
  return { text };
}

// ---- Entries ----

// One route covers both writes. Without an id it creates an entry; with an id
// it rewrites that entry's text in place, keeping the original key — and so the
// original created timestamp and the entry's position in the list — while
// stamping a separate `updated` time. An edit never touches the stored
// reflection or note: the reflection is only marked as belonging to an earlier
// draft, and re-running it is a deliberate, separate call to /reflection.
async function handleSaveEntry(body, env) {
  const text = cleanText(body.text, 20000);
  if (!text) return json({ error: 'Nothing to save.' }, 400);

  const editId = typeof body.id === 'string' && body.id ? body.id : null;
  if (editId) {
    if (!ID_PATTERN.test(editId)) return json({ error: 'Bad entry id' }, 400);
    return await editEntry(editId, text, env);
  }

  const reflection = body.reflection && typeof body.reflection === 'object' ? body.reflection : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000).trim() : '';

  // Timestamp-first id makes KV's lexicographic list order chronological;
  // metadata carries what the list view needs so listing never reads bodies.
  const ts = Date.now();
  const id = `${String(ts).padStart(14, '0')}-${crypto.randomUUID().slice(0, 8)}`;
  const date = new Date(ts).toISOString();
  const record = { id, date, updated: null, text, reflection, reflectionStale: false, note };
  await env.ENTRIES.put(`entry:${id}`, JSON.stringify(record), {
    metadata: { date, updated: null, preview: preview(text) },
  });

  return json({ id });
}

async function editEntry(id, text, env) {
  const prev = await readEntry(id, env);
  if (!prev) return json({ error: 'Entry not found' }, 404);

  const textChanged = prev.text !== text;
  const reflection = prev.reflection ?? null;
  // A reflection carried across an edit describes the text as it was before.
  const reflectionStale = reflection ? textChanged || prev.reflectionStale === true : false;

  const updated = new Date().toISOString();
  const record = {
    id: prev.id ?? id,
    date: prev.date, // original created timestamp, never rewritten
    updated,
    text,
    reflection,
    reflectionStale,
    note: prev.note ?? '',
  };
  await env.ENTRIES.put(`entry:${id}`, JSON.stringify(record), {
    metadata: { date: prev.date, updated, preview: preview(text) },
  });

  return json({ id: record.id, updated });
}

// Replace an entry's reflection without touching its text, created date or
// `updated` time — re-reading an entry isn't editing it. The grounding note is
// left alone: it's the writer's own words, not the model's.
async function handleSaveReflection(body, env) {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id || !ID_PATTERN.test(id)) return json({ error: 'Bad entry id' }, 400);
  if (!body.reflection || typeof body.reflection !== 'object') {
    return json({ error: 'No reflection to save.' }, 400);
  }

  const prev = await readEntry(id, env);
  if (!prev) return json({ error: 'Entry not found' }, 404);

  const record = Object.assign({}, prev, {
    reflection: body.reflection,
    reflectionStale: false,
  });
  await env.ENTRIES.put(`entry:${id}`, JSON.stringify(record), {
    metadata: {
      date: prev.date,
      updated: prev.updated ?? null,
      preview: preview(prev.text || ''),
    },
  });

  return json({ id });
}

async function handleEntries(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.ENTRIES.list({ prefix: 'entry:', cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const entries = keys
    .slice(-LIST_LIMIT)
    .reverse() // most recent first
    .map((k) => {
      const meta = k.metadata || {};
      return {
        id: k.name.slice('entry:'.length),
        date: meta.date ?? null,
        updated: meta.updated ?? null,
        preview: meta.preview ?? '',
      };
    });

  return json({ entries });
}

async function handleGetEntry(id, env) {
  if (!id || !ID_PATTERN.test(id)) return json({ error: 'Bad entry id' }, 400);
  const raw = await env.ENTRIES.get(`entry:${id}`);
  if (!raw) return json({ error: 'Entry not found' }, 404);
  return new Response(raw, {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleDelete(body, env) {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id || !ID_PATTERN.test(id)) return json({ error: 'Bad entry id' }, 400);
  await env.ENTRIES.delete(`entry:${id}`);
  return json({ id, deleted: true });
}

async function readEntry(id, env) {
  const raw = await env.ENTRIES.get(`entry:${id}`);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    return record && typeof record === 'object' ? record : null;
  } catch {
    console.error('Stored entry is not JSON', id);
    return null;
  }
}

function preview(text) {
  return text.replace(/\s+/g, ' ').slice(0, 140);
}

// Cap and sanitise free-text input before it reaches a prompt or KV:
// strip control characters (keep newlines and tabs), hard length limit.
function cleanText(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL_CHARS, ' ').trim().slice(0, maxLen);
  return cleaned.length >= 2 ? cleaned : null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
