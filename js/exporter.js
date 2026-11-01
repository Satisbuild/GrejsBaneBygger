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
      [o.number, o.number2, o.bothWays ? o.number3 : ''].forEach((text) => {
        String(text || '').split('/').map((s) => s.trim()).filter(Boolean).forEach((name) => {
          if (seen.has(name)) return;
          seen.add(name);
          stops.push({ name, x: o.x, y: o.y });
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

  /* Bygger arket som én SVG. opts.pxWidth giver en fast billedstørrelse, opts.background en papirfarve. */
  function sheet(hall, course, opts) {
    const o = opts || {};
    const W = 1200;
    const PAD = 44;
    const HEAD = 104;
    const inner = W - PAD * 2;
    const distances = course.distances || {};
    const filled = legs(course).filter((l) => distances[l.key] != null);

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
    if (filled.length) {
      const total = filled.reduce((sum, l) => sum + distances[l.key], 0);
      body += text(PAD, y + 8, 'Afstande mellem spring', 24, INK, 'font-weight="800"') +
        text(W - PAD, y + 8, 'I alt ' + fmtNum(total, 1) + ' m', 22, FOREST, 'font-weight="800" text-anchor="end"');
      y += 26;
      const COLS = 6;
      const GAP = 12;
      const cardW = (inner - GAP * (COLS - 1)) / COLS;
      const cardH = 80;
      filled.forEach((leg, i) => {
        const cx = PAD + (i % COLS) * (cardW + GAP);
        const cy = y + Math.floor(i / COLS) * (cardH + GAP);
        body += distanceCard(leg, distances[leg.key], cx, cy, cardW, cardH);
      });
      y += Math.ceil(filled.length / COLS) * (cardH + GAP) - GAP + 26;
    }
    body += text(W - PAD, y + 10, 'Grejs Bane Byg', 15, INK_2, 'text-anchor="end"');
    const H = Math.round(y + 30);

    const size = o.pxWidth ? ' width="' + o.pxWidth + '" height="' + Math.round(o.pxWidth * H / W) + '"' : '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"' + size + ' font-family="' + Scene.FONT + '">' +
      (o.background ? '<rect width="' + W + '" height="' + H + '" fill="' + Scene.BG + '"/>' : '') + body + '</svg>';
    return { svg, width: W, height: H };
  }

  /* ---------- Eksport ---------- */

  /* Tegner SVG'en på et canvas og henter resultatet som PNG. Foregår helt i browseren. */
  function exportPng(hall, course) {
    const px = 2400;
    const out = sheet(hall, course, { pxWidth: px, background: true });
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = Math.round(px * out.height / out.width);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('Billedet kunne ikke dannes.')); return; }
          UI.download(blob, UI.safeFilename(hall.name + ' ' + course.name) + '.png');
          resolve();
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Billedet kunne ikke dannes.'));
      img.src = url;
    });
  }

  /* Viser arket alene på siden i printvisningen, så browseren kan udskrive eller gemme som PDF. */
  function printCourse(hall, course) {
    let area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      document.body.appendChild(area);
    }
    area.innerHTML = sheet(hall, course).svg;
    window.print();
  }

  GBS.Exporter = { exportPng, printCourse, legs, sheet };
})(window.GBS);
