/* Grejs_Bane_Byg – fælles UI-hjælpere: ikoner, tal, beskeder og dialoger. */
window.GBS = window.GBS || {};
(function (GBS) {
  'use strict';

  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    dots: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
    undo: '<path d="M8 5L4 9l4 4"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    redo: '<path d="M16 5l4 4-4 4"/><path d="M20 9H10a6 6 0 000 12h3"/>',
    select: '<path d="M6 3l13 9-6 1.5L10 20z"/>',
    add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    draw: '<path d="M4 19c4-9 7 1 10-5s2-8 6-9" stroke-dasharray="3 3"/><circle cx="4" cy="19" r="1.6" fill="currentColor"/><circle cx="20" cy="5" r="1.6" fill="currentColor"/>',
    free: '<path d="M3 17c3-7 5-9 7-5s3 6 5 2 3-7 6-8"/>',
    points: '<path d="M5 18l6-10 8 4"/><circle cx="5" cy="18" r="2.2" fill="currentColor"/><circle cx="11" cy="8" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/>',
    rotl: '<path d="M4 4v6h6"/><path d="M4.5 10A8 8 0 1112 20"/>',
    rotr: '<path d="M20 4v6h-6"/><path d="M19.5 10A8 8 0 1012 20"/>',
    flip: '<path d="M7 4L3 8l4 4"/><path d="M3 8h13a5 5 0 015 5"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8a5 5 0 01-5-5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4V6a2 2 0 012-2h9v1"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M4 4l16 16"/><path d="M9.5 5.4A9.7 9.7 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6 7.3A17 17 0 002 12s4 7 10 7a9.7 9.7 0 004.3-1"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>',
    upload: '<path d="M12 16V5M7 9l5-5 5 5M4 20h16"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
    print: '<path d="M7 8V3h10v5M7 17H4v-7a2 2 0 012-2h12a2 2 0 012 2v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    warning: '<path d="M12 4L2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17v.1"/>',
    vertical: '<path d="M12 2v20" stroke-width="4" stroke-linecap="butt"/><path d="M12 8.5v2M12 13.5v2" stroke="#fff" stroke-width="2.6" stroke-linecap="butt"/><path d="M5 12h14M16 9l3.5 3-3.5 3" stroke="#d81f26"/>',
    oxer: '<path d="M8.5 2v20M15 2v20" stroke-width="3.4" stroke-linecap="butt"/><path d="M8.5 7.5v2M8.5 14.5v2M15 7.5v2M15 14.5v2" stroke="#fff" stroke-width="2.2" stroke-linecap="butt"/><path d="M2.5 12h19M18.5 9l3.5 3-3.5 3" stroke="#d81f26"/>',
    pole: '<path d="M12 3v18" stroke-width="2.2"/><path d="M5 12h14M16 9l3.5 3-3.5 3" stroke="#d81f26"/>',
    start: '<path d="M6 21V4"/><path d="M6 4l12 4.5L6 13z" fill="#f2ab00"/>',
    finish: '<path d="M6 21V4"/><path d="M6 4h13v9H6z"/><path d="M6 8.5h13M10.3 4v9M14.6 4v9"/>',
    change: '<rect x="3" y="6" width="18" height="12" rx="6" fill="#f2ab00"/><path d="M7 12h10"/>',
    judge: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c0-5 3-8 7-8s7 3 7 8"/>',
    gate: '<path d="M3 21V7M21 21V7M3 7h5M16 7h5"/><path d="M12 3v11M8.5 10.5L12 14l3.5-3.5" stroke="#0b6e99"/>',
    hall: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M8 10v4M15 10v4M16.8 10v4"/>',
    arrow: '<path d="M4 12h15M14 7l5 5-5 5" stroke="#d81f26"/>',
    route: '<path d="M6 19h9a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h9"/>',
    smooth: '<path d="M4 18C6 6 18 18 20 6"/>',
    grid: '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>',
  };

  function icon(name) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* Accepterer både 60,5 og 60.5. Returnerer NaN ved ugyldigt tal. */
  function parseNum(v) {
    const s = String(v == null ? '' : v).trim().replace(/\s/g, '');
    if (!/^-?\d+([.,]\d+)?$/.test(s)) return NaN;
    return parseFloat(s.replace(',', '.'));
  }

  function fmtNum(n, decimals) {
    return Number(n).toLocaleString('da-DK', { maximumFractionDigits: decimals == null ? 1 : decimals });
  }

  function fmtDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /* ---------- Beskeder ---------- */
  let toastTimer = null;
  function toast(msg, kind) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast ' + (kind || ''); }, kind === 'error' ? 6000 : 2800);
  }

  /* ---------- Dialoger ---------- */

  /* Åbner en modal. actions: [{label, value, kind, icon}]. Lukning uden valg giver null. */
  function openDialog(opts) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'dlg' + (opts.sheet ? ' dlg-sheet' : '') + (opts.className ? ' ' + opts.className : '');
      const actions = (opts.actions || []).map((a, i) =>
        '<button type="button" class="btn ' + (a.kind || '') + '" data-i="' + i + '">' + (a.icon ? icon(a.icon) : '') + '<span>' + esc(a.label) + '</span></button>').join('');
      d.innerHTML =
        '<div class="dlg-head"><h2>' + esc(opts.title || '') + '</h2>' +
        '<button type="button" class="iconbtn dlg-x" aria-label="Luk">' + icon('close') + '</button></div>' +
        '<div class="dlg-body"></div>' +
        (actions ? '<div class="dlg-actions' + ((opts.actions || []).length > 2 ? ' stack' : '') + '">' + actions + '</div>' : '');
      const body = d.querySelector('.dlg-body');
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (opts.onClose) opts.onClose(value);
        d.close();
        d.remove();
        resolve(value);
      };
      d.querySelector('.dlg-x').addEventListener('click', () => finish(null));
      d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      d.addEventListener('click', (e) => {
        const btn = e.target.closest('.dlg-actions .btn');
        if (btn) {
          const a = opts.actions[+btn.dataset.i];
          if (a.validate && !a.validate(d)) return;
          finish(a.value !== undefined ? (typeof a.value === 'function' ? a.value(d) : a.value) : null);
        } else if (e.target === d) {
          finish(null);
        }
      });
      document.body.appendChild(d);
      d.tabIndex = -1;
      d.showModal();
      d.focus(); /* Ellers får luk-knappen fokus og en synlig ring ved åbning */
      if (opts.onOpen) opts.onOpen(d, finish);
    });
  }

  function confirmDialog(title, message, confirmLabel, danger) {
    return openDialog({
      title,
      body: '<p>' + esc(message) + '</p>',
      actions: [
        { label: 'Annullér', value: false, kind: 'ghost' },
        { label: confirmLabel || 'OK', value: true, kind: danger ? 'danger' : 'primary' },
      ],
    }).then((v) => !!v);
  }

  /* fields: [{name, label, value, type:'text'|'decimal', suffix, placeholder, maxlength}], validate(values) -> fejltekst|null */
  function formDialog(opts) {
    const fieldsHtml = opts.fields.map((f) =>
      '<label class="field"><span>' + esc(f.label) + '</span><span class="field-input">' +
      '<input name="' + esc(f.name) + '" value="' + esc(f.value == null ? '' : f.value) + '" autocomplete="off"' +
      (f.type === 'decimal' ? ' inputmode="decimal"' : '') +
      (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
      ' maxlength="' + (f.maxlength || 60) + '">' +
      (f.suffix ? '<em>' + esc(f.suffix) + '</em>' : '') + '</span></label>').join('');
    const read = (d) => {
      const out = {};
      d.querySelectorAll('input[name]').forEach((i) => { out[i.name] = i.value; });
      return out;
    };
    return openDialog({
      title: opts.title,
      body: '<form class="form" novalidate>' + (opts.intro ? '<p>' + esc(opts.intro) + '</p>' : '') + fieldsHtml + '<p class="form-err" role="alert" hidden></p></form>',
      actions: [
        { label: 'Annullér', value: null, kind: 'ghost' },
        {
          label: opts.submitLabel || 'Gem', kind: 'primary', value: read,
          validate: (d) => {
            const err = opts.validate ? opts.validate(read(d)) : null;
            const p = d.querySelector('.form-err');
            p.hidden = !err;
            p.textContent = err || '';
            return !err;
          },
        },
      ],
      onOpen: (d) => {
        const first = d.querySelector('input[name]');
        d.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          d.querySelector('.dlg-actions .primary').click();
        });
        d.querySelectorAll('input[name]').forEach((i) => i.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); d.querySelector('.dlg-actions .primary').click(); }
        }));
        if (first && opts.autofocus !== false) { first.focus(); first.select(); }
      },
    });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function safeFilename(s) {
    return String(s || 'bane').replace(/[^\wæøåÆØÅ\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'bane';
  }

  GBS.UI = { icon, esc, parseNum, fmtNum, fmtDate, clamp, toast, openDialog, confirmDialog, formDialog, download, safeFilename };
})(window.GBS);
