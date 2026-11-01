/* Grejs_Bane_Byg – eksport af en bane som PNG og udskrift/PDF via browseren. */
(function (GBS) {
  'use strict';

  const { UI, Scene } = GBS;

  function caption(hall, course) {
    return {
      title: course.name,
      subtitle: hall.name + ' · ' + UI.fmtNum(hall.length) + ' × ' + UI.fmtNum(hall.width) + ' m',
    };
  }

  /* Tegner SVG'en på et canvas og henter resultatet som PNG. Foregår helt i browseren. */
  function exportPng(hall, course) {
    const px = 2400;
    const cap = caption(hall, course);
    const rot = hall.length >= hall.width ? 0 : 90;
    const out = Scene.standalone(hall, course, {
      rot, pxWidth: px, title: cap.title, subtitle: cap.subtitle, background: true, grid: course.view.showGrid,
    });
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

  /* Viser banen alene på siden i printvisningen, så browseren kan udskrive eller gemme som PDF. */
  function printCourse(hall, course) {
    const cap = caption(hall, course);
    let area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      document.body.appendChild(area);
    }
    area.innerHTML = Scene.standalone(hall, course, {
      rot: hall.length >= hall.width ? 0 : 90, title: cap.title, subtitle: cap.subtitle, grid: course.view.showGrid,
    }).svg;
    window.print();
  }

  GBS.Exporter = { exportPng, printCourse };
})(window.GBS);
