// Mirage — vanilla JS port of the React artifact. Views are sections toggled
// by the hidden class; all model output and stored text is rendered via
// textContent / element construction, never innerHTML.

(function () {
  'use strict';

  var WORKER_URL = window.CONFIG.WORKER_URL;
  var VERSION = window.MIRAGE_VERSION;
  var KEY_STORAGE = 'mirage-app-key';
  var DRAFT_STORAGE = 'mirage-draft';

  // ---- element handles ----
  var $ = function (id) { return document.getElementById(id); };
  var views = ['gate', 'write', 'reflect', 'list', 'detail'];

  // ---- state ----
  var currentReflection = null;
  var currentEntry = null;

  // ---- time-of-day horizon ----
  function horizonStops(hour) {
    if (hour >= 5 && hour < 8) return ['#3B3663', '#9C6B8A', '#E8B48A'];   // dawn
    if (hour >= 8 && hour < 17) return ['#5C6B9E', '#A8B4CE', '#EFE3C8']; // day
    if (hour >= 17 && hour < 20) return ['#2E2A4F', '#B4667E', '#E8A87C']; // dusk
    return ['#1C1A33', '#3B3663', '#6E5C7E'];                              // night
  }
  function paintHorizon() {
    var s = horizonStops(new Date().getHours());
    $('horizon').style.background =
      'linear-gradient(to bottom, ' + s[0] + ' 0%, ' + s[1] + ' 62%, ' + s[2] + ' 100%)';
  }

  // ---- view switching ----
  function show(view) {
    views.forEach(function (v) { $(v).classList.toggle('hidden', v !== view); });
    $('horizon').classList.toggle('compact', view !== 'write' && view !== 'gate');
    $('topnav').classList.toggle('hidden', view === 'gate');
    $('navWrite').classList.toggle('active', view === 'write' || view === 'reflect');
    $('navList').classList.toggle('active', view === 'list' || view === 'detail');
    paintHorizon();
  }

  // ---- API ----
  function api(path, options) {
    options = options || {};
    options.headers = Object.assign(
      { 'x-app-key': localStorage.getItem(KEY_STORAGE) || '' },
      options.body ? { 'Content-Type': 'application/json' } : {},
      options.headers || {}
    );
    return fetch(WORKER_URL + path, options).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem(KEY_STORAGE);
        show('gate');
        throw new Error('unauthorised');
      }
      return res.json().then(function (data) {
        if (!res.ok || data.error) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  // ---- date formatting ----
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }
  function fmtShort(iso) {
    return new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  // ---- DOM builders ----
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Render a reflection into a container. When editable, the grounding check
  // gets a note textarea; otherwise a saved note renders as read-only text.
  function renderReflection(container, data, opts) {
    container.textContent = '';
    if (!data) return;
    opts = opts || {};

    function listCard(labelText, items) {
      if (!items || !items.length) return;
      var card = el('div', 'card');
      card.appendChild(el('div', 'label', labelText));
      items.forEach(function (x) { card.appendChild(el('p', null, String(x))); });
      container.appendChild(card);
    }
    listCard('Went well', data.wentWell);
    listCard("Could've been better", data.couldBeBetter);

    if (data.criticism) {
      var card = el('div', 'card grounding');
      card.appendChild(el('div', 'label', 'Grounding check'));
      card.appendChild(el('p', 'quote', '"' + data.criticism.quote + '"'));
      card.appendChild(el('p', null, data.criticism.question));
      if (opts.editable) {
        var ta = el('textarea', 'note-input');
        ta.rows = 2;
        ta.placeholder = 'Sit with it for a second — is it grounded?';
        ta.id = 'groundingNote';
        card.appendChild(ta);
      } else if (opts.note) {
        card.appendChild(el('p', null, opts.note));
      }
      container.appendChild(card);
    }

    if (data.vocab && data.vocab.length) {
      var vc = el('div', 'card');
      vc.appendChild(el('div', 'label', 'Words you leaned on'));
      data.vocab.forEach(function (v) {
        var item = el('div', 'vocab-item');
        item.appendChild(el('span', 'vocab-word', v.word));
        if (v.count > 1) item.appendChild(el('span', 'vocab-count', '×' + v.count));
        var chips = el('div', 'chips');
        (v.alternatives || []).forEach(function (a) {
          chips.appendChild(el('span', 'chip alt', String(a)));
        });
        item.appendChild(chips);
        vc.appendChild(item);
      });
      container.appendChild(vc);
    }
  }

  // ---- gate ----
  function tryGate() {
    var value = $('gateInput').value.trim();
    if (!value) return;
    localStorage.setItem(KEY_STORAGE, value);
    $('gateError').classList.add('hidden');
    // Cheap authenticated call to verify the passphrase before letting them in.
    api('/entries', {}).then(function () {
      show('write');
    }).catch(function () {
      $('gateError').classList.remove('hidden');
    });
  }
  $('gateGo').addEventListener('click', tryGate);
  $('gateInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') tryGate();
  });

  // ---- write ----
  var draftEl = $('draft');
  draftEl.value = localStorage.getItem(DRAFT_STORAGE) || '';
  function syncDraftButtons() {
    $('finishBtn').disabled = !draftEl.value.trim();
  }
  draftEl.addEventListener('input', function () {
    localStorage.setItem(DRAFT_STORAGE, draftEl.value);
    syncDraftButtons();
  });
  syncDraftButtons();

  $('navWrite').addEventListener('click', function () { show('write'); });
  $('navList').addEventListener('click', function () { openList(); });

  // ---- reflect ----
  function finishWriting() {
    var text = draftEl.value.trim();
    if (!text) return;
    show('reflect');
    currentReflection = null;
    $('reflectBody').textContent = '';
    $('reflectBusy').classList.remove('hidden');
    $('reflectError').classList.add('hidden');
    $('reflectActions').classList.add('hidden');

    api('/reflect', { method: 'POST', body: JSON.stringify({ text: text }) })
      .then(function (data) {
        currentReflection = data.reflection;
        $('reflectBusy').classList.add('hidden');
        renderReflection($('reflectBody'), currentReflection, { editable: true });
        $('reflectActions').classList.remove('hidden');
      })
      .catch(function () {
        $('reflectBusy').classList.add('hidden');
        $('reflectError').classList.remove('hidden');
      });
  }
  $('finishBtn').addEventListener('click', finishWriting);
  $('retryBtn').addEventListener('click', finishWriting);
  $('keepWritingBtn').addEventListener('click', function () { show('write'); });

  function saveEntry() {
    var noteEl = $('groundingNote');
    var payload = {
      text: draftEl.value.trim(),
      reflection: currentReflection,
      note: noteEl ? noteEl.value.trim() : '',
    };
    var btn = $('saveBtn');
    btn.disabled = true;
    api('/entry', { method: 'POST', body: JSON.stringify(payload) })
      .then(function () {
        draftEl.value = '';
        localStorage.removeItem(DRAFT_STORAGE);
        syncDraftButtons();
        currentReflection = null;
        openList();
      })
      .catch(function () {
        alert("Couldn't save the entry — check your connection and try again.");
      })
      .then(function () { btn.disabled = false; });
  }
  $('saveBtn').addEventListener('click', saveEntry);
  $('saveNoReflBtn').addEventListener('click', saveEntry);

  // ---- list ----
  function openList() {
    show('list');
    $('listBody').textContent = '';
    $('listEmpty').classList.add('hidden');
    $('listBusy').classList.remove('hidden');
    api('/entries', {})
      .then(function (data) {
        $('listBusy').classList.add('hidden');
        if (!data.entries.length) {
          $('listEmpty').classList.remove('hidden');
          return;
        }
        data.entries.forEach(function (entry) {
          var card = el('div', 'card clickable');
          card.setAttribute('role', 'button');
          card.tabIndex = 0;
          card.appendChild(el('p', 'entry-date', entry.date ? fmtShort(entry.date) : ''));
          card.appendChild(el('p', 'entry-preview', entry.preview));
          function open() { openDetail(entry.id); }
          card.addEventListener('click', open);
          card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') open();
          });
          $('listBody').appendChild(card);
        });
      })
      .catch(function () {
        $('listBusy').classList.add('hidden');
        var msg = el('p', 'error', "Couldn't load entries — try again.");
        $('listBody').appendChild(msg);
      });
  }
  $('firstEntryBtn').addEventListener('click', function () { show('write'); });

  // ---- detail ----
  function openDetail(id) {
    show('detail');
    currentEntry = null;
    $('detailDate').textContent = '';
    $('detailText').textContent = 'Loading…';
    $('detailReflection').textContent = '';
    api('/entry?id=' + encodeURIComponent(id), {})
      .then(function (entry) {
        currentEntry = entry;
        $('detailDate').textContent = fmtDate(entry.date);
        $('detailText').textContent = entry.text;
        renderReflection($('detailReflection'), entry.reflection, { note: entry.note });
      })
      .catch(function () {
        $('detailText').textContent = "Couldn't load this entry.";
      });
  }
  $('backBtn').addEventListener('click', openList);

  $('deleteBtn').addEventListener('click', function () {
    if (!currentEntry) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    api('/delete', { method: 'POST', body: JSON.stringify({ id: currentEntry.id }) })
      .then(openList)
      .catch(function () {
        alert("Couldn't delete the entry — try again.");
      });
  });

  // ---- word lookup drawer ----
  var lookupInput = $('lookupInput');
  function openLookup() {
    $('lookupOverlay').classList.remove('hidden');
    $('lookupError').classList.add('hidden');
    $('lookupWords').textContent = '';
    lookupInput.focus();
  }
  function closeLookup() { $('lookupOverlay').classList.add('hidden'); }
  $('lookupOpen').addEventListener('click', openLookup);
  $('lookupClose').addEventListener('click', closeLookup);
  $('lookupOverlay').addEventListener('click', function (e) {
    if (e.target === $('lookupOverlay')) closeLookup();
  });
  lookupInput.addEventListener('input', function () {
    $('lookupGo').disabled = !lookupInput.value.trim();
  });
  $('lookupGo').addEventListener('click', function () {
    var reaching = lookupInput.value.trim();
    if (!reaching) return;
    var btn = $('lookupGo');
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    $('lookupError').classList.add('hidden');
    $('lookupWords').textContent = '';
    api('/words', { method: 'POST', body: JSON.stringify({ reaching: reaching }) })
      .then(function (data) {
        data.words.forEach(function (w) {
          $('lookupWords').appendChild(el('span', 'chip', w));
        });
      })
      .catch(function () {
        $('lookupError').classList.remove('hidden');
      })
      .then(function () {
        btn.textContent = 'Find words';
        btn.disabled = !lookupInput.value.trim();
      });
  });

  // ---- boot ----
  $('writeDate').textContent = fmtDate(new Date().toISOString());
  // Same constant the service worker builds its cache name from, so what's on
  // screen is always the shell you're actually running.
  $('versionTag').textContent = VERSION ? 'Mirage v' + VERSION : '';
  if (localStorage.getItem(KEY_STORAGE)) {
    show('write');
  } else {
    show('gate');
  }
})();
