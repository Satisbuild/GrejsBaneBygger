/* Grejs_Bane_Byg – foreslår en ridevej gennem banen.
   Hver strækning er en kurve, der forlader et spring i pilens retning og rammer det næste spring
   i dets pilretning. Mange kurver prøves, og den billigste vælges: kort, uden skarpe sving,
   inde i hallen og uden om de andre spring. */
(function (GBS) {
  'use strict';

  const { Exporter } = GBS;

  const WALL_MARGIN = 1.3;    /* Meter, ruten skal holde fra væggen */
  const WALL_SOFT = 2.6;      /* Inden for denne afstand koster væggen lidt, så ruten ikke kører langs den */
  const JUMP_CLEARANCE = 0.9; /* Meter fri luft omkring de spring, ruten ikke skal over */
  const STRAIGHT = 3.5;       /* Lige stykke før og efter et spring */
  const LEAD = 6;             /* Tilridning og afridning, når banen ikke har START eller MÅL */
  const SPACING = 1.2;        /* Meter mellem punkterne på den færdige linje */
  const RELAX_ROUNDS = 500;   /* Omgange, ruten glattes til sidst */
  const RELAX_STEP = 0.05;    /* Højst 1/16, ellers bliver udglatningen ustabil */

  const add = (p, d, k) => ({ x: p.x + d.x * k, y: p.y + d.y * k });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const unit = (a, b) => {
    const l = dist(a, b) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const fromAngle = (deg) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) });

  function bezier(s, t) {
    const m = 1 - t;
    const a = m * m * m;
    const b = 3 * m * m * t;
    const c = 3 * m * t * t;
    const d = t * t * t;
    return { x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x, y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y };
  }

  function makeSegment(p0, d0, h0, p1, d1, h1) {
    return { p0, c1: add(p0, d0, h0), c2: add(p1, d1, -h1), p1 };
  }

  function samplePoints(s) {
    const n = Math.max(8, Math.min(48, Math.ceil((dist(s.p0, s.c1) + dist(s.c1, s.c2) + dist(s.c2, s.p1)) / 1.2)));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(bezier(s, i / n));
    return out;
  }

  /* Prisen for en kurve. env.skip er de spring, kurven går fra og til. */
  function costOf(parts, env) {
    let cost = 0;
    let bad = 0;
    let prevDir = null;
    parts.forEach((s) => {
      const pts = samplePoints(s);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const ds = dist(a, b);
        cost += ds;
        const wall = Math.min(b.x, b.y, env.hall.length - b.x, env.hall.width - b.y);
        if (wall < WALL_MARGIN) { cost += (WALL_MARGIN - wall) * 40 * ds; bad++; }
        else if (wall < WALL_SOFT) cost += (WALL_SOFT - wall) * 0.25 * ds;
        for (let k = 0; k < env.boxes.length; k++) {
          const box = env.boxes[k];
          const dx = b.x - box.x;
          const dy = b.y - box.y;
          const lx = Math.abs(dx * box.cos + dy * box.sin) - box.hx;
          const ly = Math.abs(-dx * box.sin + dy * box.cos) - box.hy;
          if (lx < 0 && ly < 0 && !(env.skip && env.skip.includes(box.o) && env.nearEnds(b))) {
            cost += 110 * ds;
            bad++;
          }
        }
        if (ds > 1e-6) {
          const dir = Math.atan2(b.y - a.y, b.x - a.x);
          if (prevDir !== null) {
            let turn = Math.abs(dir - prevDir);
            if (turn > Math.PI) turn = 2 * Math.PI - turn;
            const radius = ds / Math.max(turn, 1e-4);
            /* Hvert sving koster lidt, så ruten ikke slynger sig unødigt. Skarpe sving koster meget. */
            cost += turn * 1.2;
            if (radius < env.minRadius) {
              cost += 22 * (env.minRadius / radius - 1) * ds;
              if (radius < env.minRadius * 0.6) bad++;
            }
          }
          prevDir = dir;
        }
      }
    });
    return { cost, bad };
  }

  /* Finder den bedste forbindelse fra et punkt med retning til et andet. Prøver først én kurve;
     kan den ikke holde sig fri, prøves to kurver gennem et mellempunkt, f.eks. rundt om et spring. */
  function connect(p0, d0, p1, d1, env, skip) {
    const near = (q) => dist(q, p0) < 1 || dist(q, p1) < 1;
    const run = Object.assign({}, env, { skip, nearEnds: near });
    const span = Math.max(dist(p0, p1), 2);
    const factors = [0.2, 0.35, 0.5, 0.7, 0.9, 1.2, 1.6];
    let best = null;
    const consider = (parts) => {
      const r = costOf(parts, run);
      if (!best || r.cost < best.cost) best = { cost: r.cost, bad: r.bad, parts };
    };
    factors.forEach((a) => factors.forEach((b) => consider([makeSegment(p0, d0, span * a, p1, d1, span * b)])));
    /* En direkte kurve, der vender rundt uden plads, er aldrig god nok, selv når den holder sig fri. */
    const dot = d0.x * d1.x + d0.y * d1.y;
    if (best.bad === 0 && best.cost < span * 1.9 + 14 && dot > -0.75) return best;

    const step = Math.max(4, Math.max(env.hall.length, env.hall.width) / 15);
    for (let x = step / 2; x < env.hall.length; x += step) {
      for (let y = step / 2; y < env.hall.width; y += step) {
        const v = { x, y };
        if (Math.min(x, y, env.hall.length - x, env.hall.width - y) < WALL_MARGIN + 0.5) continue;
        const l0 = dist(p0, v);
        const l1 = dist(v, p1);
        if (l0 < 1.5 || l1 < 1.5) continue;
        for (let deg = 0; deg < 360; deg += 30) {
          const t = fromAngle(deg);
          [0.35, 0.6].forEach((a) => {
            [0.35, 0.6].forEach((b) => {
              consider([makeSegment(p0, d0, l0 * a, v, t, l0 * b), makeSegment(v, t, l1 * b, p1, d1, l1 * a)]);
            });
          });
        }
      }
    }
    return best;
  }

  /* Rykker et punkt ind mod et anker, til det er inde i hallen. Bruges ved spring tæt på væggen. */
  function keepInside(anchor, dir, length, hall) {
    let l = length;
    const m = WALL_MARGIN * 0.6;
    for (let i = 0; i < 12; i++) {
      const q = add(anchor, dir, l);
      if (q.x >= m && q.y >= m && q.x <= hall.length - m && q.y <= hall.width - m) return q;
      l *= 0.8;
    }
    return add(anchor, dir, l);
  }

  function clampInside(p, hall) {
    const m = WALL_MARGIN;
    return { x: Math.min(hall.length - m, Math.max(m, p.x)), y: Math.min(hall.width - m, Math.max(m, p.y)) };
  }

  /* Springets rejseretning for et bestemt nummer. number3 er nummeret til den anden vej. */
  function stopDirections(stop) {
    const o = stop.o;
    const forward = fromAngle(o.rotation);
    const back = { x: -forward.x, y: -forward.y };
    if (stop.field === 'number3') return [back];
    if (o.showArrow === false) return [forward, back];
    if (o.bothWays && stop.field !== 'number') return [forward, back];
    return [forward];
  }

  function obstacleBoxes(course) {
    return course.obstacles.map((o) => {
      const r = o.rotation * Math.PI / 180;
      return { o, x: o.x, y: o.y, cos: Math.cos(r), sin: Math.sin(r), hx: (o.depth || 0) / 2 + 0.3 + JUMP_CLEARANCE, hy: o.width / 2 + JUMP_CLEARANCE };
    });
  }

  /* Bygger ruten. Returnerer points og pins (de punkter, der ligger på et spring) eller null uden numre. */
  function generate(hall, course) {
    const stops = Exporter.courseStops(course);
    if (!stops.length) return null;
    const env = { hall, boxes: obstacleBoxes(course), minRadius: Math.min(6, Math.min(hall.length, hall.width) * 0.28) };
    const { start, finish } = course.markers;

    const route = [];  /* { parts } for hver strækning */
    const anchors = []; /* { in, center, out } pr. nummer */
    let cursor = null;
    let cursorDir = null;
    let prevStop = null;

    stops.forEach((stop, i) => {
      const center = { x: stop.x, y: stop.y };
      const next = stops[i + 1];
      const before = i ? dist(center, stops[i - 1]) : Infinity;
      const after = next ? dist(center, next) : Infinity;
      const inLen = Math.min(STRAIGHT, before * 0.34);
      const outLen = Math.min(STRAIGHT, after * 0.34);

      /* Kan springet rides begge veje, vælges den retning, der giver den pæneste tilridning. */
      let chosen = null;
      stopDirections(stop).forEach((dir) => {
        const inPt = keepInside(center, { x: -dir.x, y: -dir.y }, inLen, hall);
        const outPt = keepInside(center, dir, outLen, hall);
        let link = null;
        if (cursor) link = connect(cursor, cursorDir, inPt, dir, env, [prevStop && prevStop.o, stop.o]);
        else if (start) link = connect(start, unit(start, inPt), inPt, dir, env, [stop.o]);
        const score = link ? link.cost : 0;
        if (!chosen || score < chosen.score) chosen = { dir, inPt, outPt, link, score };
      });

      if (chosen.link) route.push(chosen.link.parts);
      else route.push([makeSegment(keepInside(center, { x: -chosen.dir.x, y: -chosen.dir.y }, inLen + LEAD, hall), chosen.dir, LEAD / 3, chosen.inPt, chosen.dir, LEAD / 3)]);
      anchors.push({ center, in: chosen.inPt, out: chosen.outPt });
      cursor = chosen.outPt;
      cursorDir = chosen.dir;
      prevStop = stop;
    });

    const last = stops[stops.length - 1];
    if (finish) {
      const f = connect(cursor, cursorDir, finish, unit(cursor, finish), env, [last.o]);
      route.push(f.parts);
    } else {
      const end = clampInside(add(cursor, cursorDir, LEAD), hall);
      route.push([makeSegment(cursor, cursorDir, LEAD / 3, end, cursorDir, LEAD / 3)]);
    }

    const line = assemble(route, anchors);
    relax(line, env);
    return { points: line.points, pins: line.pins };
  }

  /* Omsætter kurverne til tætte punkter, så linjen følger kurverne nøjagtigt.
     fixed er de lige stykker gennem springene, pins er springenes midte: dér bliver ruten,
     når den glattes, og når man trækker i linjen ved siden af. */
  function assemble(route, anchors) {
    const points = [];
    const pins = [];
    const fixed = new Set();
    const push = (p) => {
      if (points.length && dist(points[points.length - 1], p) < SPACING * 0.6) return false;
      points.push({ x: p.x, y: p.y });
      return true;
    };
    route.forEach((parts, r) => {
      parts.forEach((s) => samplePoints(s).forEach(push));
      const a = anchors[r];
      if (!a) return;
      points[points.length - 1] = { x: a.in.x, y: a.in.y };
      fixed.add(points.length - 1);
      [[a.in, a.center], [a.center, a.out]].forEach(([from, to], side) => {
        const steps = Math.max(1, Math.round(dist(from, to) / SPACING));
        for (let k = 1; k <= steps; k++) {
          points.push({ x: from.x + (to.x - from.x) * k / steps, y: from.y + (to.y - from.y) * k / steps });
          fixed.add(points.length - 1);
          if (side === 0 && k === steps) pins.push(points.length - 1);
        }
      });
    });
    fixed.add(0);
    fixed.add(points.length - 1);
    return { points, pins, fixed };
  }

  /* Skubber et punkt ud af hallens kant og ud af et spring. */
  function pushClear(q, env) {
    q.x = Math.min(env.hall.length - WALL_MARGIN, Math.max(WALL_MARGIN, q.x));
    q.y = Math.min(env.hall.width - WALL_MARGIN, Math.max(WALL_MARGIN, q.y));
    env.boxes.forEach((box) => {
      const dx = q.x - box.x;
      const dy = q.y - box.y;
      const lx = dx * box.cos + dy * box.sin;
      const ly = -dx * box.sin + dy * box.cos;
      const px = box.hx - Math.abs(lx);
      const py = box.hy - Math.abs(ly);
      if (px <= 0 || py <= 0) return;
      /* Ud ad den nærmeste side. */
      if (px < py) {
        const k = (lx >= 0 ? 1 : -1) * px;
        q.x += box.cos * k;
        q.y += box.sin * k;
      } else {
        const k = (ly >= 0 ? 1 : -1) * py;
        q.x -= box.sin * k;
        q.y += box.cos * k;
      }
    });
  }

  /* Glatter hele ruten som en bøjelig stang: punkterne flyttes, så bøjningen bliver mindre,
     mens de lige stykker gennem springene ligger fast. Fjerner knæk og for stramme sving. */
  function relax(line, env) {
    const pts = line.points;
    const n = pts.length;
    if (n < 5) { finishRelax(line); return; }
    const free = [];
    for (let i = 2; i < n - 2; i++) if (!line.fixed.has(i)) free.push(i);
    for (let round = 0; round < RELAX_ROUNDS; round++) {
      const moves = free.map((i) => ({
        x: pts[i - 2].x - 4 * pts[i - 1].x + 6 * pts[i].x - 4 * pts[i + 1].x + pts[i + 2].x,
        y: pts[i - 2].y - 4 * pts[i - 1].y + 6 * pts[i].y - 4 * pts[i + 1].y + pts[i + 2].y,
      }));
      free.forEach((i, k) => {
        pts[i].x -= RELAX_STEP * moves[k].x;
        pts[i].y -= RELAX_STEP * moves[k].y;
        pushClear(pts[i], env);
      });
    }
    finishRelax(line);
  }

  function finishRelax(line) {
    line.points = line.points.map((q) => ({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 }));
  }

  GBS.Route = { generate };
})(window.GBS);
