/* Grejs_Bane_Byg – datamodel, validering og lokal lagring i localStorage.
   Alle koordinater er i meter: x langs hallens længde, y langs dens bredde.
   Et springs rotation er den eneste retningsværdi – pilen beregnes altid ud fra den. */
(function (GBS) {
  'use strict';

  const KEY = 'grejsBygSpring_v1';
  const VERSION = 1;
  const SAVE_DELAY = 200;

  const OBSTACLE_TYPES = ['vertical', 'oxer', 'triple', 'pole'];
  const DECOR_TYPES = ['tree', 'bush', 'flowers'];
  const DECOR_SIZES = { tree: 4, bush: 2.5, flowers: 3 };
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const PATH_STYLES = ['solid', 'dashed', 'dotted'];
  const PATH_COLORS = ['#5f6368', '#111111', '#1560bd', '#1a7f4b', '#d9480f'];
  const OBSTACLE_DEFAULTS = {
    vertical: { width: 3.5, depth: 0 },
    oxer: { width: 3.5, depth: 1.4 },
    triple: { width: 3.5, depth: 1.8 },
    pole: { width: 3, depth: 0 },
  };

  const defaultSettings = () => ({ introSeen: false, defaultGrid: true, defaultSnap: false, defaultAutoNumber: true });
  const defaultDraw = () => ({ mode: 'free', style: 'dashed', width: 0.6, dash: 10, color: PATH_COLORS[0], arrows: false, smooth: true });
  const defaultView = (settings) => ({
    showGrid: settings ? settings.defaultGrid : true,
    snap: settings ? settings.defaultSnap : false,
    autoNumber: settings ? settings.defaultAutoNumber : true,
    rotationStep: 15,
    symbolScale: 1,
    orientation: 'auto',
    draw: defaultDraw(),
  });
  const emptyMarkers = () => ({ start: null, finish: null, change: null, judge: null, entrance: null, exit: null });
  const FREE_MARKERS = ['start', 'finish', 'change'];

  let state = { version: VERSION, halls: [], settings: defaultSettings() };
  let saveTimer = null;
  let loadIssue = null;
  let storageOk = true;
  const statusListeners = [];

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emitStatus(status, message) {
    statusListeners.forEach((fn) => fn(status, message));
  }

  /* ---------- Validering: alt indlæst eller importeret data passerer her ---------- */

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (v, fallback, min, max) => (isNum(v) ? Math.min(max, Math.max(min, v)) : fallback);
  const round2 = (v) => Math.round(v * 100) / 100;
  const normAngle = (a) => ((a % 360) + 360) % 360;

  function goodId(id, prefix, seen) {
    const ok = typeof id === 'string' && /^[\w-]{1,64}$/.test(id) && !seen.has(id);
    const out = ok ? id : uid(prefix);
    seen.add(out);
    return out;
  }

  function normObstacle(o, seen) {
    if (!o || typeof o !== 'object' || !OBSTACLE_TYPES.includes(o.type) || !isNum(o.x) || !isNum(o.y)) return null;
    const def = OBSTACLE_DEFAULTS[o.type];
    const hasLabel = o.label && isNum(o.label.x) && isNum(o.label.y);
    return {
      id: goodId(o.id, 'o', seen),
      type: o.type,
      x: round2(o.x),
      y: round2(o.y),
      rotation: normAngle(isNum(o.rotation) ? o.rotation : 0),
      number: o.number == null ? '' : String(o.number).slice(0, 8),
      number2: o.number2 == null ? '' : String(o.number2).slice(0, 8),
      number3: o.number3 == null ? '' : String(o.number3).slice(0, 8),
      showNumber: o.showNumber !== false,
      showArrow: o.showArrow !== false,
      bothWays: o.bothWays === true,
      label2: o.label2 && isNum(o.label2.x) && isNum(o.label2.y) ? { x: round2(o.label2.x), y: round2(o.label2.y) } : null,
      label3: o.label3 && isNum(o.label3.x) && isNum(o.label3.y) ? { x: round2(o.label3.x), y: round2(o.label3.y) } : null,
      width: num(o.width, def.width, 0.5, 15),
      depth: def.depth ? num(o.depth, def.depth, 0.3, 6) : 0,
      label: hasLabel ? { x: round2(o.label.x), y: round2(o.label.y) } : null,
    };
  }

  function normDecor(d, seen) {
    if (!d || !DECOR_TYPES.includes(d.type) || !isNum(d.x) || !isNum(d.y)) return null;
    return {
      id: goodId(d.id, 'd', seen),
      type: d.type,
      x: round2(d.x),
      y: round2(d.y),
      rotation: normAngle(isNum(d.rotation) ? d.rotation : 0),
      diameter: num(d.diameter, DECOR_SIZES[d.type], 0.5, 15),
    };
  }

  /* Et bogstav står enten på en væg (side og pos fra væggens start) eller inde på banen (x og y). */
  function normLetter(l, seen) {
    if (!l || typeof l !== 'object') return null;
    const text = String(l.text == null ? '' : l.text).trim().slice(0, 3) || '?';
    if (SIDES.includes(l.side) && isNum(l.pos)) return { id: goodId(l.id, 'l', seen), text, side: l.side, pos: round2(Math.max(0, l.pos)) };
    if (isNum(l.x) && isNum(l.y)) return { id: goodId(l.id, 'l', seen), text, x: round2(l.x), y: round2(l.y) };
    return null;
  }

  /* Oplysningerne til stævnearket. Kun kendte felter og kun tekst gemmes. */
  const SHOW_KEYS = ['classNo', 'className', 'date', 'level', 'discipline', 'method', 'kind', 'jumps', 'height', 'tempo', 'length', 'timeAllowed', 'timeMax', 'designer', 'extra', 'madeBy'];

  function normShow(s) {
    const out = {};
    if (!s || typeof s !== 'object') return out;
    SHOW_KEYS.forEach((k) => {
      if (typeof s[k] === 'string' && s[k].trim()) out[k] = s[k].slice(0, 60);
    });
    if (s.showDistances === true) out.showDistances = true;
    return out;
  }

  /* Logoet er et lille billede gemt som tekst. Alt andet afvises, så det aldrig kan være kode. */
  function goodLogo(v) {
    return typeof v === 'string' && v.length <= 500000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v);
  }

  function normFreeMarker(m, seen) {
    if (!m || !isNum(m.x) || !isNum(m.y)) return null;
    const out = { id: goodId(m.id, 'm', seen), x: round2(m.x), y: round2(m.y) };
    if (isNum(m.rotation)) out.rotation = normAngle(m.rotation);
    if (isNum(m.size)) out.size = num(m.size, 100, 40, 300);
    return out;
  }

  function normEdgeMarker(m, seen) {
    if (!m || !SIDES.includes(m.side) || !isNum(m.pos)) return null;
    const out = { id: goodId(m.id, 'm', seen), side: m.side, pos: round2(Math.max(0, m.pos)) };
    if (m.linked === true) out.linked = true;
    return out;
  }

  function normPath(p, seen) {
    if (!p || !Array.isArray(p.points)) return null;
    const points = p.points.filter((q) => q && isNum(q.x) && isNum(q.y)).map((q) => ({ x: round2(q.x), y: round2(q.y) }));
    if (points.length < 2) return null;
    return {
      id: goodId(p.id, 'p', seen),
      mode: p.mode === 'points' ? 'points' : 'free',
      points,
      style: PATH_STYLES.includes(p.style) ? p.style : 'dashed',
      width: num(p.width, 1, 0, 4),
      dash: num(p.dash, 10, 0, 100),
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PATH_COLORS[0],
      arrows: p.arrows !== false,
      smooth: p.smooth !== false,
      /* En foreslået ridevej: pins er de punkter, der ligger på et spring. */
      ...(p.auto === true ? { auto: true, pins: (Array.isArray(p.pins) ? p.pins : []).filter((i) => Number.isInteger(i) && i >= 0 && i < points.length) } : {}),
    };
  }

  function normView(v) {
    const d = defaultView();
    if (!v || typeof v !== 'object') return d;
    const draw = v.draw && typeof v.draw === 'object' ? v.draw : {};
    return {
      showGrid: v.showGrid !== false,
      snap: v.snap === true,
      autoNumber: v.autoNumber !== false,
      rotationStep: [0, 5, 15, 45, 90].includes(v.rotationStep) ? v.rotationStep : d.rotationStep,
      symbolScale: num(v.symbolScale, 1, 0.5, 2.5),
      orientation: ['auto', 'landscape', 'portrait'].includes(v.orientation) ? v.orientation : 'auto',
      draw: {
        mode: draw.mode === 'points' ? 'points' : 'free',
        style: PATH_STYLES.includes(draw.style) ? draw.style : 'dashed',
        width: num(draw.width, 0.6, 0, 4),
        dash: num(draw.dash, 10, 0, 100),
        color: /^#[0-9a-f]{6}$/i.test(draw.color) ? draw.color : PATH_COLORS[0],
        arrows: draw.arrows === true,
        smooth: draw.smooth !== false,
      },
    };
  }

  /* Afstande i meter pr. strækning, f.eks. { "1|2": 14.5 }. Nøglerne er springenes numre. */
  function normDistances(d) {
    const out = {};
    if (!d || typeof d !== 'object') return out;
    Object.keys(d).slice(0, 200).forEach((k) => {
      if (k.length <= 40 && isNum(d[k]) && d[k] > 0 && d[k] <= 999) out[k] = round2(d[k]);
    });
    return out;
  }

  function normCourse(c, seen) {
    if (!c || typeof c !== 'object') return null;
    const inner = new Set();
    const m = c.markers && typeof c.markers === 'object' ? c.markers : {};
    return {
      id: goodId(c.id, 'c', seen),
      name: String(c.name || 'Springbane').slice(0, 60),
      updatedAt: isNum(c.updatedAt) ? c.updatedAt : Date.now(),
      obstacles: (Array.isArray(c.obstacles) ? c.obstacles : []).map((o) => normObstacle(o, inner)).filter(Boolean),
      markers: {
        start: normFreeMarker(m.start, inner),
        finish: normFreeMarker(m.finish, inner),
        change: normFreeMarker(m.change, inner),
        judge: normEdgeMarker(m.judge, inner),
        entrance: normEdgeMarker(m.entrance, inner),
        exit: normEdgeMarker(m.exit, inner),
      },
      paths: (Array.isArray(c.paths) ? c.paths : []).map((p) => normPath(p, inner)).filter(Boolean),
      distances: normDistances(c.distances),
      decorations: (Array.isArray(c.decorations) ? c.decorations : []).map((d) => normDecor(d, inner)).filter(Boolean),
      letters: (Array.isArray(c.letters) ? c.letters : []).slice(0, 60).map((l) => normLetter(l, inner)).filter(Boolean),
      show: normShow(c.show),
      view: normView(c.view),
    };
  }

  function normHall(h, seen, courseSeen) {
    if (!h || typeof h !== 'object' || !isNum(h.length) || !isNum(h.width) || h.length <= 0 || h.width <= 0) return null;
    return {
      id: goodId(h.id, 'h', seen),
      name: String(h.name || 'Ridehal').slice(0, 60),
      length: num(h.length, 40, 5, 500),
      width: num(h.width, 20, 5, 500),
      ...(goodLogo(h.logo) ? { logo: h.logo } : {}),
      courses: (Array.isArray(h.courses) ? h.courses : []).map((c) => normCourse(c, courseSeen)).filter(Boolean),
    };
  }

  /* Returnerer rensede haller, eller null hvis strukturen slet ikke ligner vores data. */
  function normHalls(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.halls)) return null;
    const hallSeen = new Set();
    const courseSeen = new Set();
    return raw.halls.map((h) => normHall(h, hallSeen, courseSeen)).filter(Boolean);
  }

  /* ---------- Indlæs / gem ---------- */

  /* Gemmer en ulæselig eller nyere version til side, så den ikke overskrives af vores næste gem. */
  function quarantine(text) {
    try { localStorage.setItem(KEY + '_gemt_' + Date.now(), text); } catch (e) { /* Der er intet mere at gøre her */ }
  }

  function load() {
    let text = null;
    try {
      text = localStorage.getItem(KEY);
      storageOk = true;
    } catch (e) {
      storageOk = false;
      loadIssue = 'Browseren tillader ikke lokal lagring (måske privat tilstand). Dine ændringer bliver ikke gemt, når siden lukkes.';
      return state;
    }
    if (!text) return state;
    try {
      const raw = JSON.parse(text);
      if (isNum(raw.version) && raw.version > VERSION) {
        quarantine(text);
        loadIssue = 'Dine gemte data er fra en nyere version af appen. En kopi er lagt til side, og appen starter tom.';
        return state;
      }
      const halls = normHalls(raw);
      if (!halls) throw new Error('Ugyldig struktur');
      state = {
        version: VERSION,
        halls,
        settings: Object.assign(defaultSettings(), raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
      };
    } catch (e) {
      quarantine(text);
      loadIssue = 'De gemte data kunne ikke læses. En kopi er lagt til side, og appen starter tom. Du kan indlæse en backup under Indstillinger.';
    }
    return state;
  }

  function reload() {
    state = { version: VERSION, halls: [], settings: defaultSettings() };
    load();
    return state;
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
      emitStatus('saved');
      return true;
    } catch (e) {
      storageOk = false;
      const full = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      emitStatus('error', full
        ? 'Browserens lagerplads er fuld, så ændringen kunne ikke gemmes. Eksportér en backup og slet gamle baner.'
        : 'Ændringen kunne ikke gemmes i denne browser. Eksportér en backup, så du ikke mister arbejdet.');
      return false;
    }
  }

  function scheduleSave() {
    emitStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY);
  }

  function hasPending() { return saveTimer !== null; }

  /* ---------- Ridehaller og baner ---------- */

  function getHall(id) { return state.halls.find((h) => h.id === id) || null; }
  function getCourse(hall, id) { return hall ? hall.courses.find((c) => c.id === id) || null : null; }

  function newCourse(name) {
    return {
      id: uid('c'),
      name: name,
      updatedAt: Date.now(),
      obstacles: [],
      markers: emptyMarkers(),
      paths: [],
      distances: {},
      decorations: [],
      letters: [],
      view: defaultView(state.settings),
    };
  }

  function nextCourseName(hall) {
    let n = hall.courses.length + 1;
    while (hall.courses.some((c) => c.name === 'Springbane ' + n)) n++;
    return 'Springbane ' + n;
  }

  function createHall(name, length, width) {
    const hall = { id: uid('h'), name, length, width, courses: [] };
    state.halls.unshift(hall);
    scheduleSave();
    return hall;
  }

  /* Renser en modtaget bane. Returnerer null, hvis den ikke ligner en bane fra appen. */
  function cleanShared(raw) {
    if (!raw || typeof raw !== 'object' || raw.app !== 'grejsBaneByg' || !raw.hall || !raw.course) return null;
    if (!isNum(raw.hall.length) || !isNum(raw.hall.width) || raw.hall.length <= 0 || raw.hall.width <= 0) return null;
    const course = normCourse(raw.course, new Set());
    if (!course) return null;
    const hall = {
      name: String(raw.hall.name || 'Ridehal').slice(0, 60),
      length: num(raw.hall.length, 40, 5, 500),
      width: num(raw.hall.width, 20, 5, 500),
    };
    if (goodLogo(raw.hall.logo)) hall.logo = raw.hall.logo;
    return { hall, course };
  }

  function addSharedCourse(hall, course, name) {
    const copy = JSON.parse(JSON.stringify(course));
    copy.id = uid('c');
    copy.name = String(name || course.name).slice(0, 60);
    copy.updatedAt = Date.now();
    hall.courses.unshift(copy);
    scheduleSave();
    return copy;
  }

  function createCourse(hall, name) {
    const c = newCourse(name || nextCourseName(hall));
    /* Bogstaverne hører til stedet, så en ny bane i samme hal starter med dem, man allerede har sat op. */
    const withLetters = hall.courses.find((e) => e.letters && e.letters.length);
    if (withLetters) c.letters = JSON.parse(JSON.stringify(withLetters.letters));
    hall.courses.unshift(c);
    scheduleSave();
    return c;
  }

  /* A og C på endevæggene, F, B, M og K, E, H på langsiderne og X i midten. */
  function standardLetters(hall) {
    const long = hall.length >= hall.width;
    const [endA, endC] = long ? ['left', 'right'] : ['top', 'bottom'];
    const [sideF, sideK] = long ? ['bottom', 'top'] : ['left', 'right'];
    const along = Math.max(hall.length, hall.width);
    const across = Math.min(hall.length, hall.width);
    const inset = round2(Math.min(6, along / 4));
    const edge = (text, side, pos) => ({ id: uid('l'), text, side, pos: round2(pos) });
    return [
      edge('A', endA, across / 2), edge('C', endC, across / 2),
      edge('F', sideF, inset), edge('B', sideF, along / 2), edge('M', sideF, along - inset),
      edge('K', sideK, inset), edge('E', sideK, along / 2), edge('H', sideK, along - inset),
      { id: uid('l'), text: 'X', x: round2(hall.length / 2), y: round2(hall.width / 2) },
    ];
  }

  function duplicateCourse(hall, course) {
    const copy = JSON.parse(JSON.stringify(course));
    copy.id = uid('c');
    copy.name = (course.name + ' (kopi)').slice(0, 60);
    copy.updatedAt = Date.now();
    hall.courses.splice(hall.courses.indexOf(course) + 1, 0, copy);
    scheduleSave();
    return copy;
  }

  function deleteCourse(hall, course) {
    hall.courses = hall.courses.filter((c) => c !== course);
    scheduleSave();
  }

  function deleteHall(hall) {
    state.halls = state.halls.filter((h) => h !== hall);
    scheduleSave();
  }

  function touchCourse(course) {
    course.updatedAt = Date.now();
    scheduleSave();
  }

  /* Antal elementer, der ville ligge uden for hallen med de nye mål. */
  function countOutside(hall, length, width) {
    const outside = (p) => p.x < 0 || p.y < 0 || p.x > length || p.y > width;
    let n = 0;
    hall.courses.forEach((c) => {
      n += c.obstacles.filter(outside).length;
      n += FREE_MARKERS.filter((k) => c.markers[k] && outside(c.markers[k])).length;
      n += c.paths.filter((p) => p.points.some(outside)).length;
      n += (c.decorations || []).filter(outside).length;
    });
    return n;
  }

  function clampMarkersToEdge(c, length, width) {
    ['judge', 'entrance', 'exit'].forEach((k) => {
      const m = c.markers[k];
      if (!m) return;
      const max = m.side === 'top' || m.side === 'bottom' ? length : width;
      m.pos = Math.min(m.pos, max);
    });
  }

  /* Ændrer hallens mål. Elementer slettes aldrig; moveInside skubber dem ind på banen. */
  function resizeHall(hall, length, width, moveInside) {
    const clampPt = (p) => {
      p.x = Math.min(length, Math.max(0, p.x));
      p.y = Math.min(width, Math.max(0, p.y));
    };
    hall.length = length;
    hall.width = width;
    hall.courses.forEach((c) => {
      clampMarkersToEdge(c, length, width);
      (c.letters || []).forEach((l) => {
        if (l.side) l.pos = Math.min(l.pos, l.side === 'top' || l.side === 'bottom' ? length : width);
        else clampPt(l);
      });
      if (moveInside) {
        c.obstacles.forEach(clampPt);
        FREE_MARKERS.forEach((k) => { if (c.markers[k]) clampPt(c.markers[k]); });
      (c.decorations || []).forEach(clampPt);
        c.paths.forEach((p) => p.points.forEach(clampPt));
      }
    });
    scheduleSave();
  }

  /* ---------- Backup ---------- */

  function exportBackup() {
    return JSON.stringify({ app: 'grejsBygSpring', version: VERSION, exportedAt: new Date().toISOString(), halls: state.halls }, null, 1);
  }

  /* Validerer en backupfil uden at ændre noget. Kaster en forståelig fejl. */
  function parseBackup(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('Filen er ikke gyldig JSON.'); }
    if (raw && isNum(raw.version) && raw.version > VERSION) throw new Error('Backuppen er lavet med en nyere version af appen.');
    const halls = normHalls(raw);
    if (!halls) throw new Error('Filen ligner ikke en backup fra Grejs_Bane_Byg.');
    const total = Array.isArray(raw.halls) ? raw.halls.length : 0;
    return {
      halls,
      hallCount: halls.length,
      courseCount: halls.reduce((n, h) => n + h.courses.length, 0),
      skipped: total - halls.length,
    };
  }

  function replaceFromBackup(parsed) {
    state.halls = parsed.halls;
    scheduleSave();
  }

  const courseContent = (c) => JSON.stringify([c.obstacles, c.markers, c.paths]);

  /* Sammenfletning: intet eksisterende overskrives. En bane med samme id men andet indhold tilføjes som kopi. */
  function mergeFromBackup(parsed) {
    const result = { halls: 0, courses: 0, unchanged: 0 };
    parsed.halls.forEach((incoming) => {
      const sameSize = (h) => h.length === incoming.length && h.width === incoming.width;
      let target = state.halls.find((h) => h.id === incoming.id && sameSize(h))
        || state.halls.find((h) => h.name === incoming.name && sameSize(h));
      if (!target) {
        if (getHall(incoming.id)) incoming.id = uid('h');
        state.halls.push(incoming);
        result.halls++;
        result.courses += incoming.courses.length;
        return;
      }
      incoming.courses.forEach((c) => {
        if (target.courses.some((e) => courseContent(e) === courseContent(c))) {
          result.unchanged++;
          return;
        }
        if (target.courses.some((e) => e.id === c.id)) {
          c.id = uid('c');
          c.name = (c.name + ' (importeret)').slice(0, 60);
        }
        target.courses.push(c);
        result.courses++;
      });
    });
    scheduleSave();
    return result;
  }

  function deleteEverything() {
    state.halls = [];
    scheduleSave();
  }

  function storageBytes() {
    try {
      const t = localStorage.getItem(KEY);
      return t ? new Blob([t]).size : 0;
    } catch (e) { return 0; }
  }

  GBS.Store = {
    KEY, SHOW_KEYS, goodLogo, OBSTACLE_TYPES, OBSTACLE_DEFAULTS, DECOR_TYPES, DECOR_SIZES, PATH_COLORS, SIDES, FREE_MARKERS,
    uid, load, reload, flush, scheduleSave, hasPending,
    get state() { return state; },
    get settings() { return state.settings; },
    get issue() { return loadIssue; },
    get storageOk() { return storageOk; },
    clearIssue() { loadIssue = null; },
    onStatus(fn) { statusListeners.push(fn); },
    offStatus(fn) {
      const i = statusListeners.indexOf(fn);
      if (i >= 0) statusListeners.splice(i, 1);
    },
    getHall, getCourse, createHall, cleanShared, addSharedCourse, createCourse, duplicateCourse, deleteCourse, deleteHall, touchCourse,
    nextCourseName, standardLetters, countOutside, resizeHall, normAngle, round2,
    exportBackup, parseBackup, replaceFromBackup, mergeFromBackup, deleteEverything, storageBytes,
  };
})(window.GBS);
