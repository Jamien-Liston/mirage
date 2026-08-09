// Mirage — vanilla JS port of the React artifact. Views are sections toggled
// by the hidden class; all model output and stored text is rendered via
// textContent / element construction, never innerHTML.

(function () {
  'use strict';

  var WORKER_URL = window.CONFIG.WORKER_URL;
  var VERSION = window.MIRAGE_VERSION;
  var KEY_STORAGE = 'mirage-app-key';
  var DRAFT_STORAGE = 'mirage-draft';
  // An in-progress edit is parked under its own key so it never overwrites the
  // unsaved new-entry draft — cancelling an edit hands that draft straight back.
  var EDIT_STORAGE = 'mirage-edit';

  // ---- element handles ----
  var $ = function (id) { return document.getElementById(id); };
  var views = ['gate', 'write', 'reflect', 'list', 'detail'];

  // ---- state ----
  var currentReflection = null;
  var currentEntry = null;
  // { id, date, original } while the write view is editing a saved entry.
  var editing = null;

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
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
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

  // The write view wears two hats: a new entry (finish -> reflect -> save) or
  // an in-place edit of a saved entry (save changes / cancel, no reflect step,
  // since re-reflecting on an edit is opt-in from the detail view).
  function applyWriteMode() {
    var isEdit = !!editing;
    $('writeDate').textContent = isEdit
      ? 'Editing your entry from ' + fmtDate(editing.date)
      : fmtDate(new Date().toISOString());
    $('finishBtn').classList.toggle('hidden', isEdit);
    $('saveEditBtn').classList.toggle('hidden', !isEdit);
    $('cancelEditBtn').classList.toggle('hidden', !isEdit);
    draftEl.placeholder = isEdit ? 'Say it again, closer to how it was.' : "Start anywhere. Don't polish.";
  }

  function syncDraftButtons() {
    var empty = !draftEl.value.trim();
    $('finishBtn').disabled = empty;
    $('saveEditBtn').disabled = empty;
  }

  function persistDraft() {
    if (editing) {
      localStorage.setItem(EDIT_STORAGE, JSON.stringify({
        id: editing.id,
        date: editing.date,
        original: editing.original,
        text: draftEl.value,
      }));
    } else {
      localStorage.setItem(DRAFT_STORAGE, draftEl.value);
    }
  }

  draftEl.addEventListener('input', function () {
    persistDraft();
    syncDraftButtons();
  });

  $('navWrite').addEventListener('click', function () { show('write'); });
  $('navList').addEventListener('click', function () { openList(); });

  // ---- editing a saved entry ----
  function enterEdit(entry) {
    editing = { id: entry.id, date: entry.date, original: entry.text || '' };
    draftEl.value = entry.text || '';
    persistDraft();
    applyWriteMode();
    syncDraftButtons();
    show('write');
    draftEl.focus();
  }

  // Leave edit mode without writing anything: the saved entry is untouched and
  // the parked new-entry draft comes back exactly as it was.
  function exitEdit() {
    editing = null;
    localStorage.removeItem(EDIT_STORAGE);
    draftEl.value = localStorage.getItem(DRAFT_STORAGE) || '';
    applyWriteMode();
    syncDraftButtons();
  }

  $('cancelEditBtn').addEventListener('click', function () {
    if (!editing) return;
    var id = editing.id;
    var changed = draftEl.value.trim() !== editing.original.trim();
    if (changed && !confirm('Discard your changes to this entry?')) return;
    exitEdit();
    openDetail(id);
  });

  $('saveEditBtn').addEventListener('click', function () {
    if (!editing) return;
    var text = draftEl.value.trim();
    if (!text) return;
    var id = editing.id;
    // Nothing actually changed — don't write, so the entry doesn't pick up a
    // misleading "edited" marker.
    if (text === editing.original.trim()) {
      exitEdit();
      openDetail(id);
      return;
    }
    var btn = $('saveEditBtn');
    btn.disabled = true;
    // Only the id and text go up: the Worker keeps the created date, note and
    // reflection, and marks the reflection as belonging to an earlier draft.
    api('/entry', { method: 'POST', body: JSON.stringify({ id: id, text: text }) })
      .then(function () {
        exitEdit();
        openDetail(id);
      })
      .catch(function () {
        alert("Couldn't save your changes — check your connection and try again.");
      })
      .then(function () { btn.disabled = !draftEl.value.trim(); });
  });

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
          var dateRow = el('p', 'entry-date');
          dateRow.appendChild(el('span', null, entry.date ? fmtShort(entry.date) : ''));
          if (entry.updated) dateRow.appendChild(el('span', 'edited-flag', 'edited'));
          card.appendChild(dateRow);
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
  function renderDetail(entry) {
    $('detailDate').textContent = fmtDate(entry.date);
    $('detailEdited').textContent = entry.updated ? 'Edited ' + fmtDateTime(entry.updated) : '';
    $('detailEdited').classList.toggle('hidden', !entry.updated);
    $('detailText').textContent = entry.text;
    $('detailStale').classList.toggle('hidden', !(entry.reflection && entry.reflectionStale));
    renderReflection($('detailReflection'), entry.reflection, { note: entry.note });
  }

  function openDetail(id) {
    show('detail');
    currentEntry = null;
    $('detailDate').textContent = '';
    $('detailEdited').classList.add('hidden');
    $('detailText').textContent = 'Loading…';
    $('detailStale').classList.add('hidden');
    $('detailReflection').textContent = '';
    api('/entry?id=' + encodeURIComponent(id), {})
      .then(function (entry) {
        currentEntry = entry;
        renderDetail(entry);
      })
      .catch(function () {
        $('detailText').textContent = "Couldn't load this entry.";
      });
  }
  $('backBtn').addEventListener('click', openList);

  $('editBtn').addEventListener('click', function () {
    if (!currentEntry) return;
    enterEdit(currentEntry);
  });

  $('deleteBtn').addEventListener('click', function () {
    if (!currentEntry) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    var id = currentEntry.id;
    api('/delete', { method: 'POST', body: JSON.stringify({ id: id }) })
      .then(function () {
        // Don't leave a parked edit pointing at an entry that's gone.
        if (editing && editing.id === id) exitEdit();
        openList();
      })
      .catch(function () {
        alert("Couldn't delete the entry — try again.");
      });
  });

  // Re-run the reflection on the entry as it stands now. Only ever from this
  // button — saving an edit never triggers it.
  $('rerunBtn').addEventListener('click', function () {
    if (!currentEntry) return;
    var entry = currentEntry;
    var btn = $('rerunBtn');
    btn.disabled = true;
    btn.textContent = 'Reading it back…';
    api('/reflect', { method: 'POST', body: JSON.stringify({ text: entry.text }) })
      .then(function (data) {
        return api('/reflection', {
          method: 'POST',
          body: JSON.stringify({ id: entry.id, reflection: data.reflection }),
        }).then(function () {
          entry.reflection = data.reflection;
          entry.reflectionStale = false;
          if (currentEntry === entry) renderDetail(entry);
        });
      })
      .catch(function () {
        alert("Couldn't run the reflection — try again.");
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Reflect on it again';
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
  // An edit interrupted by a reload picks up where it left off; the entry it
  // came from is still untouched on the server until Save changes.
  var parkedEdit = null;
  try {
    parkedEdit = JSON.parse(localStorage.getItem(EDIT_STORAGE) || 'null');
  } catch (e) {
    parkedEdit = null;
  }
  if (parkedEdit && parkedEdit.id && parkedEdit.date) {
    editing = { id: parkedEdit.id, date: parkedEdit.date, original: parkedEdit.original || '' };
    draftEl.value = parkedEdit.text || '';
  }
  applyWriteMode();
  syncDraftButtons();

  // Same constant the service worker builds its cache name from, so what's on
  // screen is always the shell you're actually running.
  $('versionTag').textContent = VERSION ? 'Mirage v' + VERSION : '';
  if (localStorage.getItem(KEY_STORAGE)) {
    show('write');
  } else {
    show('gate');
  }
})();
