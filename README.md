# Kwebbel

Veilig kletsen en bestanden delen voor kinderen, **op hetzelfde wifi, zonder internet en zonder server**.
Een soort AirDrop + chat die werkt op iPhone, iPad, Android, tablets en laptops (Mac, Windows, Chromebook).

**Open de app:** https://kmhkasper-boop.github.io/kwebbel/

## Wat kan het?
- 💬 Berichtjes en emoji, 🖼️ foto's, 🎬 filmpjes, 📄 bestanden (tot 2 GB, met voortgangsbalk) en 🎤 spraakberichtjes.
- 👫 **Alleen gekoppelde contacten.** Een nieuw vriendje toevoegen kan alleen met de pincode van een ouder, en alleen door elkaars QR-code te scannen, dus naast elkaar. Vreemden kunnen er niet bij.
- 🔒 **Versleuteld van apparaat tot apparaat.** Elk apparaat heeft een eigen sleutelpaar (ECDH + ECDSA P-256). Per verbinding wordt een nieuwe sleutel afgesproken en alles gaat met AES-256-GCM, bovenop de DTLS-versleuteling van WebRTC. Bij het koppelen tonen beide schermen een **geheime code** (6 plaatjes + 6 cijfers) om te controleren dat er niemand tussen zit.
- 👀 **Ouder kan meelezen**, eerlijk: op het apparaat van het kind koppel je (met de pincode) de telefoon van een ouder. Die krijgt dan versleutelde kopieën van nieuwe gesprekken. Het kind ziet dat altijd ("Mama leest mee") en de vriendjes ook ("Een ouder van Sam leest mee").
- ⏳ Niet verbonden? Berichten wachten op het apparaat en gaan vanzelf zodra jullie weer verbonden zijn.
- 📲 Installeerbaar als app en werkt offline. Grote, vrolijke knoppen, alles in het Nederlands.

## Hoe werkt verbinden?
Er is geen server die de apparaten aan elkaar voorstelt, dus dat doen de QR-codes:
1. **Koppelen (één keer):** A tikt op ➕, B tikt op 📷 en scant A's code. B laat dan een antwoord-code zien, die A scant. Klaar.
2. **Verbinden (daarna):** A tikt op 🔗 en laat een code zien, B scant hem. **Eén scan.** A rekent het antwoord van B zelf uit (uit het gedeelde geheim van het koppelen), dus B hoeft niets terug te laten zien.
3. Lukt het niet binnen een paar tellen? Dan laat B vanzelf een reserve-code zien die A scant.
4. Daarna blijven de apparaten verbonden **zolang de app op beide openstaat**.

## Eerlijke beperkingen
- **Beide apps moeten open zijn.** Er is geen server die berichten bewaart. Op een **iPhone/iPad** stopt de verbinding als het scherm op slot gaat of je naar een andere app gaat; daarna is één nieuwe scan nodig. Daarom staat "scherm aan houden" standaard aan. Android en laptops houden het iets langer vol, maar ook daar stopt het als de app lang op de achtergrond staat.
- **Hetzelfde wifi-netwerk.** Gastnetwerken, school-, hotel- en bedrijfswifi zetten vaak "client-isolatie" aan: dan mogen apparaten niet met elkaar praten en werkt Kwebbel niet. Ook twee verschillende netwerken (bijv. 2,4 GHz-gastnetwerk en het gewone netwerk) werken vaak niet. Een mobiele hotspot van een ouder werkt meestal wel.
- **Geen meldingen als de app dicht is** (daar is een server voor nodig).
- **Opslag op het apparaat zelf.** Wis je de websitegegevens of de app, dan is alles weg (ook de sleutel: dan opnieuw koppelen). Op iPhone: gebruik de app vanaf het beginscherm. Die heeft een eigen opslag, los van Safari.
- **Meelezen** begint vanaf het moment van koppelen. Kopieën komen binnen zodra het kind met de ouder verbonden is. Bestanden tot 50 MB worden meegekopieerd (instelbaar).
- Berichten staan op het apparaat zelf niet extra versleuteld. Beveilig het apparaat met een schermvergrendeling.
- Pincode vergeten? Dan kun je Kwebbel alleen helemaal wissen (via de instellingen van de browser) en opnieuw beginnen.

## Techniek
Plain HTML/CSS/JS, geen build-stap, geen tracking, geen externe verzoeken.
- `js/link.js`: WebRTC-datakanalen zonder signaleringsserver. Compacte SDP in de QR-code (ICE-gebruikersnaam/-wachtwoord, DTLS-vingerafdruk, host-kandidaten). Vaste DTLS-certificaten per apparaat (IndexedDB) maken verbinden met één scan mogelijk. Handdruk met ondertekende tijdelijke ECDH-sleutels.
- `js/kcrypto.js`: WebCrypto (ECDH/ECDSA P-256, HKDF, AES-GCM, PBKDF2 voor de pincode).
- `js/media.js`: QR scannen (BarcodeDetector of jsQR), spraakopname (MediaRecorder; AAC op iPhone, anders omgezet naar WAV zodat het overal afspeelt).
- `js/db.js`: IndexedDB. `sw.js`: offline.
- Bibliotheken: `qrcode.js` (Kazuhiko Arase, MIT), `jsQR` (Apache-2.0). Lettertype Nunito (SIL OFL).

Tests: `test-e2e.py` (Playwright): drie losse browsers (Sam, Noor en Mama) koppelen, verbinden, berichten, een bestand van 12 MB (SHA-256 gecontroleerd), een foto, spraak, wachtrij en opnieuw verbinden, de reserve-route, ouderkopieën en vreemde apparaten. Plus WebKit (Safari-motor) ↔ Chromium.
