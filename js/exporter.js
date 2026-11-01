/* Grejs_Bane_Byg – banekortet: tegning og afstande samlet på ét ark.
   Samme ark bruges til PNG og til udskrift/PDF via browseren. */
(function (GBS) {
  'use strict';

  const { UI, Scene } = GBS;
  const { esc, fmtNum } = UI;

  const FOREST = '#1f4d3a';
  const INK = '#17211b';
  const INK_2 = '#4f564f';
  const LINE = '#dcd9cd';
  const RED = '#d0202a';

  /* ---------- Afstande ---------- */

  /* Sorterer 1, 2, 5a, 5b, 10 i banens rækkefølge. */
  const byNumber = (a, b) => a.name.localeCompare(b.name, 'da', { numeric: true, sensitivity: 'base' });

  /* Banens numre med placering. 2/8 tæller som både 2 og 8, ligesom ekstra numre på samme spring. */
  function courseStops(course) {
    const stops = [];
    const seen = new Set();
    course.obstacles.filter((o) => o.showNumber !== false).forEach((o) => {
      ['number', 'number2', 'number3'].forEach((field) => {
        if (field === 'number3' && !o.bothWays) return;
        String(o[field] || '').split('/').map((s) => s.trim()).filter(Boolean).forEach((name) => {
          if (seen.has(name)) return;
          seen.add(name);
          stops.push({ name, x: o.x, y: o.y, o, field });
        });
      });
    });
    return stops.sort(byNumber);
  }

  /* Strækningerne på banen: Start → 1, 1 → 2 … sidste → Mål. approx er målt i lige linje på tegningen. */
  function legs(course) {
    const { start, finish } = course.markers;
    const stops = courseStops(course);
    if (!stops.length) return [];
    if (start) stops.unshift({ name: 'Start', x: start.x, y: start.y, marker: true });
    if (finish) stops.push({ name: 'Mål', x: finish.x, y: finish.y, marker: true });
    return stops.slice(1).map((to, i) => {
      const from = stops[i];
      return {
        key: from.name + '|' + to.name,
        from: from.name,
        to: to.name,
        approx: Math.round(Math.hypot(to.x - from.x, to.y - from.y) * 10) / 10,
      };
    });
  }

  /* ---------- Arket ---------- */

  function text(x, y, value, size, fill, extra) {
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '>' + esc(value) + '</text>';
  }

  function distanceCard(leg, meters, x, y, w, h) {
    return '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + h + '" rx="12" fill="#fff" stroke="' + LINE + '" stroke-width="1.5"/>' +
      '<text x="' + (x + 16).toFixed(1) + '" y="' + (y + 30) + '" font-size="18" font-weight="600" fill="' + INK_2 + '">' + esc(leg.from) +
      ' <tspan fill="' + RED + '">→</tspan> ' + esc(leg.to) + '</text>' +
      text((x + 16).toFixed(1), y + 64, fmtNum(meters, 1) + ' m', 28, INK, 'font-weight="700"');
  }

  /* Overskrift og kort med afstandene. Returnerer tom tekst og uændret y, hvis ingen er udfyldt. */
  function distanceSection(course, pad, top, width) {
    const distances = course.distances || {};
    const filled = legs(course).filter((l) => distances[l.key] != null);
    if (!filled.length) return { svg: '', y: top };
    const inner = width - pad * 2;
    const total = filled.reduce((sum, l) => sum + distances[l.key], 0);
    let svg = text(pad, top + 8, 'Afstande mellem spring', 24, INK, 'font-weight="800"') +
      text(width - pad, top + 8, 'I alt ' + fmtNum(total, 1) + ' m', 22, FOREST, 'font-weight="800" text-anchor="end"');
    const y = top + 26;
    const COLS = 6;
    const GAP = 12;
    const cardW = (inner - GAP * (COLS - 1)) / COLS;
    const cardH = 80;
    filled.forEach((leg, i) => {
      const cx = pad + (i % COLS) * (cardW + GAP);
      const cy = y + Math.floor(i / COLS) * (cardH + GAP);
      svg += distanceCard(leg, distances[leg.key], cx, cy, cardW, cardH);
    });
    return { svg, y: y + Math.ceil(filled.length / COLS) * (cardH + GAP) - GAP + 26 };
  }

  /* Tal får en enhed; andet står, som det er skrevet. */
  function withUnit(value, unit) {
    return /^\d+([.,]\d+)?$/.test(value || '') ? value + ' ' + unit : value;
  }

  /* Stævnearket: logo og klassens oplysninger øverst, stor banetegning og banedesign nederst. */
  function contestSheet(hall, course, opts) {
    const o = opts || {};
    const s = course.show || {};
    const W = 1200;
    const PAD = 40;
    const hasLogo = !!hall.logo;
    const LOGO = { x: PAD, y: 26, w: 170, h: 150 };
    const x0 = hasLogo ? PAD + LOGO.w + 28 : PAD;
    const x1 = x0 + Math.round((W - PAD - x0) * 0.4);
    const VALUE_AT = 106;
    let body = '';

    /* Toplinjen */
    const line1 = 48;
    if (s.classNo) {
      body += text(x0, line1, 'Klasse nr.', 18, INK_2) + text(x0 + VALUE_AT, line1, s.classNo, 19, INK, 'font-weight="800"');
    }
    if (s.className) body += text(x1, line1, s.className, 20, INK, 'font-weight="800"');
    if (s.date) body += text(W - PAD, line1, 'Dato: ' + s.date, 18, INK_2, 'text-anchor="end"');
    body += '<rect x="' + x0 + '" y="' + (line1 + 11) + '" width="' + (W - PAD - x0) + '" height="2.5" fill="' + FOREST + '"/>';

    /* To kolonner, hvor tomme felter ikke efterlader huller. */
    const left = [
      [null, s.level],
      ['Metode', s.method],
      [null, s.kind],
      ['Tempo', withUnit(s.tempo, 'm/minut')],
      ['Højde', s.height],
    ].filter((r) => r[1]);
    const right = [
      [null, s.discipline, true],
      ['Spring', s.jumps],
      ['Længde', withUnit(s.length, 'm')],
      ['Fejlfri tid', withUnit(s.timeAllowed, 'sek')],
      ['Max tid', withUnit(s.timeMax, 'sek')],
    ].filter((r) => r[1]);
    const ROW = 25;
    const first = line1 + 37;
    const column = (rows, x) => rows.map((r, i) => {
      const y = first + i * ROW;
      if (!r[0]) return text(x, y, r[1], 18, INK, r[2] ? 'font-weight="800"' : '');
      return text(x, y, r[0], 18, INK_2) + text(x + VALUE_AT, y, r[1], 18, INK, 'font-weight="600"');
    }).join('');
    body += column(left, x0) + column(right, x1);
    const rows = Math.max(left.length, right.length);
    let y = Math.max(hasLogo ? LOGO.y + LOGO.h : 0, first + (rows - 1) * ROW) + 22;

    if (hasLogo && !o.omitLogo) {
      body += '<image x="' + LOGO.x + '" y="' + LOGO.y + '" width="' + LOGO.w + '" height="' + LOGO.h + '" preserveAspectRatio="xMidYMid meet" href="' + esc(hall.logo) + '"/>';
    }

    /* Banetegningen */
    const rot = hall.length >= hall.width ? 0 : 90;
    const art = Scene.standalone(hall, course, { rot, grid: false });
    let artW = W - PAD * 2;
    let artH = artW * art.height / art.width;
    if (artH > 620) { artW *= 620 / artH; artH = 620; }
    /* Målene står på appens papirfarve; arket er hvidt, så de ikke må få en plet. */
    body += art.svg.split('fill="' + Scene.BG + '"').join('fill="#fff"').replace('<svg ', '<svg x="' + ((W - artW) / 2).toFixed(1) + '" y="' + y + '" width="' + artW.toFixed(1) + '" height="' + artH.toFixed(1) + '" ');
    y += artH + 16;

    if (s.showDistances) {
      const section = distanceSection(course, PAD, y + 14, W);
      body += section.svg;
      if (section.svg) y = section.y;
    }

    /* Banedesign nederst til højre */
    if (s.designer) {
      y += 6;
      body += text(W - PAD, y + 12, 'Banedesign', 15, INK_2, 'text-anchor="end"') +
        text(W - PAD, y + 36, s.designer, 20, INK, 'font-weight="800" text-anchor="end"');
      y += 36;
    }
    if (s.extra) {
      body += text(W - PAD, y + 26, s.extra, 17, INK_2, 'text-anchor="end"');
      y += 26;
    }
    const H = Math.round(y + 26);
    const size = o.pxWidth ? ' width="' + o.pxWidth + '" height="' + Math.round(o.pxWidth * H / W) + '"' : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"' + size + ' font-family="' + Scene.FONT + '">' +
      (o.background ? '<rect width="' + W + '" height="' + H + '" fill="#fff"/>' : '') + body + '</svg>';
    return { svg, width: W, height: H, logoBox: hasLogo ? LOGO : null };
  }

  /* Bygger arket som én SVG. opts.pxWidth giver en fast billedstørrelse, opts.background en papirfarve. */
  function sheet(hall, course, opts) {
    const o = opts || {};
    const W = 1200;
    const PAD = 44;
    const HEAD = 104;
    const inner = W - PAD * 2;

    /* Tegningen fylder bredden, men må ikke presse afstandene ud af siden på en næsten kvadratisk hal. */
    const rot = hall.length >= hall.width ? 0 : 90;
    const art = Scene.standalone(hall, course, { rot, grid: false });
    const CARD_PAD = 16;
    let artW = inner - CARD_PAD * 2;
    let artH = artW * art.height / art.width;
    if (artH > 600) { artW *= 600 / artH; artH = 600; }
    const artY = HEAD + 24;
    const artBox = artH + CARD_PAD * 2;
    const artSvg = art.svg.replace('<svg ', '<svg x="' + ((W - artW) / 2).toFixed(1) + '" y="' + (artY + CARD_PAD) + '" width="' + artW.toFixed(1) + '" height="' + artH.toFixed(1) + '" ');

    const title = course.name;
    const titleSize = Math.min(38, Math.floor((inner - 200) / (title.length * 0.56)));
    let body = '<rect width="' + W + '" height="' + HEAD + '" fill="' + FOREST + '"/>' +
      text(PAD, 52, title, titleSize, '#fff', 'font-weight="800"') +
      text(PAD, 83, hall.name + ' · ' + fmtNum(hall.length) + ' × ' + fmtNum(hall.width) + ' m', 20, '#cfe0d6') +
      text(W - PAD, 52, UI.fmtDate(Date.now()), 18, '#cfe0d6', 'text-anchor="end"') +
      '<rect x="' + PAD + '" y="' + artY + '" width="' + inner + '" height="' + artBox.toFixed(1) + '" rx="14" fill="' + Scene.BG + '" stroke="' + LINE + '" stroke-width="1.5"/>' +
      artSvg;

    let y = artY + artBox + 30;
    const section = distanceSection(course, PAD, y, W);
    body += section.svg;
    y = section.y;
    body += text(W - PAD, y + 10, 'Grejs Bane Byg', 15, INK_2, 'text-anchor="end"');
    const H = Math.round(y + 30);

    const size = o.pxWidth ? ' width="' + o.pxWidth + '" height="' + Math.round(o.pxWidth * H / W) + '"' : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"' + size + ' font-family="' + Scene.FONT + '">' +
      (o.background ? '<rect width="' + W + '" height="' + H + '" fill="' + Scene.BG + '"/>' : '') + body + '</svg>';
    return { svg, width: W, height: H };
  }

  /* ---------- Eksport ---------- */

  /* Tegner SVG'en på et canvas og henter resultatet som PNG. Foregår helt i browseren. */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Billedet kunne ikke dannes.'));
      img.src = url;
    });
  }

  /* opts.contest vælger stævnearket. Logoet tegnes for sig på canvas, fordi ikke alle
     browsere tegner et billede, der ligger inde i en SVG, der selv er indlæst som billede. */
  async function exportPng(hall, course, opts) {
    const px = 2400;
    const contest = !!(opts && opts.contest);
    const out = contest
      ? contestSheet(hall, course, { pxWidth: px, background: true, omitLogo: true })
      : sheet(hall, course, { pxWidth: px, background: true });
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg));
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.round(px * out.height / out.width);
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (contest && out.logoBox) {
      const logo = await loadImage(hall.logo);
      const scale = px / out.width;
      const box = out.logoBox;
      const fit = Math.min(box.w / logo.naturalWidth, box.h / logo.naturalHeight);
      const w = logo.naturalWidth * fit;
      const h = logo.naturalHeight * fit;
      g.drawImage(logo, (box.x + (box.w - w) / 2) * scale, (box.y + (box.h - h) / 2) * scale, w * scale, h * scale);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Billedet kunne ikke dannes.');
    UI.download(blob, UI.safeFilename(hall.name + ' ' + course.name + (contest ? ' staevne' : '')) + '.png');
  }

  /* Viser arket alene på siden i printvisningen, så browseren kan udskrive eller gemme som PDF. */
  function printCourse(hall, course, opts) {
    let area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      document.body.appendChild(area);
    }
    area.innerHTML = (opts && opts.contest ? contestSheet(hall, course) : sheet(hall, course)).svg;
    window.print();
  }

  GBS.Exporter = { exportPng, printCourse, legs, sheet, contestSheet, courseStops };
})(window.GBS);
