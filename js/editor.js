/* Grejs_Bane_Byg – selve banebyggeren.
   Tre tilstande: select (vælg/flyt), add (tilføj) og draw (tegn ridevej).
   Mus, finger og pen går alle gennem de samme Pointer Events.
   Verden er i meter. Kameraet (tx, ty, s) og visningsrotationen omsætter til skærmpixels. */
(function (GBS) {
  'use strict';

  const { UI, Store, Scene, Exporter, Route, Share } = GBS;
  const { icon, esc, parseNum, fmtNum, clamp, toast } = UI;

  const SIDE_LAYOUT = '(min-width: 900px), (orientation: landscape) and (min-width: 640px) and (max-height: 520px)';
  const HISTORY_LIMIT = 150;
  const WIDTH_PER_STEP_INV = 2.5;
  const LOGO_MAX = 480; /* Pixels på logoets længste led */
  const TILES = [
    { kind: 'vertical', label: 'Lodret', hint: 'Tryk på banen for at placere et lodret spring.' },
    { kind: 'oxer', label: 'Oxer', hint: 'Tryk på banen for at placere en oxer.' },
    { kind: 'triple', label: 'Triple Bar', hint: 'Tryk på banen for at placere en triple bar.' },
    { kind: 'pole', label: 'Bom', hint: 'Tryk på banen for at placere en bom.' },
    { kind: 'start', label: 'Start', hint: 'Tryk på banen for at placere START.' },
    { kind: 'finish', label: 'Mål', hint: 'Tryk på banen for at placere MÅL.' },
    { kind: 'change', label: 'Mål/start', hint: 'Tryk på banen for at placere et skift mellem mål og start.' },
    { kind: 'judge', label: 'Dommer', hint: 'Tryk ved en væg for at placere dommeren.' },
    { kind: 'gate', label: 'Ind/ud', hint: 'Tryk ved en væg for at placere ind- og udgang.' },
    { kind: 'tree', label: 'Træ', hint: 'Tryk på banen for at placere et træ.' },
    { kind: 'bush', label: 'Busk', hint: 'Tryk på banen for at placere en busk.' },
    { kind: 'flowers', label: 'Blomster', hint: 'Tryk på banen for at placere en blomsterkasse.' },
  ];
  const TYPE_NAMES = { vertical: 'Lodret', oxer: 'Oxer', triple: 'Triple Bar', pole: 'Bom' };
  const DECOR_NAMES = { tree: 'Træ', bush: 'Busk', flowers: 'Blomster' };
  const MARKER_NAMES = { start: 'START', finish: 'MÅL', change: 'MÅL/START', judge: 'Dommer', entrance: 'Ind', exit: 'Ud' };
  const STEPS = [[0, 'Fri'], [5, '5°'], [15, '15°'], [45, '45°'], [90, '90°']];

  let current = null;

  function close() {
    if (current) current.destroy();
    current = null;
  }

  function open(hall, course, root) {
    close();
    current = createEditor(hall, course, root);
    return current;
  }

  function createEditor(hall, course, root) {
    const view = course.view;
    const sideLayout = window.matchMedia(SIDE_LAYOUT);
    const cam = { tx: 0, ty: 0, s: 10 };
    const pointers = new Map();
    let rot = 0;
    let ctx = Scene.makeCtx(hall, view, rot);
    let mode = 'select';
    let addKind = null;
    let selection = null;
    let gesture = null;
    let draftPoints = [];
    let ghostPoint = null;
    let moreOpen = false;
    let drawStyleOpen = false;
    let handles = [];
    let camTouched = false;
    let camStamp = 0;
    let autoPan = null;
    let camAnim = null;
    let fitScale = 10;
    let hintTimer = null;
    let tileDrag = null;
    let suppressTileClick = false;
    let lastW = 0;
    let lastH = 0;
    let wasSideLayout = sideLayout.matches;

    root.innerHTML = template();
    const $ = (sel) => root.querySelector(sel);
    const stage = $('.stage');
    const svg = $('.stage-svg');
    const camG = $('[data-cam]');
    const worldG = $('[data-world]');
    const layers = {
      surface: $('[data-layer="surface"]'),
      decorations: $('[data-layer="decorations"]'),
      paths: $('[data-layer="paths"]'),
      obstacles: $('[data-layer="obstacles"]'),
      markers: $('[data-layer="markers"]'),
      draft: $('[data-layer="draft"]'),
    };
    const overlay = $('[data-overlay]');
    const ctxEl = $('.ctx');
    const dock = $('.dock');
    const hintEl = $('.hint');
    const statusEl = $('.save-status');
    const undoBtn = $('[data-top="undo"]');
    const redoBtn = $('[data-top="redo"]');

    /* ---------- Fortryd / gentag ---------- */

    const snapshot = () => JSON.stringify({ obstacles: course.obstacles, markers: course.markers, paths: course.paths, distances: course.distances || {}, decorations: course.decorations || [] });
    let present = snapshot();
    const undoStack = [];
    const redoStack = [];

    /* Afslutter en redigering. Kaldes altid efter ændringer; gør intet, hvis indholdet er uændret. */
    function commit() {
      const s = snapshot();
      if (s === present) return;
      undoStack.push(present);
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack.length = 0;
      present = s;
      Store.touchCourse(course);
      updateHistoryButtons();
    }

    function restore(json) {
      const d = JSON.parse(json);
      course.obstacles = d.obstacles;
      course.markers = d.markers;
      course.paths = d.paths;
      course.distances = d.distances;
      course.decorations = d.decorations;
      present = json;
      if (selection && !findSelected()) selection = null;
      Store.touchCourse(course);
      renderAll();
    }

    function undo() {
      if (mode === 'draw' && draftPoints.length) { removeLastPoint(); return; }
      if (!undoStack.length) return;
      redoStack.push(present);
      restore(undoStack.pop());
    }

    function redo() {
      if (!redoStack.length) return;
      undoStack.push(present);
      restore(redoStack.pop());
    }

    /* Ruller en igangværende, ikke-afsluttet ændring tilbage. */
    function revert() {
      if (snapshot() !== present) restore(present);
    }

    function updateHistoryButtons() {
      undoBtn.disabled = !undoStack.length && !draftPoints.length;
      redoBtn.disabled = !redoStack.length;
    }

    /* ---------- Kamera ---------- */

    function applyCam() {
      camG.setAttribute('transform', 'translate(' + cam.tx.toFixed(2) + ' ' + cam.ty.toFixed(2) + ') scale(' + cam.s.toFixed(4) + ')');
      const minor = layers.surface.querySelector('[data-grid="minor"]');
      if (minor) minor.setAttribute('display', cam.s < 7 ? 'none' : 'inline');
      renderOverlay();
    }

    function stageSize() {
      const r = stage.getBoundingClientRect();
      return { w: r.width, h: r.height, left: r.left, top: r.top };
    }

    /* Tilpasser hele banen. På mobil reserveres plads til den flydende værktøjsrække. */
    function fit(animate) {
      const size = stageSize();
      if (!size.w || !size.h) return;
      const bottomInset = sideLayout.matches ? 8 : 78;
      const availW = size.w - 12;
      const availH = size.h - 8 - bottomInset;
      setRot(Scene.chooseRot(hall, view.orientation, availW, availH));
      const b = Scene.viewBounds(hall, course, ctx);
      const s = Math.min(availW / b.w, availH / b.h);
      const target = {
        s,
        tx: 6 + (availW - b.w * s) / 2 - b.x * s,
        ty: 8 + (availH - b.h * s) / 2 - b.y * s,
      };
      fitScale = s;
      camTouched = false;
      autoPan = null;
      if (animate) animateCam(target);
      else { Object.assign(cam, target); applyCam(); }
    }

    function setRot(r) {
      if (r === rot && worldG.hasAttribute('transform')) return;
      rot = r;
      ctx = Scene.makeCtx(hall, view, rot);
      worldG.setAttribute('transform', Scene.viewTransform(hall, rot));
      renderScene();
    }

    function animateCam(target) {
      cancelAnimationFrame(camAnim);
      const from = Object.assign({}, cam);
      const t0 = performance.now();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const step = (t) => {
        const k = reduce ? 1 : clamp((t - t0) / 170, 0, 1);
        const e = 1 - (1 - k) * (1 - k);
        cam.s = from.s + (target.s - from.s) * e;
        cam.tx = from.tx + (target.tx - from.tx) * e;
        cam.ty = from.ty + (target.ty - from.ty) * e;
        applyCam();
        if (k < 1) camAnim = requestAnimationFrame(step);
      };
      camAnim = requestAnimationFrame(step);
    }

    const minScale = () => fitScale * 0.6;
    const maxScale = () => Math.max(fitScale * 14, 90);

    function zoomAt(px, py, factor) {
      const s = clamp(cam.s * factor, minScale(), maxScale());
      const k = s / cam.s;
      cam.tx = px - (px - cam.tx) * k;
      cam.ty = py - (py - cam.ty) * k;
      cam.s = s;
      markCamUser();
      applyCam();
    }

    function markCamUser() {
      camTouched = true;
      camStamp++;
    }

    function toWorld(p) {
      return Scene.fromView(hall, rot, (p.x - cam.tx) / cam.s, (p.y - cam.ty) / cam.s);
    }

    function toScreen(x, y) {
      const v = Scene.toView(hall, rot, x, y);
      return { x: cam.tx + v.x * cam.s, y: cam.ty + v.y * cam.s };
    }

    /* ---------- Tegning ---------- */

    function renderSurface() {
      layers.surface.innerHTML = Scene.surface(hall, ctx, course, view.showGrid);
      const minor = layers.surface.querySelector('[data-grid="minor"]');
      if (minor) minor.setAttribute('display', cam.s < 7 ? 'none' : 'inline');
    }

    const wrap = (key, html) => '<g data-el="' + esc(key) + '">' + html + '</g>';

    function renderScene() {
      renderSurface();
      layers.decorations.innerHTML = decorations().map((d) => wrap(d.id, Scene.decoration(d, ctx))).join('');
      layers.paths.innerHTML = course.paths.map((p) => wrap(p.id, Scene.path(p, ctx))).join('');
      layers.obstacles.innerHTML = course.obstacles.map((o) => wrap(o.id, Scene.obstacle(o, ctx))).join('');
      layers.markers.innerHTML = Scene.markerKeys(course).map((k) => wrap(k, Scene.marker(k, course.markers[k], ctx))).join('');
    }

    /* Under træk opdateres kun det ene element, så mange spring ikke giver forsinkelse. */
    function updateElement(sel) {
      if (sel.kind === 'obstacle') {
        const o = course.obstacles.find((q) => q.id === sel.id);
        const g = layers.obstacles.querySelector('[data-el="' + sel.id + '"]');
        if (o && g) g.innerHTML = Scene.obstacle(o, ctx);
      } else if (sel.kind === 'marker') {
        const g = layers.markers.querySelector('[data-el="' + sel.key + '"]');
        if (g) g.innerHTML = Scene.marker(sel.key, course.markers[sel.key], ctx);
        if (sel.key === 'judge' || sel.key === 'entrance' || sel.key === 'exit') renderSurface();
      } else if (sel.kind === 'path') {
        const p = course.paths.find((q) => q.id === sel.id);
        const g = layers.paths.querySelector('[data-el="' + sel.id + '"]');
        if (p && g) g.innerHTML = Scene.path(p, ctx);
      } else if (sel.kind === 'decor') {
        const d = decorations().find((q) => q.id === sel.id);
        const g = layers.decorations.querySelector('[data-el="' + sel.id + '"]');
        if (d && g) g.innerHTML = Scene.decoration(d, ctx);
      }
    }

    function renderAll() {
      renderScene();
      renderDraft();
      renderOverlay();
      renderCtx();
      renderModes();
      updateHistoryButtons();
    }

    function renderDraft() {
      let html = '';
      const r = 0.34 * ctx.u;
      const draw = view.draw;
      const pts = ghostPoint ? draftPoints.concat([ghostPoint]) : draftPoints;
      if (pts.length) {
        const p = { points: pts, smooth: draw.smooth, style: draw.style, width: draw.width, dash: draw.dash, color: draw.color, arrows: false };
        html += '<path d="' + Scene.pathD(pts, draw.smooth) + '"' + Scene.pathStroke(p, ctx) + '/>';
        pts.forEach((q) => {
          html += '<circle cx="' + q.x + '" cy="' + q.y + '" r="' + r + '" fill="#fff" stroke="' + esc(draw.color) + '" stroke-width="' + (r * 0.5) + '"/>';
        });
      }
      layers.draft.innerHTML = html;
      updateHistoryButtons();
    }

    function decorations() {
      if (!course.decorations) course.decorations = [];
      return course.decorations;
    }

    function findSelected() {
      if (!selection) return null;
      if (selection.kind === 'decor') return decorations().find((d) => d.id === selection.id) || null;
      if (selection.kind === 'obstacle') return course.obstacles.find((o) => o.id === selection.id) || null;
      if (selection.kind === 'path') return course.paths.find((p) => p.id === selection.id) || null;
      return course.markers[selection.key] || null;
    }

    /* Markeringsramme og håndtag tegnes i skærmpixels, så de altid er lige store at ramme. */
    function renderOverlay() {
      handles = [];
      const item = findSelected();
      if (!item || (gesture && gesture.type === 'pinch')) { overlay.innerHTML = ''; return; }
      const frame = 'fill="none" stroke="#1560bd" stroke-width="2" stroke-dasharray="6 4"';
      let html = '';
      if (selection.kind === 'obstacle') {
        const g = Scene.obstacleGeom(item, ctx);
        const p = toScreen(item.x, item.y);
        const s = cam.s;
        const pad = 5;
        const top = -g.halfY * s - pad;
        const bottom = g.halfY * s + pad;
        const a = item.rotation + rot;
        html += '<g transform="translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ') rotate(' + a.toFixed(1) + ')">' +
          '<rect x="' + (-g.back * s - pad).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + ((g.back + g.front) * s + pad * 2).toFixed(1) + '" height="' + (bottom - top).toFixed(1) + '" rx="5" ' + frame + '/>' +
          rotateKnob(p, a, bottom) + '</g>';
        const l = Scene.labelInfo(item, ctx);
        if (l.visible) {
          const c = toScreen(item.x + l.dx, item.y + l.dy);
          html += selRect(c.x, c.y, l.hw * s + 3, l.hh * s + 3, 0, frame);
        }
        const l2 = Scene.label2Info(item, ctx);
        if (l2.visible) {
          const c = toScreen(item.x + l2.dx, item.y + l2.dy);
          html += selRect(c.x, c.y, l2.hw * s + 3, l2.hh * s + 3, 0, frame);
        }
        const l3 = Scene.label3Info(item, ctx);
        if (l3.visible) {
          const c = toScreen(item.x + l3.dx, item.y + l3.dy);
          html += selRect(c.x, c.y, l3.hw * s + 3, l3.hh * s + 3, 0, frame);
        }
      } else if (selection.kind === 'decor') {
        const box = Scene.decorBox(item, ctx);
        const c = toScreen(item.x, item.y);
        const a = item.rotation + rot;
        html += selRect(c.x, c.y, box.hw * cam.s + 4, box.hh * cam.s + 4, a, frame) +
          '<g transform="translate(' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ') rotate(' + a.toFixed(1) + ')">' +
          rotateKnob(c, a, box.hh * cam.s + 4) + '</g>';
      } else if (selection.kind === 'marker') {
        const key = selection.key;
        if (Scene.isFreeMarker(key)) {
          const sz = Scene.freeMarkerSize(key, item, ctx);
          const c = toScreen(item.x, item.y);
          const a = Scene.freeMarkerAngle(item, ctx) + rot;
          html += selRect(c.x, c.y, sz.hw * cam.s + 4, sz.hh * cam.s + 4, a, frame) +
            '<g transform="translate(' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ') rotate(' + a.toFixed(1) + ')">' +
            rotateKnob(c, a, sz.hh * cam.s + 4) + '</g>';
        } else {
          const g = Scene.edgeGeom(key, item, ctx);
          const c = toScreen(g.cx, g.cy);
          html += selRect(c.x, c.y, g.hw * cam.s + 4, g.hh * cam.s + 4, g.angle + rot, frame);
        }
      } else if (selection.kind === 'path') {
        const pts = item.points.map((q) => toScreen(q.x, q.y));
        html += '<path d="' + Scene.pathD(pts, item.smooth) + '" fill="none" stroke="#1560bd" stroke-opacity=".28" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>';
        if (item.mode === 'points' && (item.auto || pts.length <= 60)) {
          const show = item.auto ? autoHandles(item) : pts.map((q, i) => i);
          show.forEach((i) => {
            const q = pts[i];
            html += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="9" fill="#fff" stroke="#1560bd" stroke-width="3"/>';
            handles.push({ type: 'point', index: i, x: q.x, y: q.y });
          });
        }
      }
      overlay.innerHTML = html;
    }

    /* Rotationshåndtaget tegnes i elementets roterede gruppe, under elementet. p og deg er på skærmen. */
    function rotateKnob(p, deg, bottom) {
      const hy = bottom + 30;
      const rad = deg * Math.PI / 180;
      handles.push({ type: 'rotate', x: p.x - Math.sin(rad) * hy, y: p.y + Math.cos(rad) * hy });
      return '<line x1="0" y1="' + bottom.toFixed(1) + '" x2="0" y2="' + hy.toFixed(1) + '" stroke="#1560bd" stroke-width="2"/>' +
        '<circle cx="0" cy="' + hy.toFixed(1) + '" r="15" fill="#1560bd" stroke="#fff" stroke-width="2.5"/>' +
        '<path transform="translate(0 ' + hy.toFixed(1) + ')" d="M-5.5 -2a6 6 0 1 1 1 5.5M-6.5 -6.5v4.5h4.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    /* En foreslået ridevej har mange punkter. Kun hvert ca. 7. meter vises som håndtag. */
    function autoHandles(path) {
      const out = [];
      let walked = Infinity;
      const pins = path.pins || [];
      path.points.forEach((q, i) => {
        if (i) walked += Math.hypot(q.x - path.points[i - 1].x, q.y - path.points[i - 1].y);
        if (pins.includes(i)) return; /* Springene har deres eget symbol; ruten bliver der */
        const nearPin = pins.some((j) => Math.abs(j - i) < 3);
        if (walked >= 7 && !nearPin) {
          out.push(i);
          walked = 0;
        }
      });
      return out;
    }

    function selRect(x, y, hw, hh, deg, frame) {
      return '<rect transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + deg.toFixed(1) + ')" x="' + (-hw).toFixed(1) + '" y="' + (-hh).toFixed(1) + '" width="' + (hw * 2).toFixed(1) + '" height="' + (hh * 2).toFixed(1) + '" rx="6" ' + frame + '/>';
    }

    /* ---------- Hit-test ---------- */

    function distRect(px, py, cx, cy, hw, hh, deg) {
      const r = -deg * Math.PI / 180;
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * Math.cos(r) - dy * Math.sin(r);
      const ly = dx * Math.sin(r) + dy * Math.cos(r);
      return Math.hypot(Math.max(Math.abs(lx) - hw, 0), Math.max(Math.abs(ly) - hh, 0));
    }

    function distSegment(p, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = dx * dx + dy * dy;
      const t = len ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1) : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    }

    /* Finder det nærmeste element. Den usynlige tolerance gør spring lette at ramme med en finger,
       og fordi den nærmeste vinder, kan tætstående spring stadig vælges hver for sig. */
    function hitTest(w, isTouch) {
      const tol = (isTouch ? 22 : 8) / cam.s;
      let best = null;
      const consider = (hit, d) => {
        if (d > tol) return;
        const isSel = selection && selection.kind === hit.kind && selection.id === hit.id && selection.key === hit.key;
        const score = d - (isSel ? 2 / cam.s : 0) + (hit.kind === 'path' ? 6 / cam.s : 0) + (hit.kind === 'decor' ? 10 / cam.s : 0);
        if (!best || score <= best.score) best = Object.assign({ score }, hit);
      };
      /* Pynt vælges kun, når der ikke ligger et spring eller en ridevej samme sted. */
      decorations().forEach((item) => {
        const box = Scene.decorBox(item, ctx);
        consider({ kind: 'decor', id: item.id }, distRect(w.x, w.y, item.x, item.y, box.hw, box.hh, item.rotation));
      });
      course.paths.forEach((p) => {
        const pts = Scene.flatten(p.points, p.smooth);
        let d = Infinity;
        for (let i = 1; i < pts.length; i++) d = Math.min(d, distSegment(w, pts[i - 1], pts[i]));
        if (d <= 14 / cam.s) consider({ kind: 'path', id: p.id }, d);
      });
      course.obstacles.forEach((o) => {
        const g = Scene.obstacleGeom(o, ctx);
        let d = distRect(w.x, w.y, o.x, o.y, g.railHalfX, g.halfY, o.rotation);
        if (g.arrow) {
          const r = o.rotation * Math.PI / 180;
          const mid = (g.front - g.back) / 2;
          d = Math.min(d, distRect(w.x, w.y, o.x + Math.cos(r) * mid, o.y + Math.sin(r) * mid, (g.front + g.back) / 2, 0.44 * ctx.u, o.rotation));
        }
        const l = Scene.labelInfo(o, ctx);
        let onLabel = 0;
        if (l.visible) {
          const dl = distRect(w.x, w.y, o.x + l.dx, o.y + l.dy, l.hw, l.hh, -rot);
          if (dl < d || dl === 0) { d = dl; onLabel = 1; }
        }
        const l2 = Scene.label2Info(o, ctx);
        if (l2.visible) {
          const dl = distRect(w.x, w.y, o.x + l2.dx, o.y + l2.dy, l2.hw, l2.hh, -rot);
          if (dl < d || dl === 0) { d = dl; onLabel = 2; }
        }
        const l3 = Scene.label3Info(o, ctx);
        if (l3.visible) {
          const dl = distRect(w.x, w.y, o.x + l3.dx, o.y + l3.dy, l3.hw, l3.hh, -rot);
          if (dl < d || dl === 0) { d = dl; onLabel = 3; }
        }
        consider({ kind: 'obstacle', id: o.id, onLabel }, d);
      });
      Store.FREE_MARKERS.forEach((key) => {
        const m = course.markers[key];
        if (!m) return;
        const sz = Scene.freeMarkerSize(key, m, ctx);
        consider({ kind: 'marker', key }, distRect(w.x, w.y, m.x, m.y, sz.hw, sz.hh, Scene.freeMarkerAngle(m, ctx)));
      });
      Scene.markerKeys(course).filter((k) => !Scene.isFreeMarker(k)).forEach((key) => {
        const m = course.markers[key];
        const g = Scene.edgeGeom(key, m, ctx);
        consider({ kind: 'marker', key }, distRect(w.x, w.y, g.cx, g.cy, g.hw, g.hh, g.angle));
      });
      return best;
    }

    function hitHandle(p) {
      let best = null;
      let bestD = Infinity;
      handles.forEach((h) => {
        const d = Math.hypot(h.x - p.x, h.y - p.y);
        const reach = h.type === 'rotate' ? 26 : 20;
        if (d <= reach && d < bestD) { best = h; bestD = d; }
      });
      return best;
    }

    /* ---------- Pointer-gestik ---------- */

    function stagePoint(e) {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function onPointerDown(e) {
      if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) document.activeElement.blur();
      cancelAnimationFrame(camAnim);
      const p = stagePoint(e);
      pointers.set(e.pointerId, p);
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* Fx syntetiske events */ }
      e.preventDefault();

      if (pointers.size === 2) { startPinch(); return; }
      if (pointers.size > 2) return;
      if (e.pointerType === 'mouse' && e.button === 2) return;

      const w = toWorld(p);
      const isTouch = e.pointerType !== 'mouse';
      gesture = { id: e.pointerId, start: p, startW: w, last: p, moved: false, isTouch, threshold: isTouch ? 8 : 3 };

      if (e.button === 1) { gesture.type = 'pan'; return; }
      if (mode === 'draw') {
        if (view.draw.mode === 'free') {
          gesture.type = 'freedraw';
          draftPoints = [w];
          renderDraft();
        } else {
          gesture.type = 'pointghost';
          ghostPoint = w;
          renderDraft();
        }
        return;
      }
      if (mode === 'add') { gesture.type = 'pan'; gesture.placeOnTap = true; return; }

      const handle = hitHandle(p);
      if (handle) {
        gesture.type = handle.type === 'rotate' ? 'rotate' : 'pointmove';
        gesture.index = handle.index;
        return;
      }
      const hit = hitTest(w, isTouch);
      if (hit) {
        gesture.type = 'press';
        gesture.hit = hit;
        return;
      }
      gesture.type = 'pan';
      gesture.deselectOnTap = true;
    }

    function startPinch() {
      /* En anden finger annullerer alt igangværende, så intet flyttes ved et uheld, mens der zoomes. */
      if (gesture && gesture.type === 'freedraw') draftPoints = [];
      if (gesture && gesture.type === 'pointghost') ghostPoint = null;
      renderDraft();
      if (gesture && gesture.moved && (gesture.type === 'press' || gesture.type === 'rotate' || gesture.type === 'pointmove')) revert();
      dock.classList.remove('is-dragging');
      const pts = Array.from(pointers.values());
      gesture = {
        type: 'pinch',
        dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        cam: Object.assign({}, cam),
      };
      renderOverlay();
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      const p = stagePoint(e);
      pointers.set(e.pointerId, p);
      if (!gesture) return;

      if (gesture.type === 'pinch') {
        if (pointers.size < 2) return;
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const b = gesture.cam;
        const s = clamp(b.s * dist / gesture.dist, minScale(), maxScale());
        cam.s = s;
        cam.tx = mid.x - (gesture.mid.x - b.tx) * s / b.s;
        cam.ty = mid.y - (gesture.mid.y - b.ty) * s / b.s;
        markCamUser();
        applyCam();
        return;
      }
      if (e.pointerId !== gesture.id) return;

      if (!gesture.moved) {
        if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) < gesture.threshold) return;
        gesture.moved = true;
        beginDrag();
      }
      const w = toWorld(p);
      switch (gesture.type) {
        case 'pan':
          cam.tx += p.x - gesture.last.x;
          cam.ty += p.y - gesture.last.y;
          markCamUser();
          applyCam();
          break;
        case 'press': dragItem(w); break;
        case 'rotate': dragRotate(w); break;
        case 'pointmove': {
          const item = findSelected();
          if (item) {
            if (item.auto) dragAutoPoint(item, w);
            else item.points[gesture.index] = { x: Store.round2(w.x), y: Store.round2(w.y) };
            updateElement(selection);
            renderOverlay();
          }
          break;
        }
        case 'freedraw': {
          const lastPt = draftPoints[draftPoints.length - 1];
          if (Math.hypot(w.x - lastPt.x, w.y - lastPt.y) * cam.s >= 2) {
            draftPoints.push(w);
            renderDraft();
          }
          break;
        }
        case 'pointghost':
          ghostPoint = w;
          renderDraft();
          break;
        default:
      }
      gesture.last = p;
    }

    function nearestPoint(path, w) {
      let best = 0;
      let bestD = Infinity;
      path.points.forEach((q, i) => {
        const d = Math.hypot(q.x - w.x, q.y - w.y);
        if (d < bestD) { best = i; bestD = d; }
      });
      return best;
    }

    /* Trækker i en foreslået ridevej: naboerne følger blødt med, så linjen ikke får et knæk.
       Bevægelsen stopper ved punkterne på et spring, så resten af ruten bliver liggende. */
    function dragAutoPoint(path, w) {
      const reach = 9;
      const orig = gesture.orig.points;
      const i = gesture.index;
      const dx = w.x - orig[i].x;
      const dy = w.y - orig[i].y;
      const pins = path.pins || [];
      path.points[i] = { x: Store.round2(orig[i].x + dx), y: Store.round2(orig[i].y + dy) };
      [-1, 1].forEach((side) => {
        /* Falder helt til nul ved et spring, så linjen ikke får et knæk dér. */
        let span = reach + 1;
        for (let k = 1; k <= reach; k++) {
          if (pins.includes(i + side * k)) { span = k; break; }
        }
        for (let k = 1; k < span; k++) {
          const j = i + side * k;
          if (j < 0 || j >= orig.length) break;
          const weight = Math.cos(k * Math.PI / (2 * span)) ** 2;
          path.points[j] = { x: Store.round2(orig[j].x + dx * weight), y: Store.round2(orig[j].y + dy * weight) };
        }
      });
    }

    /* Første bevægelse ud over tærsklen: gør klar til træk. */
    function beginDrag() {
      if (gesture.type === 'press') {
        const hit = gesture.hit;
        const already = selection && selection.kind === hit.kind && selection.id === hit.id && selection.key === hit.key;
        gesture.label = already ? hit.onLabel : 0;
        if (!already) select(hit.kind === 'marker' ? { kind: hit.kind, key: hit.key } : { kind: hit.kind, id: hit.id }, true);
        const item = findSelected();
        gesture.orig = JSON.parse(JSON.stringify(item));
        dock.classList.add('is-dragging');
        /* En foreslået ridevej formes, hvor man tager fat, i stedet for at hele vejen flyttes. */
        if (hit.kind === 'path' && item.auto) {
          gesture.type = 'pointmove';
          gesture.index = nearestPoint(item, gesture.startW);
        }
      } else if (gesture.type === 'rotate' || gesture.type === 'pointmove') {
        const item = findSelected();
        if (item && item.auto) gesture.orig = JSON.parse(JSON.stringify(item));
        dock.classList.add('is-dragging');
      }
    }

    function dragItem(w) {
      const item = findSelected();
      if (!item) return;
      const dx = w.x - gesture.startW.x;
      const dy = w.y - gesture.startW.y;
      const orig = gesture.orig;
      if (selection.kind === 'obstacle') {
        if (gesture.label) {
          const r = -item.rotation * Math.PI / 180;
          const info = { 1: Scene.labelInfo, 2: Scene.label2Info, 3: Scene.label3Info }[gesture.label];
          const l = info(orig, ctx).local;
          const lx = l.x + dx * Math.cos(r) - dy * Math.sin(r);
          const ly = l.y + dx * Math.sin(r) + dy * Math.cos(r);
          const max = 12 * ctx.u;
          const len = Math.hypot(lx, ly);
          const k = len > max ? max / len : 1;
          item[{ 1: 'label', 2: 'label2', 3: 'label3' }[gesture.label]] = { x: Store.round2(lx * k), y: Store.round2(ly * k) };
        } else {
          movePoint(item, orig.x + dx, orig.y + dy);
        }
      } else if (selection.kind === 'decor') {
        movePoint(item, orig.x + dx, orig.y + dy);
      } else if (selection.kind === 'marker') {
        const key = selection.key;
        if (Scene.isFreeMarker(key)) {
          movePoint(item, orig.x + dx, orig.y + dy);
        } else {
          Object.assign(item, Scene.projectEdge(hall, w.x, w.y));
          syncLinkedGate();
        }
      } else {
        item.points = orig.points.map((q) => ({ x: Store.round2(q.x + dx), y: Store.round2(q.y + dy) }));
      }
      updateElement(selection);
      renderOverlay();
    }

    /* En samlet ind/ud er én boks: udgangen følger altid indgangens plads. */
    function syncLinkedGate() {
      const { entrance, exit } = course.markers;
      if (entrance && entrance.linked && exit) {
        exit.side = entrance.side;
        exit.pos = entrance.pos;
      }
    }

    function movePoint(item, x, y) {
      if (view.snap) {
        x = Math.round(x);
        y = Math.round(y);
      }
      item.x = Store.round2(clamp(x, 0, hall.length));
      item.y = Store.round2(clamp(y, 0, hall.width));
    }

    function snapAngle(a) {
      const step = view.rotationStep;
      return Store.normAngle(step ? Math.round(a / step) * step : Math.round(a));
    }

    function dragRotate(w) {
      const o = findSelected();
      if (!o) return;
      /* Håndtaget sidder på springets lokale +y-akse, altså 90° fra rotationen. */
      const a = Math.atan2(w.y - o.y, w.x - o.x) * 180 / Math.PI - 90;
      o.rotation = snapAngle(a);
      updateElement(selection);
      renderOverlay();
      showHint(fmtNum(shownAngle(o), 0) + '°', false, 900);
    }

    function onPointerUp(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* Allerede frigivet */ }
      if (!gesture) return;

      if (gesture.type === 'pinch') {
        /* Når én finger løftes, må den anden ikke pludselig blive til en panorering eller et tryk. */
        if (pointers.size === 0) { gesture = null; renderOverlay(); }
        return;
      }
      if (e.pointerId !== gesture.id) return;
      const g = gesture;
      gesture = null;
      dock.classList.remove('is-dragging');
      const p = stagePoint(e);

      switch (g.type) {
        case 'pan':
          if (!g.moved) {
            if (g.placeOnTap && addKind) placeAt(addKind, toWorld(p));
            else if (g.deselectOnTap) select(null);
          }
          break;
        case 'press':
          if (!g.moved) {
            select(g.hit.kind === 'marker' ? { kind: 'marker', key: g.hit.key } : { kind: g.hit.kind, id: g.hit.id });
          } else {
            commit();
            renderCtx();
            ensureVisible();
          }
          break;
        case 'rotate':
        case 'pointmove':
          commit();
          renderCtx();
          break;
        case 'freedraw':
          finishFreehand();
          break;
        case 'pointghost':
          draftPoints.push(toWorld(p));
          ghostPoint = null;
          renderDraft();
          renderCtx();
          break;
        default:
      }
    }

    function onPointerCancel(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.type === 'pinch') {
        if (pointers.size === 0) gesture = null;
        return;
      }
      if (e.pointerId !== gesture.id) return;
      const type = gesture.type;
      gesture = null;
      dock.classList.remove('is-dragging');
      if (type === 'freedraw') { draftPoints = []; renderDraft(); }
      else if (type === 'pointghost') { ghostPoint = null; renderDraft(); }
      else revert();
      renderOverlay();
    }

    function onWheel(e) {
      e.preventDefault();
      const p = stagePoint(e);
      /* Trackpad: to fingre panorerer, knib (ctrlKey) zoomer. Musehjul zoomer. */
      const looksLikeTrackpad = !e.ctrlKey && e.deltaMode === 0 && (e.deltaX !== 0 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)));
      if (looksLikeTrackpad) {
        cam.tx -= e.deltaX;
        cam.ty -= e.deltaY;
        markCamUser();
        applyCam();
        return;
      }
      const unit = e.deltaMode === 1 ? 16 : 1;
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0016)));
    }

    /* ---------- Rideveje ---------- */

    /* Ramer-Douglas-Peucker: fjerner overflødige punkter, så frihånd bliver glat og fylder lidt. */
    function simplify(points, tol) {
      if (points.length < 3) return points.slice();
      const keep = new Array(points.length).fill(false);
      keep[0] = true;
      keep[points.length - 1] = true;
      const stack = [[0, points.length - 1]];
      while (stack.length) {
        const [a, b] = stack.pop();
        let maxD = 0;
        let idx = -1;
        for (let i = a + 1; i < b; i++) {
          const d = distSegment(points[i], points[a], points[b]);
          if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > tol && idx > 0) {
          keep[idx] = true;
          stack.push([a, idx], [idx, b]);
        }
      }
      return points.filter((_, i) => keep[i]);
    }

    function addPath(points, pathMode, smooth) {
      const d = view.draw;
      course.paths.push({
        id: Store.uid('p'),
        mode: pathMode,
        points: points.map((q) => ({ x: Store.round2(q.x), y: Store.round2(q.y) })),
        style: d.style,
        width: d.width,
        dash: d.dash,
        color: d.color,
        arrows: d.arrows,
        smooth,
      });
      commit();
    }

    function finishFreehand() {
      const pts = draftPoints;
      draftPoints = [];
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (pts.length >= 2 && len * cam.s >= 12) addPath(simplify(pts, 2.2 / cam.s), 'free', true);
      renderAll();
    }

    function finishPoints() {
      if (draftPoints.length >= 2) addPath(draftPoints, 'points', view.draw.smooth);
      else if (draftPoints.length) showHint('En ridevej skal have mindst to punkter.', false, 2200);
      draftPoints = [];
      ghostPoint = null;
      renderAll();
    }

    /* Laver en ridevej ud fra springenes numre og pile. En tidligere foreslået ridevej erstattes. */
    function generateRoute() {
      const route = Route.generate(hall, course);
      if (!route) {
        showHint('Giv springene numre først, så ved appen, hvilken vej banen går.', false, 3200);
        return;
      }
      draftPoints = [];
      ghostPoint = null;
      const d = view.draw;
      const path = {
        id: Store.uid('p'),
        mode: 'points',
        points: route.points,
        style: d.style,
        width: d.width,
        dash: d.dash,
        color: d.color,
        arrows: d.arrows,
        smooth: true,
        auto: true,
        pins: route.pins,
      };
      course.paths = course.paths.filter((p) => !p.auto).concat(path);
      commit();
      setMode('select', { keepSelection: true });
      selection = { kind: 'path', id: path.id };
      renderAll();
      showHint('Ridevejen er lavet. Træk i linjen, hvis du vil rette den.', false, 3500);
    }

    function removeLastPoint() {
      draftPoints.pop();
      renderDraft();
      renderCtx();
    }

    /* ---------- Handlinger ---------- */

    function nextNumber() {
      let max = 0;
      course.obstacles.forEach((o) => {
        (String(o.number + ' ' + (o.number3 || '')).match(/\d+/g) || []).forEach((n) => { max = Math.max(max, +n); });
      });
      return String(max + 1);
    }

    function addObstacle(type, x, y) {
      const d = Store.OBSTACLE_DEFAULTS[type];
      const o = {
        id: Store.uid('o'),
        type,
        x: 0,
        y: 0,
        rotation: 0,
        number: view.autoNumber && type !== 'pole' ? nextNumber() : '',
        number2: '',
        number3: '',
        showNumber: true,
        showArrow: true,
        bothWays: false,
        label2: null,
        label3: null,
        width: d.width,
        depth: d.depth,
        label: null,
      };
      movePoint(o, x, y);
      course.obstacles.push(o);
      return o;
    }

    /* Udfører det valgte værktøj på et punkt på banen. */
    async function placeAt(kind, w) {
      if (Store.OBSTACLE_TYPES.includes(kind)) {
        const o = addObstacle(kind, w.x, w.y);
        commit();
        afterPlace({ kind: 'obstacle', id: o.id });
        if (!view.autoNumber && kind !== 'pole') {
          const input = root.querySelector('[data-field="number"]');
          if (input) input.focus();
        }
        return;
      }
      if (Store.DECOR_TYPES.includes(kind)) {
        const d = { id: Store.uid('d'), type: kind, x: 0, y: 0, rotation: 0, diameter: Store.DECOR_SIZES[kind] };
        movePoint(d, w.x, w.y);
        decorations().push(d);
        commit();
        afterPlace({ kind: 'decor', id: d.id });
        return;
      }
      if (Scene.isFreeMarker(kind)) {
        const existing = course.markers[kind];
        const pos = { x: Store.round2(clamp(w.x, 0, hall.length)), y: Store.round2(clamp(w.y, 0, hall.width)) };
        if (existing) {
          const name = MARKER_NAMES[kind];
          const choice = await UI.openDialog({
            title: 'Der er allerede en ' + name + '-markering',
            body: '<p>En bane kan kun have én ' + name + '-markering. Vil du flytte den eksisterende hertil eller erstatte den med en ny?</p>',
            actions: [
              { label: 'Flyt den hertil', value: 'move', kind: 'primary' },
              { label: 'Erstat med en ny', value: 'replace', kind: 'secondary' },
              { label: 'Annullér', value: null, kind: 'ghost' },
            ],
          });
          if (!choice) return;
          if (choice === 'move') Object.assign(existing, pos);
          else course.markers[kind] = Object.assign({ id: Store.uid('m') }, pos);
        } else {
          course.markers[kind] = Object.assign({ id: Store.uid('m') }, pos);
        }
        commit();
        afterPlace({ kind: 'marker', key: kind });
        return;
      }
      const edge = Scene.projectEdge(hall, w.x, w.y);
      if (kind === 'judge') {
        const moved = !!course.markers.judge;
        course.markers.judge = Object.assign({ id: moved ? course.markers.judge.id : Store.uid('m') }, edge);
        commit();
        afterPlace({ kind: 'marker', key: 'judge' });
        if (moved) showHint('Dommeren er flyttet hertil.', false, 2000);
        return;
      }
      /* Ind/ud: sætter det, der mangler efter en adskillelse. Ellers placeres de som én samlet boks. */
      const m = course.markers;
      if (m.entrance && !m.exit) {
        m.exit = Object.assign({ id: Store.uid('m') }, edge);
        selection = { kind: 'marker', key: 'exit' };
      } else if (m.exit && !m.entrance) {
        m.entrance = Object.assign({ id: Store.uid('m') }, edge);
        selection = { kind: 'marker', key: 'entrance' };
      } else {
        m.entrance = Object.assign({ id: m.entrance ? m.entrance.id : Store.uid('m'), linked: true }, edge);
        m.exit = Object.assign({ id: m.exit ? m.exit.id : Store.uid('m') }, edge);
        selection = { kind: 'marker', key: 'entrance' };
      }
      commit();
      afterPlace(selection);
    }

    /* Efter en placering: tilbage til Vælg/flyt med det nye element valgt, klar til at dreje. */
    function afterPlace(sel) {
      setMode('select', { keepSelection: true });
      selection = sel;
      renderAll();
      ensureVisible();
    }

    function select(sel, quiet) {
      selection = sel;
      renderOverlay();
      renderCtx();
      if (!quiet) ensureVisible();
    }

    /* På mobil ligger panelet over banen. Skub banen op, hvis det valgte ville blive skjult. */
    function ensureVisible() {
      if (sideLayout.matches) return;
      const item = findSelected();
      if (!item) {
        if (autoPan && autoPan.stamp === camStamp) {
          animateCam({ s: cam.s, tx: cam.tx, ty: cam.ty - autoPan.dy });
        }
        autoPan = null;
        return;
      }
      let w = null;
      if (selection.kind === 'obstacle' || selection.kind === 'decor' || Scene.isFreeMarker(selection.key)) w = item;
      else if (selection.kind === 'marker') {
        const g = Scene.edgeGeom(selection.key, item, ctx);
        w = { x: g.cx, y: g.cy };
      } else w = item.points[Math.floor(item.points.length / 2)];
      const p = toScreen(w.x, w.y);
      const size = stageSize();
      let reach = 30;
      if (selection.kind === 'obstacle') reach = Scene.obstacleGeom(item, ctx).halfY * cam.s + 50;
      else if (Scene.isFreeMarker(selection.key)) reach = Scene.freeMarkerSize(selection.key, item, ctx).hh * cam.s + 50;
      const limit = size.h - ctxEl.offsetHeight - 6;
      const over = p.y + reach - limit;
      const prior = autoPan && autoPan.stamp === camStamp ? autoPan.dy : 0;
      if (over > 0) {
        const dy = -over;
        autoPan = { dy: prior + dy, stamp: camStamp };
        animateCam({ s: cam.s, tx: cam.tx, ty: cam.ty + dy });
      }
    }

    function selectedObstacle() {
      return selection && selection.kind === 'obstacle' ? findSelected() : null;
    }

    /* Det valgte element, hvis det kan drejes: et spring eller START, MÅL og MÅL/START. */
    function selectedTurnable() {
      return selection && (selection.kind === 'obstacle' || selection.kind === 'decor' || Scene.isFreeMarker(selection.key)) ? findSelected() : null;
    }

    function worldAngle(item) {
      return selection.kind === 'marker' ? Scene.freeMarkerAngle(item, ctx) : item.rotation;
    }

    /* Vinklen i panelet. For markeringer er 0° opret på skærmen, også når hallen vises på højkant. */
    function shownAngle(item) {
      return selection.kind === 'marker' ? Store.normAngle(worldAngle(item) + rot) : item.rotation;
    }

    function fieldValue(item, field) {
      if (field === 'rotation') return shownAngle(item);
      if (field === 'size') return item.size || 100;
      return item[field];
    }

    function rotateBy(delta) {
      const o = selectedTurnable();
      if (!o) return;
      o.rotation = Store.normAngle(worldAngle(o) + delta);
      commit();
      updateElement(selection);
      renderOverlay();
      syncAngleFields(o);
    }

    function syncAngleFields(o) {
      const a = root.querySelector('[data-field="rotation"]');
      if (a && a !== document.activeElement) a.value = fmtNum(shownAngle(o), 1);
      const b = root.querySelector('[data-show="angle"]');
      if (b) b.textContent = fmtNum(shownAngle(o), 0) + '°';
    }

    function duplicate() {
      if (!selection) return;
      if (selection.kind === 'obstacle') {
        const o = findSelected();
        const copy = JSON.parse(JSON.stringify(o));
        copy.id = Store.uid('o');
        movePoint(copy, o.x + 2 * ctx.u, o.y + 2 * ctx.u);
        if (copy.x === o.x && copy.y === o.y) movePoint(copy, o.x - 2 * ctx.u, o.y - 2 * ctx.u);
        if (view.autoNumber && /^\d+$/.test(o.number)) copy.number = nextNumber();
        course.obstacles.push(copy);
        selection = { kind: 'obstacle', id: copy.id };
      } else if (selection.kind === 'decor') {
        const d = findSelected();
        const copy = JSON.parse(JSON.stringify(d));
        copy.id = Store.uid('d');
        movePoint(copy, d.x + 2 * ctx.u, d.y + 2 * ctx.u);
        if (copy.x === d.x && copy.y === d.y) movePoint(copy, d.x - 2 * ctx.u, d.y - 2 * ctx.u);
        decorations().push(copy);
        selection = { kind: 'decor', id: copy.id };
      } else if (selection.kind === 'path') {
        const p = findSelected();
        const copy = JSON.parse(JSON.stringify(p));
        copy.id = Store.uid('p');
        copy.points.forEach((q) => { q.x = Store.round2(q.x + 1.5 * ctx.u); q.y = Store.round2(q.y + 1.5 * ctx.u); });
        course.paths.push(copy);
        selection = { kind: 'path', id: copy.id };
      } else return;
      commit();
      renderAll();
    }

    function removeSelected() {
      if (!selection) return;
      if (selection.kind === 'obstacle') course.obstacles = course.obstacles.filter((o) => o.id !== selection.id);
      else if (selection.kind === 'path') course.paths = course.paths.filter((p) => p.id !== selection.id);
      else if (selection.kind === 'decor') course.decorations = decorations().filter((d) => d.id !== selection.id);
      else {
        const e = course.markers.entrance;
        if (selection.key === 'entrance' && e && e.linked) course.markers.exit = null;
        course.markers[selection.key] = null;
      }
      selection = null;
      commit();
      renderAll();
      showHint('Slettet. Tryk Fortryd for at få det tilbage.', false, 2200);
      ensureVisible();
    }

    function nudge(dx, dy) {
      const item = findSelected();
      if (!item || selection.kind === 'path') return;
      if (selection.kind === 'marker' && !('x' in item)) return;
      item.x = Store.round2(clamp(item.x + dx, 0, hall.length));
      item.y = Store.round2(clamp(item.y + dy, 0, hall.width));
      commit();
      updateElement(selection);
      renderOverlay();
    }

    function renumberAll() {
      let n = 1;
      course.obstacles.forEach((o) => {
        if (o.type !== 'pole') o.number = String(n++);
      });
      commit();
      renderAll();
    }

    function clearPaths() {
      if (!course.paths.length) { toast('Der er ingen rideveje at rydde.'); return; }
      UI.confirmDialog('Ryd alle rideveje?', 'Alle ' + course.paths.length + ' rideveje fjernes. Springene bliver stående, og du kan fortryde bagefter.', 'Ryd rideveje', true).then((ok) => {
        if (!ok) return;
        course.paths = [];
        if (selection && selection.kind === 'path') selection = null;
        commit();
        renderAll();
      });
    }

    /* ---------- Tilstande og hjælpetekst ---------- */

    function setMode(next, opts) {
      if (mode === 'draw' && next !== 'draw' && draftPoints.length) finishPoints();
      mode = next;
      addKind = null;
      if (!(opts && opts.keepSelection)) selection = null;
      if (next === 'draw') showHint(drawHint(), true);
      else if (next === 'add') showHint('Vælg, hvad du vil tilføje. Du kan også trække det ind på banen.', true);
      else hideHint();
      renderModes();
      renderCtx();
      renderOverlay();
      stage.dataset.mode = next;
    }

    function drawHint() {
      return view.draw.mode === 'free'
        ? 'Tegn med fingeren. To fingre zoomer og flytter visningen.'
        : 'Tryk for at sætte punkter. Afslut med Færdig.';
    }

    function showHint(text, sticky, ms) {
      clearTimeout(hintTimer);
      hintEl.textContent = text;
      hintEl.classList.add('show');
      if (!sticky) {
        hintTimer = setTimeout(() => {
          if (mode === 'draw') hintEl.textContent = drawHint();
          else if (mode === 'add') {
            const t = TILES.find((q) => q.kind === addKind);
            hintEl.textContent = t ? t.hint : 'Vælg, hvad du vil tilføje.';
          } else hintEl.classList.remove('show');
        }, ms || 2000);
      }
    }

    function hideHint() {
      clearTimeout(hintTimer);
      hintEl.classList.remove('show');
    }

    /* ---------- Paneler ---------- */

    function renderModes() {
      root.querySelectorAll('[data-mode]').forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
      });
    }

    function seg(group, options, value) {
      return '<div class="seg" role="group">' + options.map((o) =>
        '<button type="button" class="' + (o[0] === value ? 'on' : '') + '" data-seg="' + group + '" data-val="' + o[0] + '"' + (o[2] ? ' aria-label="' + esc(o[2]) + '"' : '') + '>' + o[1] + '</button>').join('') + '</div>';
    }

    function actBtn(act, ic, label, extra) {
      return '<button type="button" class="act ' + (extra || '') + '" data-act="' + act + '">' + icon(ic) + '<span>' + esc(label) + '</span></button>';
    }

    function stepper(field, label, value, suffix) {
      return '<div class="row-field"><span class="row-label">' + esc(label) + '</span><div class="stepper">' +
        '<button type="button" data-step="' + field + '" data-dir="-1" aria-label="Mindre">' + icon('minus') + '</button>' +
        '<span class="stepper-in"><input data-field="' + field + '" inputmode="decimal" value="' + esc(fmtNum(value, 1)) + '" aria-label="' + esc(label) + '"><em>' + suffix + '</em></span>' +
        '<button type="button" data-step="' + field + '" data-dir="1" aria-label="Større">' + icon('plus') + '</button></div></div>';
    }

    function styleControls(d) {
      const line = (dash) => '<svg viewBox="0 0 44 10" width="44" height="10" aria-hidden="true"><line x1="3" y1="5" x2="41" y2="5" stroke="currentColor" stroke-width="3" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/></svg>';
      return '<div class="row-field"><span class="row-label">Streg</span>' + seg('style', [['solid', line(''), 'Fuldt optrukket'], ['dashed', line('7 6'), 'Stiplet'], ['dotted', line('0 6'), 'Prikket']], d.style) + '</div>' +
        rangeField('thickness', 'Tykkelse', thicknessOf(d), 10, 0.5) +
        rangeField('dash', 'Længde af stregerne', d.dash == null ? 10 : d.dash, 100, 1) +
        '<div class="row-field"><span class="row-label">Farve</span><div class="swatches">' + Store.PATH_COLORS.map((c) =>
          '<button type="button" class="swatch ' + (c === d.color ? 'on' : '') + '" data-color="' + c + '" style="--c:' + c + '" aria-label="Farve ' + c + '"></button>').join('') + '</div></div>' +
        '<div class="row-field"><span class="row-label">Pile på linjen</span>' + toggle('arrows', d.arrows) + '</div>' +
        '<div class="row-field"><span class="row-label">Afrundet</span>' + toggle('smooth', d.smooth) + '</div>';
    }

    function rangeField(name, label, value, max, step) {
      return '<div class="row-field col"><span class="row-label">' + esc(label) + ' <b data-range-val="' + name + '">' + fmtNum(value, 1) + '</b></span>' +
        '<input type="range" min="0" max="' + max + '" step="' + step + '" value="' + value + '" data-range="' + name + '" aria-label="' + esc(label) + '"></div>';
    }

    /* Tykkelsen vises fra 0 til 10. I data er width en faktor fra 0 til 4. */
    function thicknessOf(d) {
      return Math.round(d.width * WIDTH_PER_STEP_INV * 2) / 2;
    }

    /* Følger skyderen, mens der trækkes. Fortryd-trinnet laves først, når fingeren slippes. */
    function setLineRange(name, value) {
      const t = styleTarget();
      if (name === 'thickness') {
        t.width = Store.round2(value / WIDTH_PER_STEP_INV);
      } else {
        t.dash = value;
        /* Længden betyder kun noget på en stiplet linje. */
        if (t.style !== 'dashed') {
          t.style = 'dashed';
          root.querySelectorAll('[data-seg="style"]').forEach((b) => b.classList.toggle('on', b.dataset.val === 'dashed'));
        }
      }
      const shown = root.querySelector('[data-range-val="' + name + '"]');
      if (shown) shown.textContent = fmtNum(value, 1);
      if (selection && selection.kind === 'path') {
        updateElement(selection);
        renderOverlay();
      } else {
        renderDraft();
      }
    }

    function toggle(name, on) {
      return '<button type="button" class="switch ' + (on ? 'on' : '') + '" role="switch" aria-checked="' + (!!on) + '" data-toggle="' + name + '"><i></i></button>';
    }

    function duplicateWarning(o) {
      if (!o.number) return '';
      const n = course.obstacles.filter((q) => q !== o && q.number === o.number).length;
      return n ? 'Nummer ' + o.number + ' bruges også af et andet spring. Det er tilladt, f.eks. ved kombinationer.' : '';
    }

    function renderCtx() {
      let html = '';
      const item = findSelected();
      ctxEl.className = 'ctx';
      if (mode === 'add') {
        ctxEl.classList.add('ctx-tiles');
        html = '<div class="tiles">' + TILES.map((t) =>
          '<button type="button" class="tile ' + (addKind === t.kind ? 'on' : '') + '" data-tile="' + t.kind + '">' + icon(tileIcon(t.kind)) + '<span>' + t.label + '</span></button>').join('') + '</div>';
      } else if (mode === 'draw') {
        html = drawPanel();
      } else if (item && selection.kind === 'obstacle') {
        html = obstaclePanel(item);
      } else if (item && selection.kind === 'marker') {
        html = markerPanel(item);
      } else if (item && selection.kind === 'decor') {
        html = decorPanel(item);
      } else if (item && selection.kind === 'path') {
        html = pathPanel(item);
      } else if (sideLayout.matches) {
        html = '<p class="ctx-empty">Tryk på et element for at redigere det, eller træk i det for at flytte det. Træk på den tomme bane for at flytte visningen.</p>';
      }
      ctxEl.innerHTML = html;
      ctxEl.hidden = !html;
      dock.classList.toggle('has-ctx', !!html);
    }

    function tileIcon(kind) {
      return kind;
    }

    function panelHead(title) {
      return '<div class="ctx-head"><strong>' + esc(title) + '</strong><button type="button" class="iconbtn sm" data-act="deselect" aria-label="Luk">' + icon('close') + '</button></div>';
    }

    function obstaclePanel(o) {
      const warn = duplicateWarning(o);
      let more = '<div class="ctx-more ' + (moreOpen ? 'open' : '') + '">' +
        stepper('rotation', 'Præcis vinkel', o.rotation, '°') +
        '<div class="row-field"><span class="row-label">Drej i trin</span>' + seg('rotationStep', STEPS, view.rotationStep) + '</div>' +
        stepper('width', 'Bredde', o.width, 'm');
      if (o.type === 'oxer' || o.type === 'triple') more += stepper('depth', o.type === 'triple' ? 'Dybde (første til sidste)' : 'Afstand mellem dele', o.depth, 'm');
      more += '<div class="row-field"><span class="row-label">Ekstra nr. i rød ring</span><input class="small-input" data-field="number2" value="' + esc(o.number2) + '" maxlength="8" autocomplete="off" enterkeyhint="done" placeholder="–" aria-label="Ekstra nummer"></div>';
      more += '<div class="row-field"><span class="row-label">Pil begge veje</span>' + toggle('bothWays', o.bothWays) + '</div>';
      if (o.bothWays) more += '<div class="row-field"><span class="row-label">Nr. den anden vej</span><input class="small-input" data-field="number3" value="' + esc(o.number3) + '" maxlength="8" autocomplete="off" autocapitalize="characters" enterkeyhint="done" placeholder="–" aria-label="Nummer den anden vej"></div>';
      if (o.type === 'pole') more += '<div class="row-field"><span class="row-label">Vis retningspil</span>' + toggle('showArrow', o.showArrow) + '</div>';
      if (o.label || o.label2 || o.label3) more += '<button type="button" class="linkbtn" data-act="resetLabel">Sæt numrene tilbage til standardplacering</button>';
      more += '</div>';
      return panelHead(TYPE_NAMES[o.type]) +
        '<div class="act-row">' +
        actBtn('rotl', 'rotl', 'Drej venstre') + actBtn('rotr', 'rotr', 'Drej højre') + actBtn('flip', 'flip', 'Vend 180°') +
        actBtn('copy', 'copy', 'Kopier') + actBtn('delete', 'trash', 'Slet', 'danger') +
        '</div>' +
        '<div class="num-row">' +
        '<label class="num-field"><span>Nr.</span><input data-field="number" value="' + esc(o.number) + '" maxlength="8" autocomplete="off" autocapitalize="characters" enterkeyhint="done" placeholder="–"></label>' +
        '<button type="button" class="chip ' + (o.showNumber ? '' : 'off') + '" data-act="toggleNumber" aria-pressed="' + o.showNumber + '">' + icon(o.showNumber ? 'eye' : 'eyeoff') + '<span>' + (o.showNumber ? 'Vist' : 'Skjult') + '</span></button>' +
        '<button type="button" class="chip more-toggle ' + (moreOpen ? 'open' : '') + '" data-act="more" aria-expanded="' + moreOpen + '"><span data-show="angle">' + fmtNum(o.rotation, 0) + '°</span><span class="more-word">Mere</span>' + icon('chevron') + '</button>' +
        '</div>' +
        '<p class="ctx-warn" data-warn' + (warn ? '' : ' hidden') + '>' + esc(warn) + '</p>' + more;
    }

    function markerPanel(m) {
      const key = selection.key;
      const free = Scene.isFreeMarker(key);
      const isGate = key === 'entrance' || key === 'exit';
      const { entrance, exit } = course.markers;
      const linked = key === 'entrance' && m.linked;
      let gateBtn = '';
      if (linked) gateBtn = actBtn('splitGate', 'flip', 'Adskil ind og ud');
      else if (isGate && entrance && exit) gateBtn = actBtn('joinGate', 'gate', 'Saml ind og ud');
      return panelHead(linked ? 'Ind/ud' : MARKER_NAMES[key]) +
        '<p class="ctx-note">' + (free ? 'Træk markeringen rundt på banen. Drej den med håndtaget eller knapperne.' : 'Træk markeringen langs væggene.') + '</p>' +
        '<div class="act-row">' +
        (free ? actBtn('rotl', 'rotl', 'Drej venstre') + actBtn('rotr', 'rotr', 'Drej højre') + actBtn('flip', 'flip', 'Vend 180°') : actBtn('nextSide', 'rotr', 'Næste væg')) + gateBtn +
        actBtn('delete', 'trash', 'Slet', 'danger') + '</div>' +
        (free ? '<div class="ctx-more open">' + stepper('size', 'Størrelse', fieldValue(m, 'size'), '%') + stepper('rotation', 'Præcis vinkel', shownAngle(m), '°') + '</div>' : '');
    }

    function decorPanel(d) {
      return panelHead(DECOR_NAMES[d.type]) +
        '<div class="act-row">' +
        actBtn('rotl', 'rotl', 'Drej venstre') + actBtn('rotr', 'rotr', 'Drej højre') +
        actBtn('copy', 'copy', 'Kopier') + actBtn('delete', 'trash', 'Slet', 'danger') + '</div>' +
        '<div class="ctx-more open">' + stepper('diameter', d.type === 'flowers' ? 'Længde' : 'Størrelse', d.diameter, 'm') + '</div>';
    }

    function pathPanel(p) {
      return panelHead('Ridevej') +
        '<div class="act-row">' + actBtn('copy', 'copy', 'Kopier') + actBtn('delete', 'trash', 'Slet', 'danger') + '</div>' +
        '<div class="ctx-more open">' + styleControls(p) + '</div>';
    }

    function drawPanel() {
      const d = view.draw;
      const points = d.mode === 'points';
      let html = '<button type="button" class="btn primary route-btn" data-act="generateRoute">' + icon('wand') + '<span>Generer ridevej</span></button>' +
        '<div class="draw-row">' +
        seg('drawMode', [['free', icon('free') + '<span>Frihånd</span>'], ['points', icon('points') + '<span>Punkter</span>']], d.mode) +
        '<button type="button" class="chip more-toggle ' + (drawStyleOpen ? 'open' : '') + '" data-act="drawStyle" aria-expanded="' + drawStyleOpen + '"><span class="draw-sample" style="border-top-color:' + esc(d.color) + ';border-top-style:' + d.style + '"></span><span>Stil</span>' + icon('chevron') + '</button>' +
        '</div>';
      if (points) {
        html += '<div class="draw-row draw-points">' +
          '<button type="button" class="btn ghost" data-act="pointBack"' + (draftPoints.length ? '' : ' disabled') + '>' + icon('undo') + '<span>Fjern punkt</span></button>' +
          '<button type="button" class="btn primary" data-act="pointDone"' + (draftPoints.length >= 2 ? '' : ' disabled') + '>' + icon('check') + '<span>Færdig (' + draftPoints.length + ')</span></button>' +
          '</div>';
      }
      html += '<div class="ctx-more ' + (drawStyleOpen ? 'open' : '') + '">' + styleControls(d) +
        '<button type="button" class="linkbtn danger" data-act="clearPaths">Ryd alle rideveje</button></div>';
      return html;
    }

    /* ---------- Panel-hændelser (delegeret) ---------- */

    function onDockClick(e) {
      const modeBtn = e.target.closest('[data-mode]');
      if (modeBtn) { setMode(modeBtn.dataset.mode); return; }
      const tile = e.target.closest('[data-tile]');
      if (tile) {
        if (suppressTileClick) { suppressTileClick = false; return; }
        addKind = tile.dataset.tile;
        const t = TILES.find((q) => q.kind === addKind);
        showHint(t.hint, true);
        root.querySelectorAll('[data-tile]').forEach((b) => b.classList.toggle('on', b === tile));
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) { doAction(act.dataset.act); return; }
      const segBtn = e.target.closest('[data-seg]');
      if (segBtn) { setSeg(segBtn.dataset.seg, segBtn.dataset.val); return; }
      const tog = e.target.closest('[data-toggle]');
      if (tog) { setToggle(tog.dataset.toggle); return; }
      const colorBtn = e.target.closest('[data-color]');
      if (colorBtn) { styleTarget().color = colorBtn.dataset.color; styleChanged(); return; }
      const stepBtn = e.target.closest('[data-step]');
      if (stepBtn) stepField(stepBtn.dataset.step, +stepBtn.dataset.dir);
    }

    function doAction(act) {
      const o = selectedObstacle();
      const step = view.rotationStep || 15;
      switch (act) {
        case 'rotl': rotateBy(-step); break;
        case 'rotr': rotateBy(step); break;
        case 'flip': rotateBy(180); break;
        case 'copy': duplicate(); break;
        case 'delete': removeSelected(); break;
        case 'deselect': select(null); break;
        case 'more': moreOpen = !moreOpen; renderCtx(); ensureVisible(); break;
        case 'drawStyle': drawStyleOpen = !drawStyleOpen; renderCtx(); break;
        case 'toggleNumber':
          if (o) { o.showNumber = !o.showNumber; commit(); updateElement(selection); renderOverlay(); renderCtx(); }
          break;
        case 'resetLabel':
          if (o) { o.label = null; o.label2 = null; o.label3 = null; commit(); updateElement(selection); renderOverlay(); renderCtx(); }
          break;
        case 'nextSide': {
          const m = findSelected();
          const sides = Store.SIDES;
          const side = sides[(sides.indexOf(m.side) + 1) % 4];
          m.side = side;
          m.pos = Store.round2(Scene.sideLength(hall, side) / 2);
          syncLinkedGate();
          commit();
          renderAll();
          break;
        }
        case 'splitGate': {
          const { entrance, exit } = course.markers;
          const gap = 5 * ctx.u;
          delete entrance.linked;
          const len = Scene.sideLength(hall, entrance.side);
          exit.pos = Store.round2(entrance.pos + gap <= len ? entrance.pos + gap : Math.max(0, entrance.pos - gap));
          commit();
          renderAll();
          break;
        }
        case 'joinGate':
          course.markers.entrance.linked = true;
          syncLinkedGate();
          selection = { kind: 'marker', key: 'entrance' };
          commit();
          renderAll();
          break;
        case 'pointBack': removeLastPoint(); break;
        case 'pointDone': finishPoints(); break;
        case 'clearPaths': clearPaths(); break;
        case 'distances': openDistances(); break;
        case 'generateRoute':
          /* Beregningen kan tage et par sekunder på en telefon, så vis først, at der sker noget. */
          showHint('Laver ridevej…', true);
          setTimeout(generateRoute, 30);
          break;
        default:
      }
    }

    function styleTarget() {
      return selection && selection.kind === 'path' ? findSelected() : view.draw;
    }

    function styleChanged() {
      if (selection && selection.kind === 'path') {
        commit();
        updateElement(selection);
        renderOverlay();
      } else {
        Store.touchCourse(course);
        renderDraft();
      }
      renderCtx();
    }

    function setSeg(group, val) {
      if (group === 'rotationStep') {
        view.rotationStep = +val;
        Store.touchCourse(course);
        renderCtx();
      } else if (group === 'style') {
        styleTarget().style = val;
        styleChanged();
      } else if (group === 'drawMode') {
        if (draftPoints.length) finishPoints();
        view.draw.mode = val;
        Store.touchCourse(course);
        showHint(drawHint(), true);
        renderCtx();
      }
    }

    function setToggle(name) {
      if (name === 'showArrow' || name === 'bothWays') {
        const o = selectedObstacle();
        if (o) { o[name] = !o[name]; commit(); updateElement(selection); renderOverlay(); renderCtx(); }
        /* Det nye nummerfelt kan ligge under panelets kant på en telefon. */
        const added = name === 'bothWays' && root.querySelector('[data-field="number3"]');
        if (added) added.scrollIntoView({ block: 'nearest' });
        return;
      }
      const t = styleTarget();
      t[name] = !t[name];
      styleChanged();
    }

    const FIELD_RANGE = { width: [0.5, 15, 0.5], depth: [0.3, 6, 0.1], size: [40, 300, 10], diameter: [0.5, 15, 0.5] };

    function setField(field, value) {
      const o = selectedTurnable();
      if (!o) return;
      if (field === 'rotation') {
        o.rotation = Store.normAngle(Math.round(value * 10) / 10 + worldAngle(o) - shownAngle(o));
      } else {
        const r = FIELD_RANGE[field];
        o[field] = Store.round2(clamp(value, r[0], r[1]));
      }
      commit();
      updateElement(selection);
      renderOverlay();
      const input = root.querySelector('[data-field="' + field + '"]');
      if (input && input !== document.activeElement) input.value = fmtNum(fieldValue(o, field), 1);
      syncAngleFields(o);
    }

    function stepField(field, dir) {
      const o = selectedTurnable();
      if (!o) return;
      if (field === 'rotation') { rotateBy(dir * (view.rotationStep || 15)); return; }
      setField(field, fieldValue(o, field) + dir * FIELD_RANGE[field][2]);
    }

    function onDockInput(e) {
      const input = e.target;
      if (input.dataset.range) { setLineRange(input.dataset.range, +input.value); return; }
      const field = input.dataset.field;
      if (field !== 'number' && field !== 'number2' && field !== 'number3') return;
      const o = selectedObstacle();
      if (!o) return;
      o[field] = input.value.trim().slice(0, 8);
      updateElement(selection);
      renderOverlay();
      const warnEl = root.querySelector('[data-warn]');
      if (warnEl) {
        const w = duplicateWarning(o);
        warnEl.textContent = w;
        warnEl.hidden = !w;
      }
    }

    function onDockChange(e) {
      const input = e.target;
      if (input.dataset.range) { styleChanged(); return; }
      const field = input.dataset.field;
      if (!field) return;
      if (field === 'number' || field === 'number2' || field === 'number3') { commit(); return; }
      const v = parseNum(input.value);
      const o = selectedTurnable();
      if (isNaN(v)) {
        if (o) input.value = fmtNum(fieldValue(o, field), 1);
        return;
      }
      setField(field, v);
      if (o) input.value = fmtNum(fieldValue(o, field), 1);
    }

    function onDockKey(e) {
      if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
    }

    /* ---------- Træk værktøj ind på banen ---------- */

    function onTilePointerDown(e) {
      const tile = e.target.closest('[data-tile]');
      if (!tile) return;
      tileDrag = { id: e.pointerId, kind: tile.dataset.tile, x: e.clientX, y: e.clientY, active: false, el: tile };
    }

    function tileWorld(e) {
      const s = stageSize();
      const inside = e.clientX >= s.left && e.clientX <= s.left + s.w && e.clientY >= s.top && e.clientY <= s.top + s.h;
      /* Fingeren skjuler punktet, så en finger placerer lidt over berøringen. */
      const lift = e.pointerType === 'mouse' ? 0 : 36;
      const overPanel = ctxEl.contains(document.elementFromPoint(e.clientX, e.clientY));
      return inside && !overPanel ? toWorld({ x: e.clientX - s.left, y: e.clientY - s.top - lift }) : null;
    }

    function previewHtml(kind, w) {
      if (Store.OBSTACLE_TYPES.includes(kind)) {
        const d = Store.OBSTACLE_DEFAULTS[kind];
        return Scene.obstacle({ type: kind, x: w.x, y: w.y, rotation: 0, number: '', showNumber: false, showArrow: true, width: d.width, depth: d.depth, label: null }, ctx);
      }
      if (Store.DECOR_TYPES.includes(kind)) return Scene.decoration({ type: kind, x: w.x, y: w.y, rotation: 0, diameter: Store.DECOR_SIZES[kind] }, ctx);
      if (Scene.isFreeMarker(kind)) return Scene.marker(kind, { x: w.x, y: w.y }, ctx);
      const edge = Scene.projectEdge(hall, w.x, w.y);
      return kind === 'judge' ? Scene.marker('judge', edge, ctx) : Scene.marker('entrance', Object.assign({ linked: true }, edge), ctx);
    }

    function onWindowPointerMove(e) {
      if (!tileDrag || e.pointerId !== tileDrag.id) return;
      if (!tileDrag.active) {
        if (Math.hypot(e.clientX - tileDrag.x, e.clientY - tileDrag.y) < 10) return;
        tileDrag.active = true;
        try { tileDrag.el.setPointerCapture(e.pointerId); } catch (err) { /* Fx syntetiske events */ }
      }
      const w = tileWorld(e);
      tileDrag.w = w;
      layers.draft.innerHTML = w ? '<g opacity=".65">' + previewHtml(tileDrag.kind, w) + '</g>' : '';
    }

    function onWindowPointerUp(e) {
      if (!tileDrag || e.pointerId !== tileDrag.id) return;
      const t = tileDrag;
      tileDrag = null;
      layers.draft.innerHTML = '';
      if (!t.active) return;
      suppressTileClick = true;
      setTimeout(() => { suppressTileClick = false; }, 300);
      if (e.type === 'pointerup' && t.w) placeAt(t.kind, t.w);
    }

    /* ---------- Topbar og menu ---------- */

    function onStatus(status, message) {
      if (status === 'saving') {
        statusEl.textContent = 'Gemmer…';
        statusEl.dataset.state = 'saving';
      } else if (status === 'saved') {
        statusEl.textContent = 'Gemt';
        statusEl.dataset.state = 'saved';
      } else {
        statusEl.textContent = 'Ikke gemt';
        statusEl.dataset.state = 'error';
        toast(message, 'error');
      }
    }

    function renameCourse() {
      UI.formDialog({
        title: 'Omdøb bane',
        fields: [{ name: 'name', label: 'Banens navn', value: course.name }],
        validate: (v) => (v.name.trim() ? null : 'Skriv et navn.'),
      }).then((v) => {
        if (!v) return;
        course.name = v.name.trim();
        Store.touchCourse(course);
        $('.ed-title strong').textContent = course.name;
      });
    }

    /* Afstandene skrives ind pr. strækning. Forslaget er målt på tegningen og kan bruges med et tryk. */
    function openDistances() {
      const legs = Exporter.legs(course);
      if (!legs.length) {
        UI.openDialog({
          title: 'Afstande mellem spring',
          body: '<p>Giv springene numre først. Så laver appen selv en række for hver strækning: 1 → 2, 2 → 3 og så videre.</p>',
          actions: [{ label: 'OK', value: null, kind: 'primary' }],
        });
        return;
      }
      const saved = course.distances || {};
      const rows = legs.map((l) => {
        const value = saved[l.key] != null ? fmtNum(saved[l.key], 2) : '';
        return '<div class="dist-row">' +
          '<span class="dist-leg">' + esc(l.from) + ' <i>→</i> ' + esc(l.to) + '</span>' +
          '<label class="field-input"><input data-key="' + esc(l.key) + '" value="' + esc(value) + '" inputmode="decimal" enterkeyhint="next" autocomplete="off" aria-label="Afstand fra ' + esc(l.from) + ' til ' + esc(l.to) + ' i meter"><em>m</em></label>' +
          '<button type="button" class="dist-approx" data-approx="' + esc(fmtNum(l.approx, 1)) + '" aria-label="Brug ' + esc(fmtNum(l.approx, 1)) + ' meter">ca. ' + esc(fmtNum(l.approx, 1)) + '</button>' +
          '</div>';
      }).join('');
      const fields = (d) => Array.from(d.querySelectorAll('[data-key]'));
      const validate = (d) => {
        let ok = true;
        fields(d).forEach((input) => {
          const v = input.value.trim() ? parseNum(input.value) : null;
          const bad = v !== null && !(v > 0 && v <= 999);
          input.closest('.dist-row').classList.toggle('bad', bad);
          if (bad) ok = false;
        });
        d.querySelector('.form-err').hidden = ok;
        return ok;
      };
      UI.openDialog({
        title: 'Afstande mellem spring',
        sheet: true,
        className: 'dist-dlg',
        body: '<p class="dist-intro">Skriv afstanden i meter. Tomme rækker kommer ikke med på print og billede.</p>' +
          '<div class="dist-list">' + rows + '</div>' +
          '<p class="form-err" hidden>Skriv afstandene som tal mellem 0 og 999, eller lad feltet stå tomt.</p>' +
          '<button type="button" class="linkbtn" data-fill>Udfyld tomme med ca.-målene</button>' +
          '<p class="dist-note">Ca.-målene er lige linjer på tegningen, midt i spring til midt i spring. Den ridevej, du måler på banen, er tit længere.</p>',
        actions: [
          { label: 'Gem afstande', kind: 'primary', validate, value: (d) => fields(d).map((i) => [i.dataset.key, i.value.trim() ? parseNum(i.value) : null]) },
          { label: 'Annullér', kind: 'ghost', value: null },
        ],
        onOpen: (d) => {
          d.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-approx]');
            if (chip) chip.parentNode.querySelector('input').value = chip.dataset.approx;
            if (e.target.closest('[data-fill]')) {
              fields(d).filter((i) => !i.value.trim()).forEach((i) => { i.value = i.closest('.dist-row').querySelector('[data-approx]').dataset.approx; });
            }
          });
          d.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || !e.target.matches('[data-key]')) return;
            e.preventDefault();
            const all = fields(d);
            const next = all[all.indexOf(e.target) + 1];
            if (next) next.focus(); else e.target.blur();
          });
        },
      }).then((values) => {
        if (!values) return;
        /* Værdier for numre, der ikke er på banen lige nu, bevares, så de er der igen efter en omnummerering. */
        const next = Object.assign({}, course.distances);
        values.forEach(([key, v]) => {
          if (v === null) delete next[key];
          else next[key] = Store.round2(v);
        });
        course.distances = next;
        commit();
        toast('Afstandene er gemt.');
      });
    }

    /* Sender banen som link eller fil. Linket laves først, så delingen starter direkte fra trykket. */
    async function openShare() {
      let link = '';
      try {
        link = await Share.buildLink(hall, course);
      } catch (err) {
        toast('Linket kunne ikke laves. Send banen som fil i stedet.', 'error');
      }
      const canShareLink = !!navigator.share && !!link;
      const option = (name, ic, title, note) => '<button type="button" class="out-option" data-share="' + name + '">' + icon(ic) +
        '<span><strong>' + title + '</strong><small>' + note + '</small></span></button>';
      const long = link.length > Share.LONG_LINK;
      const body = '<div class="out-options">' +
        (canShareLink ? option('send', 'share', 'Send link', 'F.eks. over Messenger. Modtageren trykker på linket og vælger en ridehal.') : '') +
        (link ? option('copy', 'link', 'Kopiér link', 'Sæt det ind i en besked selv.') : '') +
        option('file', 'download', 'Send som fil', 'Har logoet med. Modtageren gemmer filen og vælger den med Importér bane på forsiden.') +
        '</div>' +
        (long ? '<p class="show-note share-note">Banen er stor, så linket er langt. Virker det ikke, så send den som fil.</p>' : '');
      UI.openDialog({
        title: 'Del "' + course.name + '"',
        sheet: true,
        body,
        onOpen: (d, fin) => {
          d.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-share]');
            if (!b) return;
            const kind = b.dataset.share;
            try {
              if (kind === 'send') {
                await navigator.share({ title: course.name, text: 'Springbane: ' + course.name, url: link });
              } else if (kind === 'copy') {
                if (!await Share.copyText(link)) throw new Error('Linket kunne ikke kopieres.');
                toast('Linket er kopieret.');
              } else {
                const file = Share.buildFile(hall, course);
                if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: course.name });
                else {
                  UI.download(file, file.name);
                  toast('Filen er gemt i dine overførsler.');
                }
              }
              fin(null);
            } catch (err) {
              /* Har man selv lukket delingen, er der ingen fejl at vise. */
              if (err.name !== 'AbortError') toast(err.message || 'Banen kunne ikke deles.', 'error');
            }
          });
        },
      });
    }

    function runOutput(action, contest) {
      if (action === 'png') {
        Exporter.exportPng(hall, course, { contest }).then(() => toast('Billedet er gemt i dine overførsler.')).catch((err) => toast(err.message, 'error'));
      } else {
        Exporter.printCourse(hall, course, { contest });
      }
    }

    /* Før print og billede: til træning eller til stævne? */
    function chooseOutput(action) {
      const option = (value, ic, title, note) => '<button type="button" class="out-option" data-out="' + value + '">' + icon(ic) +
        '<span><strong>' + title + '</strong><small>' + note + '</small></span></button>';
      UI.openDialog({
        title: 'Hvad skal banen bruges til?',
        sheet: true,
        body: '<div class="out-options">' +
          option('training', 'route', 'Træning', 'Banen og afstandene mellem springene.') +
          option('contest', 'trophy', 'Stævne', 'Med logo, klasse, tempo, tider og banedesign.') + '</div>',
        onOpen: (d, fin) => {
          d.addEventListener('click', (e) => {
            const b = e.target.closest('[data-out]');
            if (b) fin(b.dataset.out);
          });
        },
      }).then((choice) => {
        if (choice === 'training') runOutput(action, false);
        if (choice === 'contest') openContestForm(action);
      });
    }

    /* Forslag til længden: afstandene, hvis alle er udfyldt, ellers den foreslåede ridevej. */
    function suggestedLength() {
      const legs = Exporter.legs(course);
      const saved = course.distances || {};
      if (legs.length && legs.every((l) => saved[l.key] != null)) {
        return String(Math.round(legs.reduce((sum, l) => sum + saved[l.key], 0)));
      }
      const auto = course.paths.find((p) => p.auto);
      if (!auto) return '';
      const pts = Scene.flatten(auto.points, auto.smooth);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return String(Math.round(len / 5) * 5);
    }

    function suggestedJumps() {
      const numbers = Exporter.courseStops(course).map((s) => parseInt(s.name, 10)).filter((n) => !isNaN(n));
      return numbers.length ? Math.min(...numbers) + '-' + Math.max(...numbers) : '';
    }

    function todayText() {
      const d = new Date();
      const two = (n) => String(n).padStart(2, '0');
      return two(d.getDate()) + '-' + two(d.getMonth() + 1) + '-' + d.getFullYear();
    }

    /* Gør et valgt billede lille nok til at ligge i browserens lager. */
    function readLogo(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const fit = Math.min(1, LOGO_MAX / Math.max(img.naturalWidth || LOGO_MAX, img.naturalHeight || LOGO_MAX));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((img.naturalWidth || LOGO_MAX) * fit));
          canvas.height = Math.max(1, Math.round((img.naturalHeight || LOGO_MAX) * fit));
          const g = canvas.getContext('2d');
          g.drawImage(img, 0, 0, canvas.width, canvas.height);
          let data = canvas.toDataURL('image/png');
          if (data.length > 300000) {
            /* Et foto fylder for meget som PNG. JPEG har ingen gennemsigtighed, så bunden bliver hvid. */
            g.globalCompositeOperation = 'destination-over';
            g.fillStyle = '#fff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            data = canvas.toDataURL('image/jpeg', 0.85);
          }
          if (Store.goodLogo(data)) resolve(data);
          else reject(new Error('Billedet er for stort.'));
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Filen kunne ikke læses som et billede.'));
        };
        img.src = url;
      });
    }

    /* Formular til stævnearket med forhåndsvisning. Alt gemmes, mens der skrives. */
    function openContestForm(action) {
      const show = Object.assign({}, course.show);
      if (!show.date) show.date = todayText();
      if (!show.jumps) show.jumps = suggestedJumps();
      if (!show.length) show.length = suggestedLength();
      course.show = show;
      const field = (key, label, placeholder, numeric) => '<label class="field"><span>' + esc(label) + '</span><span class="field-input"><input data-show-key="' + key + '" value="' + esc(show[key] || '') + '" placeholder="' + esc(placeholder) + '" maxlength="60" autocomplete="off"' + (numeric ? ' inputmode="decimal"' : '') + '></span></label>';
      const body = document.createElement('div');
      body.className = 'show-form';
      body.innerHTML = '<div class="show-preview" aria-label="Forhåndsvisning"></div>' +
        '<div class="show-logo"><div class="show-logo-img"></div><div class="show-logo-btns">' +
        '<label class="btn secondary">' + icon('image') + '<span>Vælg logo</span><input type="file" accept="image/*" hidden data-logo-file></label>' +
        '<button type="button" class="linkbtn danger" data-logo-remove>Fjern logo</button></div></div>' +
        '<p class="show-note">Logoet gemmes på ridehallen, så du kun skal vælge det én gang. Tomme felter kommer ikke med.</p>' +
        '<h3 class="show-head">Klassen</h3><div class="show-grid">' +
        field('classNo', 'Klasse nr.', '7') + field('className', 'Klasse', '10-90') +
        field('level', 'Klassetype', 'Klubklasse') + field('discipline', 'Springning', 'Hovedspringning') +
        field('method', 'Metode', 'B0') + field('kind', 'Form', 'Sløjfespringning') +
        field('date', 'Dato', '31-10-2026') + field('height', 'Højde', '10-90') + '</div>' +
        '<h3 class="show-head">Banen</h3><div class="show-grid">' +
        field('jumps', 'Spring', '1-8') + field('length', 'Længde i meter', '380', true) +
        field('tempo', 'Tempo i m/minut', '325', true) + '<span></span>' +
        field('timeAllowed', 'Fejlfri tid i sek', '71', true) + field('timeMax', 'Max tid i sek', '142', true) + '</div>' +
        '<p class="show-note">Fejlfri tid og max tid regnes ud fra længde og tempo. Du kan selv rette dem.</p>' +
        '<h3 class="show-head">Navne</h3><div class="show-grid">' +
        field('designer', 'Banedesign', 'Navn') + field('extra', 'Ekstra navn', 'F.eks. dommer') + '</div>' +
        '<div class="row-field show-toggle"><span class="row-label">Vis afstande mellem spring</span>' + toggle('showDistances', show.showDistances) + '</div>';

      const preview = () => {
        body.querySelector('.show-preview').innerHTML = Exporter.contestSheet(hall, course).svg;
        const logo = body.querySelector('.show-logo-img');
        logo.innerHTML = hall.logo ? '<img alt="Logo" src="' + esc(hall.logo) + '">' : icon('image');
        body.querySelector('[data-logo-remove]').hidden = !hall.logo;
      };
      const save = () => {
        Store.touchCourse(course);
        preview();
      };
      const input = (key) => body.querySelector('[data-show-key="' + key + '"]');
      const setValue = (key, value) => {
        input(key).value = value;
        if (value) show[key] = value;
        else delete show[key];
      };
      /* Tiderne følger med, indtil man selv har rettet dem. */
      let lastAllowed = show.timeAllowed || '';
      let lastMax = show.timeMax || '';
      const updateTimes = () => {
        const tempo = parseNum(show.tempo);
        const length = parseNum(show.length);
        if (!(tempo > 0 && length > 0)) return;
        const allowed = Math.ceil(length / tempo * 60);
        if ((show.timeAllowed || '') === lastAllowed) {
          lastAllowed = String(allowed);
          setValue('timeAllowed', lastAllowed);
        }
        if ((show.timeMax || '') === lastMax) {
          lastMax = String(allowed * 2);
          setValue('timeMax', lastMax);
        }
      };

      body.addEventListener('input', (e) => {
        const key = e.target.dataset.showKey;
        if (!key) return;
        const value = e.target.value.trim();
        if (value) show[key] = value;
        else delete show[key];
        if (key === 'tempo' || key === 'length') updateTimes();
        save();
      });
      body.addEventListener('change', (e) => {
        if (!e.target.matches('[data-logo-file]')) return;
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        readLogo(file).then((data) => {
          hall.logo = data;
          save();
        }).catch((err) => toast(err.message, 'error'));
      });
      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-logo-remove]')) {
          delete hall.logo;
          save();
        }
        const t = e.target.closest('[data-toggle="showDistances"]');
        if (t) {
          show.showDistances = !show.showDistances;
          if (!show.showDistances) delete show.showDistances;
          t.classList.toggle('on', !!show.showDistances);
          t.setAttribute('aria-checked', !!show.showDistances);
          save();
        }
      });
      updateTimes();
      preview();
      Store.touchCourse(course);
      UI.openDialog({
        title: 'Stævneark',
        sheet: true,
        className: 'show-dlg',
        body,
        actions: [
          { label: action === 'png' ? 'Gem billede (PNG)' : 'Udskriv eller gem som PDF', kind: 'primary', value: 'go' },
          { label: 'Luk', kind: 'ghost', value: null },
        ],
      }).then((go) => {
        Store.flush();
        if (go) runOutput(action, true);
      });
    }

    function openMenu() {
      const body = document.createElement('div');
      body.className = 'menu-body';
      const scalePct = Math.round(view.symbolScale * 100);
      body.innerHTML =
        '<div class="row-field"><span class="row-label">' + icon('grid') + 'Målegitter</span>' + toggle('showGrid', view.showGrid) + '</div>' +
        '<div class="row-field"><span class="row-label">Fastgør til gitter (snap)</span>' + toggle('snap', view.snap) + '</div>' +
        '<div class="row-field"><span class="row-label">Automatisk nummerering</span>' + toggle('autoNumber', view.autoNumber) + '</div>' +
        '<div class="row-field col"><span class="row-label">Symbolstørrelse <b data-scale-val>' + scalePct + ' %</b></span><input type="range" min="50" max="250" step="10" value="' + scalePct + '" data-scale aria-label="Symbolstørrelse"></div>' +
        '<div class="row-field col"><span class="row-label">Vis banen</span>' + seg('orientation', [['auto', 'Automatisk'], ['landscape', 'Liggende'], ['portrait', 'Stående']], view.orientation) + '</div>' +
        '<div class="row-field col"><span class="row-label">Drej i trin</span>' + seg('rotationStep', STEPS, view.rotationStep) + '</div>' +
        '<hr>' +
        '<button type="button" class="menu-item" data-menu="share">' + icon('share') + '<span>Del bane</span></button>' +
        '<button type="button" class="menu-item" data-menu="png">' + icon('image') + '<span>Gem bane som billede (PNG)</span></button>' +
        '<button type="button" class="menu-item" data-menu="print">' + icon('print') + '<span>Udskriv eller gem som PDF</span></button>' +
        '<button type="button" class="menu-item" data-menu="rename">' + icon('edit') + '<span>Omdøb bane</span></button>' +
        '<button type="button" class="menu-item" data-menu="renumber">' + icon('route') + '<span>Nummerér alle spring forfra</span></button>' +
        '<button type="button" class="menu-item danger" data-menu="clear">' + icon('trash') + '<span>Ryd alle rideveje</span></button>';

      let finish = null;
      body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-toggle]');
        if (t) {
          const name = t.dataset.toggle;
          view[name] = !view[name];
          t.classList.toggle('on', view[name]);
          t.setAttribute('aria-checked', view[name]);
          Store.touchCourse(course);
          if (name === 'showGrid') renderSurface();
          return;
        }
        const s = e.target.closest('[data-seg]');
        if (s) {
          const group = s.dataset.seg;
          s.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === s));
          if (group === 'orientation') {
            view.orientation = s.dataset.val;
            Store.touchCourse(course);
            fit(false);
          } else {
            setSeg(group, s.dataset.val);
          }
          return;
        }
        const m = e.target.closest('[data-menu]');
        if (!m) return;
        const action = m.dataset.menu;
        finish(null);
        if (action === 'share') {
          openShare();
        } else if (action === 'png' || action === 'print') {
          chooseOutput(action);
        } else if (action === 'rename') {
          renameCourse();
        } else if (action === 'renumber') {
          UI.confirmDialog('Nummerér forfra?', 'Alle spring får numrene 1, 2, 3 … i den rækkefølge, de er tilføjet. Bomme springes over. Du kan fortryde bagefter.', 'Nummerér').then((ok) => { if (ok) renumberAll(); });
        } else if (action === 'clear') {
          clearPaths();
        }
      });
      body.addEventListener('input', (e) => {
        if (!e.target.matches('[data-scale]')) return;
        view.symbolScale = +e.target.value / 100;
        body.querySelector('[data-scale-val]').textContent = e.target.value + ' %';
        ctx = Scene.makeCtx(hall, view, rot);
        renderScene();
        renderOverlay();
        Store.touchCourse(course);
      });
      UI.openDialog({
        title: 'Bane og visning', body, sheet: true,
        onOpen: (d, fin) => { finish = fin; },
      });
    }

    /* ---------- Tastatur ---------- */

    function onKey(e) {
      if (document.querySelector('dialog[open]')) return;
      const typing = e.target && e.target.matches && e.target.matches('input,textarea');
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !typing && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && !typing && key === 'y') { e.preventDefault(); redo(); return; }
      if (typing) return;
      if (mod && key === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod) return;
      const step = e.shiftKey ? 0.1 : 0.5;
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (selection) { e.preventDefault(); removeSelected(); }
          break;
        case 'Escape':
          if (mode !== 'select') {
            draftPoints = [];
            ghostPoint = null;
            renderDraft();
            setMode('select');
          } else select(null);
          break;
        case 'ArrowLeft': e.preventDefault(); nudgeScreen(-step, 0); break;
        case 'ArrowRight': e.preventDefault(); nudgeScreen(step, 0); break;
        case 'ArrowUp': e.preventDefault(); nudgeScreen(0, -step); break;
        case 'ArrowDown': e.preventDefault(); nudgeScreen(0, step); break;
        case 'r': case 'R': rotateBy(e.shiftKey ? -(view.rotationStep || 15) : view.rotationStep || 15); break;
        case 'Enter':
          if (mode === 'draw' && view.draw.mode === 'points') finishPoints();
          break;
        default:
      }
    }

    function nudgeScreen(sx, sy) {
      if (rot === 90) nudge(sy, -sx);
      else nudge(sx, sy);
    }

    /* ---------- Opsætning ---------- */

    function onTopClick(e) {
      const b = e.target.closest('[data-top]');
      if (!b) return;
      switch (b.dataset.top) {
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'menu': openMenu(); break;
        case 'rename': renameCourse(); break;
        default:
      }
    }

    function onZoomClick(e) {
      const b = e.target.closest('[data-zoom]');
      if (!b) return;
      const s = stageSize();
      if (b.dataset.zoom === 'fit') fit(true);
      else zoomAt(s.w / 2, s.h / 2, b.dataset.zoom === 'in' ? 1.35 : 1 / 1.35);
    }

    function onResize() {
      const s = stageSize();
      if (s.w === lastW && s.h === lastH) return;
      const flipped = lastW && (s.w > s.h) !== (lastW > lastH);
      lastW = s.w;
      lastH = s.h;
      if (sideLayout.matches !== wasSideLayout) {
        wasSideLayout = sideLayout.matches;
        renderCtx();
      }
      /* Et mobiltastatur må ikke flytte banen eller tage fokus fra feltet.
         Kun drejning af skærmen eller et uberørt kamera tilpasser igen. */
      const typing = dock.contains(document.activeElement) && document.activeElement.matches('input');
      if (flipped || (!camTouched && !typing)) fit(false);
      else renderOverlay();
    }

    const listeners = [];
    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push(() => target.removeEventListener(type, fn, opts));
    }

    on(svg, 'pointerdown', onPointerDown);
    on(svg, 'pointermove', onPointerMove);
    on(svg, 'pointerup', onPointerUp);
    on(svg, 'pointercancel', onPointerCancel);
    on(svg, 'wheel', onWheel, { passive: false });
    on(svg, 'contextmenu', (e) => e.preventDefault());
    on(dock, 'click', onDockClick);
    on(dock, 'input', onDockInput);
    on(dock, 'change', onDockChange);
    on(dock, 'keydown', onDockKey);
    on(dock, 'pointerdown', onTilePointerDown);
    on(window, 'pointermove', onWindowPointerMove);
    on(window, 'pointerup', onWindowPointerUp);
    on(window, 'pointercancel', onWindowPointerUp);
    on($('.ed-top'), 'click', onTopClick);
    on($('.zoom'), 'click', onZoomClick);
    on(window, 'keydown', onKey);
    on(window, 'resize', onResize);
    Store.onStatus(onStatus);
    const ro = new ResizeObserver(onResize);
    ro.observe(stage);

    worldG.setAttribute('transform', '');
    fit(false);
    const initial = stageSize();
    lastW = initial.w;
    lastH = initial.h;
    renderAll();
    setMode('select');
    statusEl.textContent = 'Gemt';
    statusEl.dataset.state = 'saved';

    function template() {
      return '<div class="editor">' +
        '<header class="ed-top">' +
        '<a class="iconbtn" href="#/hal/' + esc(hall.id) + '" aria-label="Tilbage til ' + esc(hall.name) + '">' + icon('back') + '</a>' +
        '<button type="button" class="ed-title" data-top="rename" aria-label="Omdøb bane"><strong>' + esc(course.name) + '</strong><small>' + esc(hall.name) + ' · ' + fmtNum(hall.length) + ' × ' + fmtNum(hall.width) + ' m</small></button>' +
        '<span class="save-status" data-state="saved" role="status">Gemt</span>' +
        '<button type="button" class="iconbtn" data-top="undo" aria-label="Fortryd" title="Fortryd (Ctrl+Z)">' + icon('undo') + '</button>' +
        '<button type="button" class="iconbtn" data-top="redo" aria-label="Gentag" title="Gentag (Ctrl+Y)">' + icon('redo') + '</button>' +
        '<button type="button" class="iconbtn" data-top="menu" aria-label="Bane og visning" title="Bane og visning">' + icon('dots') + '</button>' +
        '</header>' +
        '<div class="ed-main">' +
        '<div class="stage" data-mode="select">' +
        '<svg class="stage-svg" xmlns="http://www.w3.org/2000/svg" font-family="' + Scene.FONT + '" aria-label="Ridebane">' +
        '<g data-cam><g data-world>' +
        '<g data-layer="surface"></g><g data-layer="decorations"></g><g data-layer="paths"></g><g data-layer="obstacles"></g><g data-layer="markers"></g><g data-layer="draft"></g>' +
        '</g></g><g data-overlay></g></svg>' +
        '<div class="hint" role="status"></div>' +
        '<div class="zoom">' +
        '<button type="button" data-zoom="in" aria-label="Zoom ind" title="Zoom ind">' + icon('plus') + '</button>' +
        '<button type="button" data-zoom="out" aria-label="Zoom ud" title="Zoom ud">' + icon('minus') + '</button>' +
        '<button type="button" data-zoom="fit" aria-label="Tilpas til skærm" title="Tilpas til skærm">' + icon('fit') + '</button>' +
        '</div></div>' +
        '<aside class="dock">' +
        '<nav class="modes" aria-label="Værktøj">' +
        '<button type="button" data-mode="select">' + icon('select') + '<span>Vælg/flyt</span></button>' +
        '<button type="button" data-mode="add">' + icon('add') + '<span>Tilføj</span></button>' +
        '<button type="button" data-mode="draw">' + icon('draw') + '<span>Tegn ridevej</span></button>' +
        '<button type="button" data-act="distances">' + icon('ruler') + '<span>Afstande</span></button>' +
        '</nav><div class="ctx" hidden></div></aside>' +
        '</div></div>';
    }

    return {
      destroy() {
        if (draftPoints.length >= 2 && view.draw.mode === 'points') finishPoints();
        cancelAnimationFrame(camAnim);
        clearTimeout(hintTimer);
        ro.disconnect();
        listeners.forEach((off) => off());
        Store.offStatus(onStatus);
        Store.flush();
      },
      /* Bruges af testene */
      get state() { return { cam, rot, mode, selection, undo: undoStack.length, redo: redoStack.length }; },
    };
  }

  GBS.Editor = { open, close, get current() { return current; } };
})(window.GBS);
