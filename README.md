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
| `js/route.js` | Foreslår en ridevej ud fra springenes numre og pile |
| `js/share.js` | Deler en enkelt bane som link eller fil |
| `js/exporter.js` | PNG og udskrift/PDF |
| `js/editor.js` | Banebyggeren: gestik, værktøjer, fortryd og paneler |
| `js/app.js` | Startside, ridehal, indstillinger og navigation |
| `manifest.webmanifest`, `icons/` | Navn og ikoner til den installerede app |
| `sw.js` | Service worker: henter nyeste version, når der er net, og bruger en gemt kopi uden net |

## Designvalg

- Alle koordinater gemmes i meter, så placeringer er uafhængige af skærm og zoom.
- Et spring gemmer kun `rotation`. Den røde pil tegnes inde i springets roterede gruppe og kan derfor ikke komme ud af trit med springet.
- En lang hal vises automatisk på højkant, når det giver mere plads, f.eks. på en telefon i portræt. Det ændrer kun visningen, ikke de gemte data.
- Springtyperne er `vertical`, `oxer`, `triple` (Triple Bar med tre parallelle dele) og `pole`. For oxer og triple bar er `depth` afstanden mellem de yderste dele.
- Et spring kan have et ekstra nummer i rød ring (`number2`) og pil begge veje (`bothWays`). Med pil begge veje kan det også have et nummer til den anden retning (`number3`). En bane kan desuden have et samlet skift `MÅL/START` (`markers.change`) ud over START og MÅL.
- START, MÅL og MÅL/START kan drejes (`rotation`) og ændre størrelse (`size`, i procent). En markering uden `rotation` står altid opret; en drejet markering følger hallen.
- PNG og udskrift bruger samme banekort (`Exporter.sheet`) med tegning og afstande. Afstandene gemmes i `distances` pr. strækning, f.eks. `"1|2": 14.5`, og strækningerne dannes ud fra springenes numre.
- Pynt ligger i `decorations` (`tree`, `bush`, `flowers`) og tegnes under rideveje og spring. `Generer ridevej` kører uden om dem.
- Print og PNG kan laves til træning eller stævne. Stævnearket (`Exporter.contestSheet`) bruger felterne i `course.show` og logoet i `hall.logo`, som kun er en lille PNG eller JPEG gemt som tekst.
- En bane deles som et link (`#/del/...`). Banen ligger pakket i linket efter `#`, som ikke sendes til serveren. Logoet følger kun med, når banen sendes som fil. Modtaget data renses af `Store.cleanShared`, før det vises.
- Ind og ud er to markeringer i data (`entrance` og `exit`). Som standard vises de som én samlet boks (`entrance.linked`), men de kan adskilles.
