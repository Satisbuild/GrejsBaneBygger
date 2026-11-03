/* Grejs_Bane_Byg – deling af en enkelt bane som link eller fil.
   Banen ligger i linket efter #, så den aldrig sendes til en server.
   Det, der modtages, er fremmed data: det renses af Store.cleanShared, før det bruges. */
(function (GBS) {
  'use strict';

  const { UI } = GBS;

  const MAX_TOKEN = 400000;      /* Tegn i et link */
  const MAX_JSON = 5000000;      /* Bytes efter udpakning, så et link ikke kan fylde hele hukommelsen */
  const MAX_FILE = 3000000;
  const LONG_LINK = 6000;        /* Over denne længde kan beskedtjenester have svært ved linket */
  const SITE = 'https://grejsbanebyg.com/';

  /* En foreslået ridevej har tætte punkter. I et link er hvert tredje nok til at bevare formen. */
  function thinPath(p) {
    if (!p.auto || p.points.length < 12) return p;
    const pins = p.pins || [];
    const points = [];
    const newPins = [];
    p.points.forEach((q, i) => {
      const pin = pins.includes(i);
      if (!pin && i % 3 && i !== p.points.length - 1) return;
      if (pin) newPins.push(points.length);
      points.push(q);
    });
    return Object.assign({}, p, { points, pins: newPins });
  }

  /* Logoet er for stort til et link og følger kun med i en fil. */
  function pack(hall, course, forLink) {
    const out = {
      app: 'grejsBaneByg',
      v: 1,
      hall: { name: hall.name, length: hall.length, width: hall.width },
      course: {
        name: course.name,
        obstacles: course.obstacles,
        markers: course.markers,
        paths: forLink ? course.paths.map(thinPath) : course.paths,
        distances: course.distances,
        decorations: course.decorations,
        letters: course.letters,
        show: course.show,
        view: course.view,
      },
    };
    if (!forLink && hall.logo) out.hall.logo = hall.logo;
    return out;
  }

  function toBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* Læser en strøm og stopper, hvis den fylder for meget. */
  async function readLimited(stream, limit) {
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Banen i linket er for stor.');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    chunks.forEach((c) => { out.set(c, at); at += c.length; });
    return out;
  }

  /* Første tegn fortæller formatet: z er pakket, j er upakket til browsere uden pakning. */
  async function encode(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + toBase64Url(await readLimited(stream, MAX_JSON));
  }

  async function decode(token) {
    const bad = new Error('Linket er ikke helt. Bed om at få det sendt igen, eller send banen som fil.');
    if (!token || token.length > MAX_TOKEN) throw bad;
    let bytes;
    try {
      bytes = fromBase64Url(token.slice(1));
    } catch (e) { throw bad; }
    try {
      if (token[0] === 'z') {
        if (typeof DecompressionStream === 'undefined') throw new Error('old');
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes = await readLimited(stream, MAX_JSON);
      } else if (token[0] !== 'j') {
        throw bad;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      if (e.message === 'old') throw new Error('Din browser er for gammel til at åbne linket. Bed om at få banen sendt som fil.');
      if (e.message === 'Banen i linket er for stor.') throw e;
      throw bad;
    }
  }

  async function buildLink(hall, course) {
    const base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : SITE;
    return base + '#/del/' + await encode(pack(hall, course, true));
  }

  /* Endelsen .txt er nødvendig: browsernes deling afviser ukendte filtyper. */
  function buildFile(hall, course) {
    const name = UI.safeFilename(course.name) + '.grejsbane.txt';
    return new File([JSON.stringify(pack(hall, course, false))], name, { type: 'text/plain' });
  }

  async function readFile(file) {
    if (file.size > MAX_FILE) throw new Error('Filen er for stor til at være en bane.');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('Filen er ikke en bane fra Grejs Bane Byg.');
    }
    if (data && Array.isArray(data.halls)) throw new Error('Det er en backup. Den indlæses under Indstillinger.');
    return data;
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* Prøv den gamle måde */ }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    (document.querySelector('dialog[open]') || document.body).appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* Håndteres af den, der kalder */ }
    area.remove();
    return ok;
  }

  /* Messenger og andre apps åbner links i deres egen browser, som har sit eget lager. */
  function inAppBrowser() {
    return /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram/i.test(navigator.userAgent);
  }

  GBS.Share = { pack, encode, decode, buildLink, buildFile, readFile, copyText, inAppBrowser, LONG_LINK };
})(window.GBS);
