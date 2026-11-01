# Grejs_Bane_Byg

Webapp til at designe springbaner til ridehal og udendørs bane. Den er bygget til mobilen først og virker også på tablet og computer.

Appen er en statisk side i HTML, CSS og almindelig JavaScript. Den har ingen backend, login, eksterne biblioteker eller byggetrin.

## Kør appen

- **Lokalt:** Åbn `index.html` i en browser.
- **Online:** Læg hele mappen på en webserver eller GitHub Pages. Vælg mappen som kilde under *Settings → Pages*.
- **Installér som app:** Åbn siden over https i Chrome eller Edge, og vælg installér-ikonet i adresselinjen. Det virker ikke, når `index.html` åbnes direkte som fil.

Data ligger i browserens `localStorage` under nøglen `grejsBygSpring_v1`. Data følger browser og webadresse, så en bane gemt på telefonen ses ikke på computeren. Flyt baner med **Indstillinger → Eksportér backup / Importér backup**.

## Struktur

| Fil | Indhold |
| --- | --- |
| `index.html` | Sideskelet og indlæsning af scripts |
| `css/styles.css` | Al styling, mobil først |
| `js/ui.js` | Ikoner, tal, beskeder og dialoger |
| `js/store.js` | Datamodel, validering, lagring og backup |
| `js/scene.js` | Tegner hal, spring, markeringer og rideveje som SVG |
| `js/exporter.js` | PNG og udskrift/PDF |
| `js/editor.js` | Banebyggeren: gestik, værktøjer, fortryd og paneler |
| `js/app.js` | Startside, ridehal, indstillinger og navigation |
| `manifest.webmanifest`, `icons/` | Navn og ikoner til den installerede app |
| `sw.js` | Service worker: henter nyeste version, når der er net, og bruger en gemt kopi uden net |

## Designvalg

- Alle koordinater gemmes i meter, så placeringer er uafhængige af skærm og zoom.
- Et spring gemmer kun `rotation`. Den røde pil tegnes inde i springets roterede gruppe og kan derfor ikke komme ud af trit med springet.
- En lang hal vises automatisk på højkant, når det giver mere plads, f.eks. på en telefon i portræt. Det ændrer kun visningen, ikke de gemte data.
- Et spring kan have et ekstra nummer i rød ring (`number2`) og pil begge veje (`bothWays`). Med pil begge veje kan det også have et nummer til den anden retning (`number3`). En bane kan desuden have et samlet skift `MÅL/START` (`markers.change`) ud over START og MÅL.
- START, MÅL og MÅL/START kan drejes (`rotation`) og ændre størrelse (`size`, i procent). En markering uden `rotation` står altid opret; en drejet markering følger hallen.
- Ind og ud er to markeringer i data (`entrance` og `exit`). Som standard vises de som én samlet boks (`entrance.linked`), men de kan adskilles.
