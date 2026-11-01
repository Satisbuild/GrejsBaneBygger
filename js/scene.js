/* Grejs_Bane_Byg – tegner hal, spring, markeringer og rideveje som SVG-tekst.
   Samme kode bruges af editoren, miniaturerne, PNG-eksporten og udskriften,
   og derfor bruges kun inline-attributter (ingen CSS-klasser eller id'er). */
(function (GBS) {
  'use strict';

  const { esc, clamp } = GBS.UI;

  const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif';
  const RED = '#d0202a';
  const SURFACE = '#ffffff';
  const WALL = '#111111';
  const AMBER = '#f2ab00';
  const BG = '#f5f4ef';
  const MARKER_TEXT = { start: 'START', finish: 'MÅL', change: 'MÅL/START', judge: 'Dommer', entrance: 'Ind', exit: 'Ud' };
  const isFreeMarker = (kind) => GBS.Store.FREE_MARKERS.includes(kind);

  const f = (n) => +n.toFixed(3);

  /* ctx samler alt, der afhænger af hal og visning. u er annoteringsenheden i meter,
     så numre og pile fylder cirka det samme på skærmen uanset hallens størrelse. */
  function makeCtx(hall, view, rot) {
    const s = (view && view.symbolScale) || 1;
    const u = clamp(Math.max(hall.length, hall.width) / 40, 0.7, 2.5) * s;
    return { hall, rot: rot || 0, s, u, margin: 2.9 * u };
  }

  /* ---------- Visningsrotation ---------- */

  /* Lange haller kan vises på højkant for at udnytte en telefon i portræt. */
  function viewTransform(hall, rot) {
    return rot === 90 ? 'translate(' + f(hall.width) + ' 0) rotate(90)' : '';
  }
  function toView(hall, rot, x, y) {
    return rot === 90 ? { x: hall.width - y, y: x } : { x, y };
  }
  function fromView(hall, rot, vx, vy) {
    return rot === 90 ? { x: vy, y: hall.width - vx } : { x: vx, y: vy };
  }
  function chooseRot(hall, orientation, availW, availH) {
    const longFirst = hall.length >= hall.width;
    if (orientation === 'landscape') return longFirst ? 0 : 90;
    if (orientation === 'portrait') return longFirst ? 90 : 0;
    const flat = Math.min(availW / hall.length, availH / hall.width);
    const tall = Math.min(availW / hall.width, availH / hall.length);
    return tall > flat * 1.05 ? 90 : 0;
  }
  /* Vinkel i verdens-koordinater, så teksten læses fra venstre mod højre eller nedefra og op. */
  function readableAngle(worldAngle, rot) {
    let a = ((worldAngle + rot + 90) % 360 + 360) % 360 - 90;
    if (a >= 90) a -= 180;
    return a - rot;
  }

  /* ---------- Spring ---------- */

  function obstacleGeom(o, c) {
    const u = c.u;
    const w = o.width * c.s;
    const t = (o.type === 'pole' ? 0.18 : 0.3) * u;
    const d = o.type === 'oxer' ? Math.max(o.depth * c.s, t * 2.4) : 0;
    const railHalfX = d / 2 + t / 2;
    const arrow = o.showArrow !== false;
    return {
      w, t, d, railHalfX, halfY: w / 2, arrow,
      back: arrow ? d / 2 + (o.bothWays ? 1.35 : 0.55) * u : railHalfX,
      front: arrow ? d / 2 + 1.35 * u : railHalfX,
    };
  }

  /* En sort springdel med hvide felter omkring midten, på tværs af springretningen. */
  function rail(cx, g, type) {
    const x = cx - g.t / 2;
    if (type === 'pole') {
      return '<rect x="' + f(x) + '" y="' + f(-g.w / 2) + '" width="' + f(g.t) + '" height="' + f(g.w) + '" rx="' + f(g.t / 2) + '" fill="#111"/>';
    }
    let out = '<rect x="' + f(x) + '" y="' + f(-g.w / 2) + '" width="' + f(g.t) + '" height="' + f(g.w) + '" fill="#111"/>';
    const square = g.t;
    const spacing = square * 2.4;
    const count = Math.max(1, Math.floor(g.w * 0.62 / spacing)) | 1;
    const inset = g.t * 0.14;
    for (let i = 0; i < count; i++) {
      const y = (i - (count - 1) / 2) * spacing;
      out += '<rect x="' + f(x + inset) + '" y="' + f(y - square / 2) + '" width="' + f(g.t - inset * 2) + '" height="' + f(square) + '" fill="#fff"/>';
    }
    return out;
  }

  /* Den røde pil tegnes inde i springets roterede gruppe og kan derfor ikke komme ud af trit med springet. */
  function arrowShape(g, u, bothWays) {
    const shaft = 0.07 * u;
    const head = 0.32 * u;
    const headLen = 0.62 * u;
    const b = -g.back;
    const a = g.front;
    /* Pil begge veje er én samlet form med en spids i hver ende, ikke to pile oven i hinanden. */
    const tail = bothWays
      ? [[b + headLen, shaft], [b + headLen, head], [b, 0], [b + headLen, -head], [b + headLen, -shaft]]
      : [[b, shaft], [b, -shaft]];
    const pts = [[a - headLen, -shaft], [a - headLen, -head], [a, 0], [a - headLen, head], [a - headLen, shaft]].concat(tail);
    return '<polygon points="' + pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ') + '" fill="' + RED + '" stroke="#fff" stroke-width="' + f(0.06 * u) + '" stroke-linejoin="round" paint-order="stroke"/>';
  }

  function obstacleBody(o, c) {
    const g = obstacleGeom(o, c);
    let out = '';
    if (o.type === 'oxer') {
      /* Tynde tværstreger binder de to dele sammen til ét spring. */
      [-g.w / 2, g.w / 2].forEach((y) => {
        out += '<line x1="' + f(-g.d / 2) + '" y1="' + f(y - Math.sign(y) * g.t * 0.2) + '" x2="' + f(g.d / 2) + '" y2="' + f(y - Math.sign(y) * g.t * 0.2) + '" stroke="#111" stroke-width="' + f(g.t * 0.16) + '"/>';
      });
      out += rail(-g.d / 2, g, o.type) + rail(g.d / 2, g, o.type);
    } else {
      out += rail(0, g, o.type);
    }
    if (g.arrow) out += arrowShape(g, c.u, o.bothWays);
    return out;
  }

  /* Nummerets placering i forhold til springets centrum: som standard bag springet, hvor pilen starter.
     Følger rotationen, men teksten forbliver opret. */
  function labelInfo(o, c) {
    const g = obstacleGeom(o, c);
    const fs = 0.9 * c.u;
    const text = String(o.number || '');
    const hw = text.length * 0.31 * fs + 0.12 * c.u;
    const hh = 0.56 * c.u;
    const local = o.label || { x: -(g.back + 0.3 * c.u + hw), y: 0 };
    const r = o.rotation * Math.PI / 180;
    return {
      local, fs, hw, hh, text,
      dx: local.x * Math.cos(r) - local.y * Math.sin(r),
      dy: local.x * Math.sin(r) + local.y * Math.cos(r),
      visible: !!text && o.showNumber !== false,
    };
  }

  /* Ekstra nummer i rød ring, f.eks. til en anden runde: som standard foran springet. */
  function label2Info(o, c) {
    const g = obstacleGeom(o, c);
    const fs = 0.78 * c.u;
    const text = String(o.number2 || '');
    const hw = Math.max(0.74 * c.u, text.length * 0.31 * fs + 0.43 * c.u);
    const hh = 0.56 * c.u;
    /* Rykker til siden, når nummeret til den anden retning står samme sted. */
    const local = o.label2 || { x: g.front + 0.3 * c.u + hw, y: label3Info(o, c).visible ? 1.7 * c.u : 0 };
    const r = o.rotation * Math.PI / 180;
    return {
      local, fs, hw, hh, text,
      dx: local.x * Math.cos(r) - local.y * Math.sin(r),
      dy: local.x * Math.sin(r) + local.y * Math.cos(r),
      visible: !!text && o.showNumber !== false,
    };
  }

  /* Nummer til den anden retning, når springet har pil begge veje: som standard foran springet. */
  function label3Info(o, c) {
    const g = obstacleGeom(o, c);
    const fs = 0.9 * c.u;
    const text = String(o.number3 || '');
    const hw = text.length * 0.31 * fs + 0.12 * c.u;
    const hh = 0.56 * c.u;
    const local = o.label3 || { x: g.front + 0.3 * c.u + hw, y: 0 };
    const r = o.rotation * Math.PI / 180;
    return {
      local, fs, hw, hh, text,
      dx: local.x * Math.cos(r) - local.y * Math.sin(r),
      dy: local.x * Math.sin(r) + local.y * Math.cos(r),
      visible: !!text && !!o.bothWays && o.showNumber !== false,
    };
  }

  function plainLabel(l, c) {
    return '<text transform="translate(' + f(l.dx) + ' ' + f(l.dy) + ') rotate(' + (-c.rot) + ')" y="' + f(l.fs * 0.36) + '" text-anchor="middle" font-size="' + f(l.fs) + '" font-weight="500" fill="#111" stroke="#fff" stroke-width="' + f(0.16 * c.u) + '" stroke-linejoin="round" paint-order="stroke">' + esc(l.text) + '</text>';
  }

  function obstacle(o, c) {
    const l = labelInfo(o, c);
    const l2 = label2Info(o, c);
    const l3 = label3Info(o, c);
    let label = '';
    if (l.visible) label = plainLabel(l, c);
    if (l3.visible) label += plainLabel(l3, c);
    if (l2.visible) {
      label += '<g transform="translate(' + f(l2.dx) + ' ' + f(l2.dy) + ') rotate(' + (-c.rot) + ')">' +
        '<ellipse rx="' + f(l2.hw) + '" ry="' + f(l2.hh) + '" fill="#fff" stroke="' + RED + '" stroke-width="' + f(0.07 * c.u) + '"/>' +
        '<text y="' + f(l2.fs * 0.36) + '" text-anchor="middle" font-size="' + f(l2.fs) + '" font-weight="500" fill="#111">' + esc(l2.text) + '</text></g>';
    }
    return '<g transform="translate(' + f(o.x) + ' ' + f(o.y) + ')">' +
      '<g transform="rotate(' + f(o.rotation) + ')">' + obstacleBody(o, c) + '</g>' + label + '</g>';
  }

  /* ---------- Start og mål ---------- */

  /* m.size er markeringens størrelse i procent af standardstørrelsen. */
  function freeMarkerSize(kind, m, c) {
    const u = c.u * (m.size || 100) / 100;
    if (kind === 'change') return { u, fs: 0.62 * u, hw: 2 * u, hh: 0.92 * u };
    const fs = 1 * u;
    return { u, fs, hw: (MARKER_TEXT[kind].length * 0.72 * fs + 1 * u) / 2, hh: 0.78 * u };
  }

  /* Vinkel i verdens-koordinater. En markering, der aldrig er drejet, står opret i enhver visning;
     en drejet markering følger hallen, så den står ens på telefonen og i PNG-eksporten. */
  function freeMarkerAngle(m, c) {
    return m.rotation == null ? -c.rot : m.rotation;
  }

  function freeMarker(kind, m, c) {
    const { u, fs, hw, hh } = freeMarkerSize(kind, m, c);
    return '<g transform="translate(' + f(m.x) + ' ' + f(m.y) + ') rotate(' + f(freeMarkerAngle(m, c)) + ')">' +
      '<rect x="' + f(-hw) + '" y="' + f(-hh) + '" width="' + f(hw * 2) + '" height="' + f(hh * 2) + '" rx="' + f(hh) + '" fill="' + AMBER + '" stroke="#111" stroke-width="' + f(0.08 * u) + '"/>' +
      (kind === 'change'
        ? '<text y="' + f(-0.12 * u) + '" text-anchor="middle" font-size="' + f(fs) + '" font-weight="800" fill="#111">MÅL</text>' +
          '<text y="' + f(0.56 * u) + '" text-anchor="middle" font-size="' + f(fs) + '" font-weight="800" fill="#111">START</text></g>'
        : '<text y="' + f(fs * 0.36) + '" text-anchor="middle" font-size="' + f(fs) + '" font-weight="800" fill="#111">' + MARKER_TEXT[kind] + '</text></g>');
  }

  /* ---------- Dommer, ind og ud langs hallens kant ---------- */

  function sideLength(hall, side) {
    return side === 'top' || side === 'bottom' ? hall.length : hall.width;
  }

  function sidePoint(hall, side, pos) {
    switch (side) {
      case 'top': return { x: pos, y: 0, ox: 0, oy: -1, angle: 0 };
      case 'bottom': return { x: pos, y: hall.width, ox: 0, oy: 1, angle: 0 };
      case 'left': return { x: 0, y: pos, ox: -1, oy: 0, angle: 90 };
      default: return { x: hall.length, y: pos, ox: 1, oy: 0, angle: 90 };
    }
  }

  /* Finder det nærmeste punkt på hallens kant, så en markering kan glide rundt om hallen. */
  function projectEdge(hall, x, y) {
    const cx = clamp(x, 0, hall.length);
    const cy = clamp(y, 0, hall.width);
    const opts = [
      { side: 'top', d: Math.abs(y), pos: cx },
      { side: 'bottom', d: Math.abs(y - hall.width), pos: cx },
      { side: 'left', d: Math.abs(x), pos: cy },
      { side: 'right', d: Math.abs(x - hall.length), pos: cy },
    ];
    opts.sort((a, b) => a.d - b.d);
    return { side: opts[0].side, pos: Math.round(opts[0].pos * 10) / 10 };
  }

  function edgeGeom(kind, m, c) {
    const u = c.u;
    const pos = clamp(m.pos, 0, sideLength(c.hall, m.side));
    const p = sidePoint(c.hall, m.side, pos);
    const linked = kind === 'entrance' && !!m.linked;
    const fs = linked ? 0.72 * u : 0.92 * u;
    return {
      p, fs, linked,
      cx: p.x + p.ox * 1.45 * u,
      cy: p.y + p.oy * 1.45 * u,
      hw: linked ? 2.05 * u : (MARKER_TEXT[kind].length * 0.6 * fs + 0.9 * u) / 2,
      hh: linked ? 1 * u : 0.8 * u,
      angle: readableAngle(p.angle, c.rot),
    };
  }

  /* Lille pil vinkelret på væggen: ind mod hallen eller ud fra den. */
  function gateArrow(g, u, along, inward) {
    const tx = g.p.angle === 0 ? 1 : 0;
    const ty = g.p.angle === 0 ? 0 : 1;
    const bx = g.p.x + tx * along;
    const by = g.p.y + ty * along;
    const near = { x: bx + g.p.ox * 0.15 * u, y: by + g.p.oy * 0.15 * u };
    const far = { x: bx + g.p.ox * 2.7 * u, y: by + g.p.oy * 2.7 * u };
    const tip = inward ? near : far;
    const dir = inward ? -1 : 1;
    const baseX = tip.x - g.p.ox * dir * 0.5 * u;
    const baseY = tip.y - g.p.oy * dir * 0.5 * u;
    const w = 0.24 * u;
    return '<line x1="' + f(near.x) + '" y1="' + f(near.y) + '" x2="' + f(far.x) + '" y2="' + f(far.y) + '" stroke="#111" stroke-width="' + f(0.08 * u) + '"/>' +
      '<polygon points="' + f(tip.x) + ',' + f(tip.y) + ' ' + f(baseX + tx * w) + ',' + f(baseY + ty * w) + ' ' + f(baseX - tx * w) + ',' + f(baseY - ty * w) + '" fill="#111"/>';
  }

  function edgeMarker(kind, m, c) {
    const g = edgeGeom(kind, m, c);
    const u = c.u;
    const box = '<rect x="' + f(-g.hw) + '" y="' + f(-g.hh) + '" width="' + f(g.hw * 2) + '" height="' + f(g.hh * 2) + '" fill="#fff" stroke="#111" stroke-width="' + f(0.08 * u) + '"/>';
    const open = '<g transform="translate(' + f(g.cx) + ' ' + f(g.cy) + ') rotate(' + f(g.angle) + ')">' + box;
    const text = (t, y) => '<text y="' + f(y) + '" text-anchor="middle" font-size="' + f(g.fs) + '" font-weight="700" fill="#111">' + t + '</text>';
    if (g.linked) {
      return open + text('Ind', -0.14 * u) + text('Ud', 0.72 * u) + '</g>' +
        gateArrow(g, u, -1.6 * u, true) + gateArrow(g, u, 1.6 * u, false);
    }
    const arrow = kind === 'judge' ? '' : gateArrow(g, u, g.hw + 0.4 * u, kind === 'entrance');
    return open + text(MARKER_TEXT[kind], g.fs * 0.36) + '</g>' + arrow;
  }

  function marker(kind, m, c) {
    return isFreeMarker(kind) ? freeMarker(kind, m, c) : edgeMarker(kind, m, c);
  }

  /* De markeringer, der skal tegnes. En sammenkoblet ind/ud tegnes som én boks under entrance. */
  function markerKeys(course) {
    const m = course.markers;
    return ['judge', 'entrance', 'exit', 'start', 'finish', 'change'].filter((k) => m[k] && !(k === 'exit' && m.entrance && m.entrance.linked));
  }

  /* ---------- Rideveje ---------- */

  /* Catmull-Rom gennem punkterne, så en ridevej bliver blød uden at forlade de valgte punkter. */
  function pathD(points, smooth) {
    if (!points.length) return '';
    let d = 'M' + f(points[0].x) + ' ' + f(points[0].y);
    if (!smooth || points.length < 3) {
      for (let i = 1; i < points.length; i++) d += 'L' + f(points[i].x) + ' ' + f(points[i].y);
      return d;
    }
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      d += 'C' + f(p1.x + (p2.x - p0.x) / 6) + ' ' + f(p1.y + (p2.y - p0.y) / 6) + ' ' +
        f(p2.x - (p3.x - p1.x) / 6) + ' ' + f(p2.y - (p3.y - p1.y) / 6) + ' ' + f(p2.x) + ' ' + f(p2.y);
    }
    return d;
  }

  /* Omsætter den glatte kurve til korte stykker til hit-test og placering af pile. */
  function flatten(points, smooth) {
    if (!smooth || points.length < 3) return points;
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      for (let k = 0; k < 8; k++) {
        const t = k / 8;
        const m = 1 - t;
        out.push({
          x: m * m * m * p1.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * p2.x,
          y: m * m * m * p1.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * p2.y,
        });
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function pathArrows(p, c) {
    const pts = flatten(p.points, p.smooth);
    let total = 0;
    const lens = [];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      lens.push(l);
      total += l;
    }
    if (total < 2 * c.u) return '';
    const spacing = 8 * c.u;
    const count = Math.max(1, Math.floor(total / spacing));
    const size = 0.62 * c.u * Math.max(0.8, Math.sqrt(p.width));
    let out = '';
    for (let n = 0; n < count; n++) {
      let target = total * (n + 0.5) / count;
      for (let i = 0; i < lens.length; i++) {
        if (target <= lens[i] && lens[i] > 0) {
          const a = pts[i];
          const b = pts[i + 1];
          const t = target / lens[i];
          const deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
          out += '<polygon transform="translate(' + f(a.x + (b.x - a.x) * t) + ' ' + f(a.y + (b.y - a.y) * t) + ') rotate(' + f(deg) + ')" points="' + f(size * 0.7) + ',0 ' + f(-size * 0.5) + ',' + f(-size * 0.6) + ' ' + f(-size * 0.5) + ',' + f(size * 0.6) + '" fill="' + esc(p.color) + '"/>';
          break;
        }
        target -= lens[i];
      }
    }
    return out;
  }

  function pathStroke(p, c) {
    const sw = 0.2 * c.u * p.width;
    let dash = '';
    if (p.style === 'dashed') dash = ' stroke-dasharray="' + f(0.95 * c.u) + ' ' + f(0.72 * c.u) + '"';
    if (p.style === 'dotted') dash = ' stroke-dasharray="0 ' + f(Math.max(sw * 2.1, 0.5 * c.u)) + '"';
    return ' fill="none" stroke="' + esc(p.color) + '" stroke-width="' + f(sw) + '" stroke-linecap="round" stroke-linejoin="round"' + dash;
  }

  function path(p, c) {
    return '<path d="' + pathD(p.points, p.smooth) + '"' + pathStroke(p, c) + '/>' + (p.arrows ? pathArrows(p, c) : '');
  }

  /* ---------- Hallen ---------- */

  function fmtM(n) { return GBS.UI.fmtNum(n) + ' m'; }

  /* Målelinje uden for væggen. Teksten flyttes væk, hvis en kantmarkering står samme sted. */
  function dimension(side, value, c, course) {
    const hall = c.hall;
    const u = c.u;
    const len = sideLength(hall, side);
    const p = sidePoint(hall, side, 0);
    const off = 1.45 * u;
    let at = len / 2;
    const taken = course ? ['judge', 'entrance', 'exit'].map((k) => course.markers[k]).filter((m) => m && m.side === side).map((m) => m.pos) : [];
    if (taken.some((t) => Math.abs(t - at) < 5 * u)) {
      const candidates = [len * 0.5, len * 0.25, len * 0.75, len * 0.12, len * 0.88];
      at = candidates.find((q) => taken.every((t) => Math.abs(t - q) >= 5 * u));
      if (at === undefined) at = len * 0.12;
    }
    const start = sidePoint(hall, side, 0);
    const end = sidePoint(hall, side, len);
    const mid = sidePoint(hall, side, at);
    const fs = 0.9 * u;
    const text = fmtM(value);
    const hw = (text.length * 0.56 * fs + 0.5 * u) / 2;
    const angle = readableAngle(p.angle, c.rot);
    const lx = p.ox * off;
    const ly = p.oy * off;
    const tick = 0.32 * u;
    const line = (x1, y1, x2, y2) => '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '" stroke="#6d6a5f" stroke-width="' + f(0.06 * u) + '"/>';
    const tx = p.oy ? tick : 0;
    const ty = p.ox ? tick : 0;
    return line(start.x + lx, start.y + ly, end.x + lx, end.y + ly) +
      line(start.x + lx - ty, start.y + ly - tx, start.x + lx + ty, start.y + ly + tx) +
      line(end.x + lx - ty, end.y + ly - tx, end.x + lx + ty, end.y + ly + tx) +
      '<g transform="translate(' + f(mid.x + lx) + ' ' + f(mid.y + ly) + ') rotate(' + f(angle) + ')">' +
      '<rect x="' + f(-hw) + '" y="' + f(-0.62 * u) + '" width="' + f(hw * 2) + '" height="' + f(1.24 * u) + '" fill="' + BG + '"/>' +
      '<text y="' + f(fs * 0.36) + '" text-anchor="middle" font-size="' + f(fs) + '" font-weight="600" fill="#45433a">' + esc(text) + '</text></g>';
  }

  function gridLines(hall, step, skip) {
    let d = '';
    for (let x = step; x < hall.length - 1e-6; x += step) {
      if (!skip || Math.round(x) % skip) d += 'M' + f(x) + ' 0V' + f(hall.width);
    }
    for (let y = step; y < hall.width - 1e-6; y += step) {
      if (!skip || Math.round(y) % skip) d += 'M0 ' + f(y) + 'H' + f(hall.length);
    }
    return d;
  }

  /* Gitterstreger holdes tynde på skærmen uanset zoom. Minor-laget kan skjules, når det bliver for tæt. */
  function grid(hall) {
    return '<path data-grid="minor" d="' + gridLines(hall, 1, 5) + '" fill="none" stroke="#59605a" stroke-opacity=".13" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
      '<path data-grid="major" d="' + gridLines(hall, 5) + '" fill="none" stroke="#59605a" stroke-opacity=".32" stroke-width="1" vector-effect="non-scaling-stroke"/>';
  }

  function surface(hall, c, course, showGrid) {
    return '<rect width="' + f(hall.length) + '" height="' + f(hall.width) + '" rx="' + f(0.7 * c.u) + '" fill="' + SURFACE + '"/>' +
      (showGrid ? grid(hall) : '') +
      '<rect width="' + f(hall.length) + '" height="' + f(hall.width) + '" rx="' + f(0.7 * c.u) + '" fill="none" stroke="' + WALL + '" stroke-width="' + f(0.16 * c.u) + '"/>' +
      dimension('top', hall.length, c, course) + dimension('left', hall.width, c, course);
  }

  /* ---------- Udstrækning ---------- */

  /* Hallen plus margen, udvidet med elementer der ligger uden for (f.eks. efter en ændring af målene). */
  function worldBounds(hall, course, c) {
    let x0 = -c.margin; let y0 = -c.margin;
    let x1 = hall.length + c.margin; let y1 = hall.width + c.margin;
    const add = (p, reach) => {
      x0 = Math.min(x0, p.x - reach); y0 = Math.min(y0, p.y - reach);
      x1 = Math.max(x1, p.x + reach); y1 = Math.max(y1, p.y + reach);
    };
    if (course) {
      course.obstacles.forEach((o) => add(o, 2 * c.u));
      GBS.Store.FREE_MARKERS.forEach((k) => {
        const m = course.markers[k];
        if (!m) return;
        const sz = freeMarkerSize(k, m, c);
        add(m, Math.max(2 * c.u, Math.hypot(sz.hw, sz.hh)));
      });
      course.paths.forEach((p) => p.points.forEach((q) => add(q, 2 * c.u)));
    }
    return { x0, y0, x1, y1 };
  }

  function viewBounds(hall, course, c) {
    const b = worldBounds(hall, course, c);
    const a = toView(hall, c.rot, b.x0, b.y0);
    const d = toView(hall, c.rot, b.x1, b.y1);
    const x = Math.min(a.x, d.x);
    const y = Math.min(a.y, d.y);
    return { x, y, w: Math.abs(d.x - a.x), h: Math.abs(d.y - a.y) };
  }

  /* ---------- Samlet tegning ---------- */

  function contents(hall, course, c, showGrid) {
    const markers = course ? markerKeys(course).map((k) => marker(k, course.markers[k], c)).join('') : '';
    return surface(hall, c, course, showGrid) +
      (course ? course.paths.map((p) => path(p, c)).join('') + course.obstacles.map((o) => obstacle(o, c)).join('') : '') +
      markers;
  }

  /* Selvstændig SVG til miniaturer, PNG og udskrift. title lægger en overskrift over banen. */
  function standalone(hall, course, opts) {
    const o = opts || {};
    const view = course ? course.view : null;
    const rot = o.rot != null ? o.rot : (hall.length >= hall.width ? 0 : 90);
    const c = makeCtx(hall, view, rot);
    const b = viewBounds(hall, course, c);
    const head = o.title ? 3.2 * c.u : 0;
    const pad = o.title ? c.u : 0;
    const vb = { x: b.x - pad, y: b.y - head - pad, w: b.w + pad * 2, h: b.h + head + pad * 2 };
    const sizeAttr = o.pxWidth ? ' width="' + o.pxWidth + '" height="' + Math.round(o.pxWidth * vb.h / vb.w) + '"' : '';
    let title = '';
    if (o.title) {
      title = '<text x="' + f(vb.x + pad) + '" y="' + f(b.y - 1.5 * c.u) + '" font-size="' + f(1.5 * c.u) + '" font-weight="800" fill="#17211b">' + esc(o.title) + '</text>' +
        (o.subtitle ? '<text x="' + f(vb.x + pad) + '" y="' + f(b.y - 0.3 * c.u) + '" font-size="' + f(0.85 * c.u) + '" fill="#55584f">' + esc(o.subtitle) + '</text>' : '');
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + f(vb.x) + ' ' + f(vb.y) + ' ' + f(vb.w) + ' ' + f(vb.h) + '"' + sizeAttr + ' font-family="' + FONT + '"' + (o.label ? ' role="img" aria-label="' + esc(o.label) + '"' : '') + '>' +
      (o.background ? '<rect x="' + f(vb.x) + '" y="' + f(vb.y) + '" width="' + f(vb.w) + '" height="' + f(vb.h) + '" fill="' + BG + '"/>' : '') +
      title +
      '<g transform="' + viewTransform(hall, rot) + '">' + contents(hall, course, c, !!o.grid) + '</g></svg>';
    return { svg, width: vb.w, height: vb.h };
  }

  GBS.Scene = {
    FONT, BG, MARKER_TEXT,
    makeCtx, viewTransform, toView, fromView, chooseRot,
    obstacle, obstacleGeom, labelInfo, label2Info, label3Info, isFreeMarker,
    freeMarkerSize, freeMarkerAngle, edgeGeom, marker, markerKeys, projectEdge, sidePoint, sideLength,
    path, pathD, pathStroke, flatten,
    surface, viewBounds, standalone,
  };
})(window.GBS);
