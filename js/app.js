/* Grejs_Bane_Byg – skærmbilleder og navigation: startside, ridehal og indstillinger.
   Navigationen bruger location.hash, så telefonens tilbage-knap og genindlæsning virker. */
(function (GBS) {
  'use strict';

  const { UI, Store, Scene, Editor } = GBS;
  const { icon, esc, fmtNum, parseNum, toast } = UI;

  const app = document.getElementById('app');
  const MIN_SIZE = 5;
  const MAX_SIZE = 500;

  const sizeText = (h) => fmtNum(h.length) + ' × ' + fmtNum(h.width) + ' m';
  const courseWord = (n) => n + (n === 1 ? ' bane' : ' baner');

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  /* ---------- Ridehal: opret og redigér ---------- */

  function hallFields(h) {
    return [
      { name: 'name', label: 'Navn på ridehallen', value: h ? h.name : '', placeholder: 'F.eks. Ikasthallen' },
      { name: 'length', label: 'Længde', type: 'decimal', value: h ? fmtNum(h.length, 2) : '', suffix: 'meter', placeholder: '60,0', maxlength: 8 },
      { name: 'width', label: 'Bredde', type: 'decimal', value: h ? fmtNum(h.width, 2) : '', suffix: 'meter', placeholder: '20,0', maxlength: 8 },
    ];
  }

  function validateHall(v) {
    if (!v.name.trim()) return 'Skriv et navn på ridehallen.';
    const l = parseNum(v.length);
    const w = parseNum(v.width);
    if (isNaN(l) || isNaN(w)) return 'Skriv længde og bredde som tal, f.eks. 60,0.';
    if (l < MIN_SIZE || w < MIN_SIZE || l > MAX_SIZE || w > MAX_SIZE) return 'Længde og bredde skal være mellem ' + MIN_SIZE + ' og ' + MAX_SIZE + ' meter.';
    return null;
  }

  function createHallFlow() {
    UI.formDialog({
      title: 'Opret ny ridehal',
      fields: hallFields(null),
      submitLabel: 'Opret og byg bane',
      validate: validateHall,
    }).then((v) => {
      if (!v) return;
      const hall = Store.createHall(v.name.trim(), parseNum(v.length), parseNum(v.width));
      const course = Store.createCourse(hall);
      go('#/bane/' + hall.id + '/' + course.id);
    });
  }

  function editHallFlow(hall) {
    UI.formDialog({
      title: 'Rediger ridehal',
      fields: hallFields(hall),
      autofocus: false,
      validate: validateHall,
    }).then(async (v) => {
      if (!v) return;
      const length = parseNum(v.length);
      const width = parseNum(v.width);
      let moveInside = false;
      const outside = Store.countOutside(hall, length, width);
      if (outside) {
        const choice = await UI.openDialog({
          title: 'Elementer ender uden for banen',
          body: '<p>Med de nye mål vil ' + outside + (outside === 1 ? ' element' : ' elementer') + ' ligge uden for hallen. Intet bliver slettet.</p>',
          actions: [
            { label: 'Skub dem ind på banen', value: 'move', kind: 'primary' },
            { label: 'Behold placeringen', value: 'keep', kind: 'secondary' },
            { label: 'Annullér', value: null, kind: 'ghost' },
          ],
        });
        if (!choice) return;
        moveInside = choice === 'move';
      }
      hall.name = v.name.trim();
      Store.resizeHall(hall, length, width, moveInside);
      route();
    });
  }

  async function deleteHallFlow(hall) {
    const n = hall.courses.length;
    const ok = await UI.confirmDialog('Slet ' + hall.name + '?', 'Ridehallen og ' + (n === 1 ? 'dens ene bane' : 'dens ' + n + ' baner') + ' slettes permanent fra denne browser.', 'Slet ridehal', true);
    if (!ok) return;
    Store.deleteHall(hall);
    go('#/');
  }

  /* ---------- Baner ---------- */

  function renameCourseFlow(course) {
    UI.formDialog({
      title: 'Omdøb bane',
      fields: [{ name: 'name', label: 'Banens navn', value: course.name }],
      validate: (v) => (v.name.trim() ? null : 'Skriv et navn.'),
    }).then((v) => {
      if (!v) return;
      course.name = v.name.trim();
      Store.touchCourse(course);
      route();
    });
  }

  function courseMenu(hall, course) {
    UI.openDialog({
      title: course.name,
      sheet: true,
      actions: [
        { label: 'Omdøb', value: 'rename', kind: 'secondary', icon: 'edit' },
        { label: 'Kopier', value: 'copy', kind: 'secondary', icon: 'copy' },
        { label: 'Slet', value: 'delete', kind: 'danger', icon: 'trash' },
      ],
    }).then(async (v) => {
      if (v === 'rename') renameCourseFlow(course);
      else if (v === 'copy') {
        Store.duplicateCourse(hall, course);
        toast('Banen er kopieret.');
        route();
      } else if (v === 'delete') {
        const ok = await UI.confirmDialog('Slet ' + course.name + '?', 'Banen slettes permanent fra denne browser.', 'Slet bane', true);
        if (!ok) return;
        Store.deleteCourse(hall, course);
        route();
      }
    });
  }

  function thumb(hall, course) {
    return Scene.standalone(hall, course, { rot: hall.length >= hall.width ? 0 : 90, grid: false, label: course ? 'Tegning af ' + course.name : 'Tegning af ' + hall.name }).svg;
  }

  /* ---------- Skærmbilleder ---------- */

  function brandHeader(right) {
    return '<header class="topbar"><a class="brand" href="#/"><span class="brand-mark" aria-hidden="true">' + brandMark() + '</span><span>Grejs_Bane_Byg</span></a>' + (right || '') + '</header>';
  }

  function brandMark() {
    return '<svg viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="8" fill="#1f4d3a"/><path d="M12 7v18M20 7v18" stroke="#fff" stroke-width="3"/><path d="M12 7v4M20 7v4M12 15v4M20 15v4" stroke="#111" stroke-width="3"/><path d="M5 16h19M20.5 12l5.5 4-5.5 4" fill="none" stroke="#ff4d52" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function renderHome() {
    const halls = Store.state.halls;
    let list;
    if (!halls.length) {
      list = '<section class="empty"><div class="empty-art">' + Scene.standalone({ length: 60, width: 20 }, demoCourse(), { rot: 0, label: 'Eksempel på en springbane' }).svg + '</div>' +
        '<h2>Byg din første springbane</h2><p>Opret en ridehal med dine egne mål. Derefter kan du gemme lige så mange baner i den, du har lyst til.</p>' +
        '<button type="button" class="btn primary big" data-a="newHall">' + icon('plus') + '<span>Opret ny ridehal</span></button></section>';
    } else {
      list = '<div class="section-head"><h1>Dine ridehaller</h1><button type="button" class="btn primary" data-a="newHall">' + icon('plus') + '<span>Ny ridehal</span></button></div>' +
        '<div class="cards">' + halls.map((h) => {
          const newest = h.courses.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
          return '<a class="card" href="#/hal/' + esc(h.id) + '"><div class="card-art">' + thumb(h, newest) + '</div><div class="card-text"><strong>' + esc(h.name) + '</strong><small>' + sizeText(h) + ' · ' + courseWord(h.courses.length) + '</small></div></a>';
        }).join('') + '</div>';
    }
    app.innerHTML = '<div class="page">' + brandHeader('<a class="iconbtn" href="#/indstillinger" aria-label="Indstillinger" title="Indstillinger">' + icon('settings') + '</a>') +
      '<main class="content">' + list + '<p class="footnote">Banerne gemmes kun i denne browser på denne enhed. De synkroniseres ikke mellem telefon og computer.</p></main></div>';
    app.querySelectorAll('[data-a="newHall"]').forEach((b) => b.addEventListener('click', createHallFlow));
  }

  /* Eksempel til den tomme startside, så man kan se, hvad appen laver. */
  function demoCourse() {
    const jump = (type, x, y, rotation, number) => ({
      type, x, y, rotation, number, width: 3.8, depth: type === 'oxer' ? 1.2 : 0, showNumber: true, showArrow: true,
    });
    const route = [[41.5, 12.7], [44.8, 9.6], [50, 4.5], [56.5, 2.6], [59, 8], [55, 15], [49, 18], [42.4, 18], [28, 17.5], [18, 13], [13.6, 8.2], [11, 2.5], [6, 2], [2, 9], [5, 17], [12, 16.5], [22.8, 7.7], [32, 1.8], [40, 9.4], [47, 16], [42.4, 18], [39.8, 17.9]];
    return {
      obstacles: [
        jump('oxer', 44.8, 9.6, 315, '1'), jump('vertical', 42.4, 18, 180, '2/8'), jump('oxer', 13.6, 8.2, 240, '3'),
        jump('oxer', 22.8, 7.7, 315, '4'), jump('vertical', 40, 9.4, 240, '5'), jump('oxer', 17.7, 2, 180, '6'), jump('oxer', 35, 9.5, 315, '7'),
      ],
      markers: { start: { x: 41.3, y: 13.3 }, finish: { x: 37.4, y: 17.9 }, judge: { side: 'left', pos: 10 }, entrance: { side: 'bottom', pos: 47.5, linked: true }, exit: null },
      paths: [{ points: route.map((p) => ({ x: p[0], y: p[1] })), smooth: true, style: 'dashed', width: 0.6, color: '#5f6368', arrows: false }],
      view: { symbolScale: 1 },
    };
  }

  function renderHall(hall) {
    const courses = hall.courses;
    const cards = courses.map((c) =>
      '<div class="card course-card"><a class="card-link" href="#/bane/' + esc(hall.id) + '/' + esc(c.id) + '"><div class="card-art">' + thumb(hall, c) + '</div>' +
      '<div class="card-text"><strong>' + esc(c.name) + '</strong><small>' + c.obstacles.length + ' spring · ' + UI.fmtDate(c.updatedAt) + '</small></div></a>' +
      '<button type="button" class="iconbtn card-menu" data-course="' + esc(c.id) + '" aria-label="Flere valg for ' + esc(c.name) + '">' + icon('dots') + '</button></div>').join('');
    app.innerHTML = '<div class="page">' +
      '<header class="topbar"><a class="iconbtn" href="#/" aria-label="Til oversigten">' + icon('back') + '</a><div class="topbar-title"><h1>' + esc(hall.name) + '</h1><small>' + sizeText(hall) + '</small></div>' +
      '<button type="button" class="iconbtn" data-a="edit" aria-label="Rediger ridehal" title="Rediger ridehal">' + icon('edit') + '</button>' +
      '<button type="button" class="iconbtn" data-a="delete" aria-label="Slet ridehal" title="Slet ridehal">' + icon('trash') + '</button></header>' +
      '<main class="content"><div class="section-head"><h2>' + courseWord(courses.length) + '</h2><button type="button" class="btn primary" data-a="newCourse">' + icon('plus') + '<span>Ny bane</span></button></div>' +
      (courses.length ? '<div class="cards">' + cards + '</div>' : '<div class="empty small"><p>Der er ingen baner i denne ridehal endnu.</p></div>') +
      '</main></div>';
    app.querySelector('[data-a="edit"]').addEventListener('click', () => editHallFlow(hall));
    app.querySelector('[data-a="delete"]').addEventListener('click', () => deleteHallFlow(hall));
    app.querySelector('[data-a="newCourse"]').addEventListener('click', () => {
      const course = Store.createCourse(hall);
      go('#/bane/' + hall.id + '/' + course.id);
    });
    app.querySelectorAll('[data-course]').forEach((b) => b.addEventListener('click', () => {
      courseMenu(hall, Store.getCourse(hall, b.dataset.course));
    }));
  }

  function outsideNotice(hall, course) {
    const out = (p) => p.x < 0 || p.y < 0 || p.x > hall.length || p.y > hall.width;
    const n = course.obstacles.filter(out).length + Store.FREE_MARKERS.filter((k) => course.markers[k] && out(course.markers[k])).length;
    if (n) toast(n + (n === 1 ? ' element ligger' : ' elementer ligger') + ' uden for hallens mål.');
  }

  function renderEditor(hall, course) {
    Editor.open(hall, course, app);
    outsideNotice(hall, course);
  }

  /* ---------- Indstillinger ---------- */

  function renderSettings() {
    const s = Store.settings;
    const kb = Store.storageBytes() / 1024;
    const sw = (name, on) => '<button type="button" class="switch ' + (on ? 'on' : '') + '" role="switch" aria-checked="' + !!on + '" data-setting="' + name + '"><i></i></button>';
    app.innerHTML = '<div class="page">' +
      '<header class="topbar"><a class="iconbtn" href="#/" aria-label="Til oversigten">' + icon('back') + '</a><div class="topbar-title"><h1>Indstillinger</h1></div></header>' +
      '<main class="content narrow">' +
      '<section class="panel"><h2>Backup</h2>' +
      '<p>Dine baner ligger kun i denne browser på denne enhed (' + fmtNum(kb, 1) + ' kB). Lav en backup, hvis du vil flytte dem til en anden enhed eller sikre dem.</p>' +
      '<div class="panel-actions"><button type="button" class="btn secondary" data-a="export">' + icon('download') + '<span>Eksportér backup</span></button>' +
      '<button type="button" class="btn secondary" data-a="import">' + icon('upload') + '<span>Importér backup</span></button>' +
      '<input type="file" accept=".json,application/json" data-a="file" hidden></div></section>' +
      '<section class="panel"><h2>Nye baner</h2>' +
      '<div class="row-field"><span class="row-label">Vis målegitter</span>' + sw('defaultGrid', s.defaultGrid) + '</div>' +
      '<div class="row-field"><span class="row-label">Fastgør til gitter (snap)</span>' + sw('defaultSnap', s.defaultSnap) + '</div>' +
      '<div class="row-field"><span class="row-label">Automatisk nummerering</span>' + sw('defaultAutoNumber', s.defaultAutoNumber) + '</div></section>' +
      '<section class="panel"><h2>Hjælp</h2>' + helpHtml() +
      '<div class="panel-actions"><button type="button" class="btn secondary" data-a="intro">' + icon('help') + '<span>Vis introduktionen igen</span></button></div></section>' +
      '<section class="panel"><h2>Slet data</h2><p>Sletter alle ridehaller og baner fra denne browser.</p>' +
      '<div class="panel-actions"><button type="button" class="btn danger" data-a="wipe">' + icon('trash') + '<span>Slet alt</span></button></div></section>' +
      '</main></div>';
    app.querySelector('[data-a="export"]').addEventListener('click', exportBackup);
    const file = app.querySelector('[data-a="file"]');
    app.querySelector('[data-a="import"]').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (file.files[0]) importBackup(file.files[0]);
      file.value = '';
    });
    app.querySelector('[data-a="intro"]').addEventListener('click', showIntro);
    app.querySelector('[data-a="wipe"]').addEventListener('click', async () => {
      const n = Store.state.halls.length;
      if (!n) { toast('Der er ingen data at slette.'); return; }
      const ok = await UI.confirmDialog('Slet alt?', 'Alle ' + n + ' ridehaller og deres baner slettes permanent fra denne browser. Det kan ikke fortrydes.', 'Slet alt', true);
      if (!ok) return;
      Store.deleteEverything();
      toast('Alle data er slettet.');
      route();
    });
    app.querySelectorAll('[data-setting]').forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.setting;
      s[name] = !s[name];
      b.classList.toggle('on', s[name]);
      b.setAttribute('aria-checked', s[name]);
      Store.scheduleSave();
    }));
  }

  function helpHtml() {
    return '<dl class="help">' +
      '<dt>Vælg/flyt</dt><dd>Tryk på et spring for at redigere det, og træk for at flytte det. Det blå håndtag drejer springet, og den røde pil drejer altid med.</dd>' +
      '<dt>Tilføj</dt><dd>Vælg et spring eller en markering, og tryk på banen. Du kan også trække det direkte ind.</dd>' +
      '<dt>Tegn ridevej</dt><dd>Tegn med fingeren, eller sæt punkter og tryk Færdig. Rideveje lægger sig under springene.</dd>' +
      '<dt>Zoom</dt><dd>Knib med to fingre, brug musehjulet, eller brug knapperne på banen.</dd>' +
      '<dt>Computer</dt><dd>Ctrl+Z fortryder, Ctrl+Y gentager, Delete sletter, piletasterne skubber, og R drejer.</dd>' +
      '</dl>';
  }

  function exportBackup() {
    if (!Store.state.halls.length) { toast('Der er ingen baner at eksportere endnu.'); return; }
    const date = new Date().toISOString().slice(0, 10);
    UI.download(new Blob([Store.exportBackup()], { type: 'application/json' }), 'Grejs_Bane_Byg_backup_' + date + '.json');
    toast('Backuppen er gemt i dine overførsler.');
  }

  async function importBackup(file) {
    if (file.size > 25 * 1024 * 1024) { toast('Filen er for stor til at være en backup.', 'error'); return; }
    let parsed;
    try {
      parsed = Store.parseBackup(await file.text());
    } catch (e) {
      toast(e.message || 'Filen kunne ikke læses.', 'error');
      return;
    }
    const summary = 'Filen indeholder ' + parsed.hallCount + (parsed.hallCount === 1 ? ' ridehal' : ' ridehaller') + ' og ' + courseWord(parsed.courseCount) + '.' +
      (parsed.skipped ? ' ' + parsed.skipped + ' ugyldige ridehaller springes over.' : '');
    const hasData = Store.state.halls.length > 0;
    const choice = await UI.openDialog({
      title: 'Importér backup',
      body: '<p>' + esc(summary) + '</p>' + (hasData ? '<p>Sammenflet beholder alt, du har nu. Erstat sletter de nuværende ' + Store.state.halls.length + ' ridehaller først.</p>' : ''),
      actions: hasData ? [
        { label: 'Sammenflet', value: 'merge', kind: 'primary' },
        { label: 'Erstat alt', value: 'replace', kind: 'danger' },
        { label: 'Annullér', value: null, kind: 'ghost' },
      ] : [
        { label: 'Annullér', value: null, kind: 'ghost' },
        { label: 'Importér', value: 'replace', kind: 'primary' },
      ],
    });
    if (!choice) return;
    if (choice === 'replace') {
      Store.replaceFromBackup(parsed);
      toast('Backuppen er indlæst.');
    } else {
      const r = Store.mergeFromBackup(parsed);
      toast('Tilføjet: ' + r.halls + (r.halls === 1 ? ' ridehal' : ' ridehaller') + ' og ' + courseWord(r.courses) + '.' + (r.unchanged ? ' ' + r.unchanged + ' var der allerede.' : ''));
    }
    route();
  }

  /* ---------- Introduktion ---------- */

  function showIntro() {
    const steps = [
      ['hall', 'Opret din ridehal', 'Skriv navn og mål én gang, og gem så mange baner i den, du vil.'],
      ['oxer', 'Placér spring', 'Tryk Tilføj, vælg et spring, og tryk på banen. Den røde pil drejer altid med springet.'],
      ['route', 'Tegn rideveje', 'Skift til Tegn ridevej, og tegn med fingeren eller punkt for punkt.'],
      ['check', 'Alt gemmes automatisk', 'Banerne ligger kun i denne browser på denne enhed. Lav en backup under Indstillinger.'],
    ];
    return UI.openDialog({
      title: 'Velkommen til Grejs_Bane_Byg',
      className: 'intro',
      body: '<ul class="intro-list">' + steps.map((s) => '<li><span class="intro-ic">' + icon(s[0]) + '</span><div><strong>' + esc(s[1]) + '</strong><p>' + esc(s[2]) + '</p></div></li>').join('') + '</ul>',
      actions: [{ label: 'Kom i gang', value: true, kind: 'primary' }],
    }).then(() => {
      Store.settings.introSeen = true;
      Store.scheduleSave();
    });
  }

  /* ---------- Navigation ---------- */

  function route() {
    Editor.close();
    document.querySelectorAll('dialog[open]').forEach((d) => { d.close(); d.remove(); });
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    window.scrollTo(0, 0);
    document.body.classList.toggle('in-editor', parts[0] === 'bane');
    if (parts[0] === 'hal') {
      const hall = Store.getHall(parts[1]);
      if (hall) { renderHall(hall); return; }
    } else if (parts[0] === 'bane') {
      const hall = Store.getHall(parts[1]);
      const course = Store.getCourse(hall, parts[2]);
      if (course) { renderEditor(hall, course); return; }
    } else if (parts[0] === 'indstillinger') {
      renderSettings();
      return;
    }
    document.body.classList.remove('in-editor');
    if (parts.length) history.replaceState(null, '', '#/');
    renderHome();
  }

  function init() {
    Store.load();
    /* Gem det sidste, hvis siden lukkes lige efter en ændring. */
    const flushIfPending = () => { if (Store.hasPending()) Store.flush(); };
    window.addEventListener('pagehide', flushIfPending);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushIfPending(); });
    Store.onStatus((status, message) => {
      /* Editoren viser selv sin status. Uden for editoren skal en fejl stadig kunne ses. */
      if (status === 'error' && !Editor.current) toast(message, 'error');
    });
    /* Ændringer fra en anden fane: læs dem ind, så vi ikke overskriver dem. */
    window.addEventListener('storage', (e) => {
      if (e.key !== Store.KEY) return;
      Store.reload();
      if (!document.querySelector('dialog[open]')) route();
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('afterprint', () => {
      const area = document.getElementById('printArea');
      if (area) area.remove();
    });
    route();
    if (Store.issue) {
      toast(Store.issue, 'error');
      Store.clearIssue();
    }
    if (!Store.settings.introSeen) showIntro();
    /* Gør appen installerbar og brugbar uden net. Virker kun over https eller localhost. */
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* Appen virker også uden */ });
    }
  }

  init();
})(window.GBS);
