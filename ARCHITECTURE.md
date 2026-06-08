# Arhitektura projekta

Ovaj dokument je ljudska mapa projekta: gdje je sto, kako se podaci mapiraju,
koji su fajlovi generirani i gdje treba krenuti kad dodajes novi interaktivni
ispit.

`AGENTS.md` je operativni naputak za asistenta i pravila rada. Ovaj dokument je
za razvoj i odrzavanje koda.

## Mentalni model

Projekt ima tri sloja:

1. Arhiva ispita: `scripts/fetch_ncvvo.py` skida i zrcali NCVVO ZIP pakete u
   `files/ncvvo/` i generira `data/exams.js`.
2. Interaktivni builderi: `scripts/build_*.py` citaju ZIP pakete iz
   `files/ncvvo/`, izdvajaju PDF/audio/slike i generiraju `data/*.js` plus
   `files/interactive/<solver>/`.
3. Frontend: `index.html` i `app.js` ucitavaju sve `data/*.js`, povezuju
   arhivski zapis s interaktivnim zapisom i otvaraju standalone solver stranice
   poput `hrvatski.html`, `matematika.html` ili `hrvatski-pisanje.html`.

Tok podataka:

```text
NCVVO WordPress arhiva
  -> scripts/fetch_ncvvo.py
  -> files/ncvvo/**/*.zip
  -> data/exams.js

files/ncvvo/**/*.zip
  -> scripts/build_*.py
  -> files/interactive/<solver>/**/*
  -> data/<solver>.js

index.html + app.js
  -> mapira data/exams.js na data/<solver>.js
  -> standalone solver page ?exam=<generated-id>
```

## Runtime nacini

Staticki nacin:

```bash
python3 -m http.server 8080
```

Radi arhiva, preuzimanja, lokalno spremanje odgovora i vecina solvera. Ne radi
prijava ni sync profila.

Node server:

```bash
npm start
```

Koristi `server.js`. Sluzit ce staticke fajlove, ali dodaje API za Google
prijavu, profil i feedback.

Provjera sintakse:

```bash
npm run check
python3 -m py_compile scripts/fetch_ncvvo.py scripts/build_croatian_writing.py
```

## Glavni fajlovi

| Fajl | Uloga |
| --- | --- |
| `index.html` | Home/subject/archive shell. Ucitava sve glavne `data/*.js` i `app.js`. |
| `app.js` | Router bez frameworka, filteri, subject pages, exam detail pages, progress, mapiranje na solvere. |
| `styles.css` | Sav styling za home, arhivu, solvere, modalne prozore i responsive layout. |
| `analytics.js` | Zajednicki GA4/Clarity loader, kontekst stranice i kljucni dogadjaji. |
| `server.js` | Opcionalni Node backend za auth, profil sync, feedback i staticko serviranje. |
| `profile-store.js` | Local/profile persistence adapter za pokusaje i vjezbe. |
| `auth-client.js` | Frontend auth klijent i profile sync hookovi. |
| `exam-simulation.js` | Zajednicki timed simulation mode. |
| `solver-self-check.js` | Zajednicki `Provjeri` za auto-checkable zadatke. |
| `solver-header.js` | Zajednicki header za standalone solvere. |
| `site-header.js`, `site-footer.js` | Zajednicki layout chrome. |
| `scripts/pdf_utils.py` | Zajednicki helperi za `pdftotext`, `pdfinfo`, `pdftocairo`, PNG dimenzije i osnovni slug/term utility. |

## Analitika

`analytics.js` ucitava GA4 measurement ID `G-3W2D6EJZ94` i Clarity projekt
`x0a1kkmiqz` bez posebnog first-party consent cookieja u aplikaciji. GA4
consent defaults postavljaju `analytics_storage: granted`, dok oglasni storage,
user data, Google signals i personalizacija ostaju iskljuceni. Stari
`azm_analytics_consent` cookie se brise pri ucitavanju analitike. Ne slati
odgovore, uneseni tekst, email adresu ni drugi PII preko
`window.AsistentAnalytics.track()`.

GA4 i Clarity dobivaju isti kontekst kroz `azm_page_type`, `azm_subject`,
`azm_exam_id`, `azm_exam_part` i `azm_mode`. Za prikaz tih parametara u GA4
izvjestajima treba ih registrirati kao event-scoped custom dimensions.

U GA4 Web Stream postavkama ukljuci Enhanced Measurement po potrebi, ali
iskljuci `Page changes based on browser history events`. Solveri koriste
`history.replaceState()` za task-type i question navigaciju pa bi ta opcija
napuhala broj pageviewa.

Nativno povezivanje Clarity snimki s GA4 izvjestajima konfigurira se u Clarity
dashboardu pod `Settings -> Setup -> Google Analytics`. Uz measurement ID trazi
i GA Account ID i Property ID; te vrijednosti se ne spremaju u repozitorij.

Microsoftova Clarity dokumentacija upozorava da se Clarity ne bi trebao
koristiti na stranicama usmjerenima korisnicima mladjima od 18 godina. Buduci
da projekt koriste i maturanti mladji od 18, tu odluku treba posebno provjeriti
prije produkcijskog koristenja Clarityja.

## Generirani podaci

Svi `data/*.js` fajlovi su JS wrapper oko JSON-a. Svaki postavlja globalni
`window.ASISTENT_ZA_MATURE_*`.

Ne editirati rucno osim kao privremeni debug.

| Data file | Generira | Izvor | Koristi |
| --- | --- | --- | --- |
| `data/exams.js` | `scripts/fetch_ncvvo.py` | NCVVO arhiva | `index.html`, `app.js` |
| `data/english-reading.js` | `scripts/build_english_reading.py` | `files/ncvvo/` | `engleski-citanje.html`, `app.js` |
| `data/english-listening.js` | `scripts/build_english_listening.py` | `files/ncvvo/` | `engleski-slusanje.html`, `app.js` |
| `data/english-essay.js` | `scripts/build_english_essay.py` | `files/ncvvo/` | `engleski-esej.html`, `app.js` |
| `data/croatian-choice.js` | `scripts/build_croatian_choice.py` | `files/ncvvo/` | `hrvatski.html`, `app.js` |
| `data/croatian-writing.js` | `scripts/build_croatian_writing.py` | `files/ncvvo/` | `hrvatski-pisanje.html`, `app.js` |
| `data/physics-choice.js` | `scripts/build_physics_choice.py` | `files/ncvvo/` | `fizika.html`, `app.js` |
| `data/math-choice.js` | `scripts/build_math_choice.py` | `files/ncvvo/` | `matematika.html`, `app.js` |
| `data/history-choice.js` | `scripts/build_history_choice.py` | `files/ncvvo/` | `povijest.html`, `app.js` |
| `data/geography-choice.js` | `scripts/build_geography_choice.py` | `files/ncvvo/` | `geografija.html`, `app.js` |
| `data/psychology-choice.js` | `scripts/build_psychology_choice.py` | `files/ncvvo/` | `psihologija.html`, `app.js` |
| `data/politics-choice.js` | `scripts/build_politics_choice.py` | `files/ncvvo/` | `politika.html`, `app.js` |
| `data/abcd-choice.js` | `scripts/build_abcd_choice.py` | `files/ncvvo/` | `abcd.html`, `app.js` |

Generated assets zive u:

```text
files/interactive/<solver>/<exam-id>/
  paper.pdf
  page-*.png
  open-paper.pdf / open-page-*.png       # ako solver ima otvorene zadatke
  solutions.pdf / solution-page-*.png    # ako je potrebno za self-review
  audio.*                                # English listening
```

`files/ncvvo/` mora biti deployan uz site jer `data/exams.js` linka lokalne ZIP
pakete.

## Mapiranje arhive na interaktivne ispite

`data/exams.js` sadrzi arhivske zapise:

```js
{
  year,
  schoolYear,
  term,
  subject,
  level,
  url,        // lokalni ZIP, npr. ./files/ncvvo/...
  sourceUrl,  // NCVVO post
  upstreamUrl // originalni ZIP
}
```

Svaki interaktivni `data/<solver>.js` zapis sadrzi `archiveUrl`. `app.js` radi
mapiranje kroz `solverDefinitions` registry ovako:

| Solver | Map key u `app.js` |
| --- | --- |
| Engleski citanje/slusanje/esej | `archiveUrl` |
| Hrvatski knjizevnost/jezik | `archiveUrl` |
| Hrvatski pisanje | `archiveUrl + "|" + kind` jer isti arhiv ima `sazetak` i `skolski-esej` |
| Fizika, Matematika, Povijest, Geografija, Politika, ABCD | `archiveUrl` |

Ako mapiranje ne nadje zapis, UI prikaze dio kao nedostupan:
`Nema definiranog interaktivnog ispita za sada.`

`solverDefinitions` je izvor istine za frontend povezivanje arhive i solvera.
Svaka definicija drzi data array, storage prefix, standalone page, `idForTerm`
builder i po potrebi poseban archive key. `buildSolverRegistry()` normalizira
rokove, dodaje deterministicki ID i gradi `byArchive` mapu. Stare tanke helper
funkcije poput `mathChoiceUrl()` i `physicsChoiceExamForArchive()` delegiraju na
registry radi manjeg diff-a u render/progress kodu.

## ID sheme

ID-jevi se ne citaju iz arhive nego se deterministicki grade iz godine, roka,
razine i vrste dijela. Najvaznije funkcije su u `app.js`.

| Podrucje | ID format |
| --- | --- |
| Arhivski exam page | `<predmet-slug>-<year>-<term-slug>-<level-or-bez-razine>` |
| Engleski reading/listening/essay | `engleski-<a|b>-<year>-<term-slug>` |
| Hrvatski pisanje | `hrvatski[-<a|b>]-<year>-<term-slug>-<kind>` |
| Fizika | `fizika-<year>-<term-slug>` |
| Matematika | `matematika[-<a|b>]-<year>-<term-slug>` |
| Hrvatski knjizevnost/jezik | `hrvatski[-<a|b>]-<year>-<term-slug>` |
| Povijest | `povijest-<year>-<term-slug>` |
| Geografija | `geografija-<year>-<term-slug>` |
| Psihologija | `psihologija-<year>-<term-slug>` |
| Politika i gospodarstvo | `politika-i-gospodarstvo-<year>-<term-slug>` |

Rokovi imaju alias mapiranje:

```text
prvi rok    -> ljetni rok
drugi rok   -> jesenski rok
ljetni rok  -> ljetni rok
jesenski rok -> jesenski rok
```

Zbog toga storage i mapiranje cesto pokusavaju i legacy ID i normalizirani ID.

## Stranice i solveri

| Predmet/dio | Page | Solver JS | Data | Assets |
| --- | --- | --- | --- | --- |
| Engleski citanje | `engleski-citanje.html` | `english-reading.js` | `data/english-reading.js` | `files/interactive/english-reading/` |
| Engleski slusanje | `engleski-slusanje.html` | `english-listening.js` | `data/english-listening.js` | `files/interactive/english-listening/` |
| Engleski esej | `engleski-esej.html` | `english-essay.js` | `data/english-essay.js` | `files/interactive/english-essay/` |
| Hrvatski knjizevnost/jezik | `hrvatski.html` | `croatian-choice.js` | `data/croatian-choice.js` | `files/interactive/croatian-choice/` |
| Hrvatski pisanje | `hrvatski-pisanje.html` | `croatian-writing.js` | `data/croatian-writing.js` | `files/interactive/croatian-writing/` |
| Fizika | `fizika.html` | `physics-choice.js` | `data/physics-choice.js` | `files/interactive/physics-choice/` |
| Matematika | `matematika.html` | `math-choice.js` | `data/math-choice.js` | `files/interactive/math-choice/` |
| Povijest | `povijest.html` | `history-choice.js` | `data/history-choice.js` | `files/interactive/history-choice/` |
| Geografija | `geografija.html` | `geography-choice.js` | `data/geography-choice.js` | `files/interactive/geography-choice/` |
| Psihologija | `psihologija.html` | `psychology-choice.js` | `data/psychology-choice.js` | `files/interactive/psychology-choice/` |
| Politika i gospodarstvo | `politika.html` | `politics-choice.js` | `data/politics-choice.js` | `files/interactive/politics-choice/` |
| Genericki ABCD | `abcd.html` | `abcd-choice.js` | `data/abcd-choice.js` | `files/interactive/abcd-choice/` |

Standalone solver URL izgleda ovako:

```text
./hrvatski-pisanje.html?exam=hrvatski-b-2019-ljetni-rok-skolski-esej
./matematika.html?exam=matematika-a-2024-ljetni-rok
./fizika.html?exam=fizika-2022-jesenski-rok&nacin=simulacija
```

`nacin=simulacija` ukljucuje transient timed mode preko `exam-simulation.js`.

## `app.js` je glavni router

`app.js` radi nekoliko poslova:

1. Normalizira arhivske zapise iz `data/exams.js`.
2. Normalizira interaktivne zapise iz svih `data/<solver>.js`.
3. Gradi mape `archiveUrl -> interactiveExam`.
4. Renderira:
   - home view
   - subject view: `/?predmet=Hrvatski%20jezik`
   - exam detail view: `/?ispit=<archive-exam-id>`
5. Za svaki arhivski ispit zove `interactiveParts(exam)`.
6. `interactiveParts(exam)` vraca popis ispitnih cjelina i njihove akcije:
   `Otvori vježbu` i `Simuliraj maturu`.

Ako dodajes novu ispitnu cjelinu, najcesce diras:

```text
app.js
  -> solverDefinitions entry (data, storagePrefix, page, idForTerm, archive key)
  -> interactiveParts(exam)
  -> progress helpers ako treba
```

## Hrvatski pisanje kao primjer slozenijeg mapiranja

`data/croatian-writing.js` ima vise zapisa za isti ZIP:

```text
archiveUrl + "|sazetak"
archiveUrl + "|skolski-esej"
```

`scripts/build_croatian_writing.py` razlikuje:

| Godine | Format | Dijelovi |
| --- | --- | --- |
| 2023-2025 | novi jednorazinski format | `sazetak`, `skolski-esej` |
| 2013-2022 A/B | stari format | samo `skolski-esej` |

2020 ljetni A/B ostaje bez starog eseja ako lokalni NCVVO ZIP nema `IK-2` ni
zasebni esejski zadatak.

Svaki zapis upucuje na verzioniranu rubriku preko `rubricId`. Rubrike u
`data/croatian-writing.js` sadrze NCVVO izvor, kriterije, razine ili podstavke i
posebna pravila. Stari A/B eseji imaju tri sastavnice s podstavkama
`A1-A5`, `B1-B3` i `C1-C4`:

```text
A: Poznavanje i razumijevanje knjizevnoga teksta: 20
B: Povezanost teksta: 6
C: Upotreba standardnoga hrvatskog jezika: 14
```

Stari eseji iz 2016.-2018. mnoze sirovi zbroj od 40 bodova s 2. Ostali
podrzani stari eseji trenutacno koriste sirovi maksimum 40. Novi eseji imaju
30 bodova preko 5 kriterija po 0-3, uz `scoreMultiplier: 2`.

## LocalStorage i profil

Practice progress se prvo sprema lokalno. Prefixi su oblika:

```text
asistent-za-mature:<solver>:<exam-id>
asistent-za-mature:<solver>:<exam-id>:open-scores
```

Primjeri:

```text
asistent-za-mature:croatian-writing:hrvatski-b-2019-ljetni-rok-skolski-esej
asistent-za-mature:math-choice:matematika-a-2024-ljetni-rok
asistent-za-mature:physics-choice:fizika-2020-ljetni-rok:open-scores
```

Ako je korisnik prijavljen, `profile-store.js` i `auth-client.js` syncaju dio
podataka preko `server.js`.

## API endpointi u `server.js`

| Endpoint | Uloga |
| --- | --- |
| `/api/auth/config` | Frontend auth konfiguracija. |
| `/api/auth/google` | Pocetak Google OAuth toka. |
| `/api/auth/google/callback` | OAuth callback. |
| `/api/auth/me` | Trenutni korisnik. |
| `/api/auth/logout` | Logout. |
| `/api/profile/simulations` | Spremanje/citanje simulacija. |
| `/api/profile/practice` | Spremanje/citanje practice progressa. |
| `/api/english-essay/grade`, `/api/english-essay/ocr` | Legacy rute koje vracaju 410 jer je engleski esej samo pregled. |
| `/api/croatian-writing/grade`, `/api/croatian-writing/ocr` | Legacy rute koje vracaju 410 jer su sazetak i skolski esej samo pregled. |

## Kako dodati ili popraviti interaktivni ispit

1. Provjeri postoji li arhivski ZIP u `data/exams.js`.
2. Ako ne postoji, pokreni ili popravi `scripts/fetch_ncvvo.py`.
3. Nadji odgovarajuci builder u `scripts/build_*.py`.
4. U builderu izvuci:
   - `archiveUrl`
   - `paperUrl`
   - `sourceImages`
   - pitanja/zadatke
   - odgovore ili rubriku
   - trajanje
5. Regeneriraj odgovarajuci `data/<solver>.js`.
6. Provjeri da `app.js` mapira taj `archiveUrl` na pravi dio.
7. Otvori standalone URL s `?exam=<id>`.
8. Pokreni `npm run check`.

Ako je rijec o potpuno novom solveru, dodaj:

```text
<predmet>.html
<solver>.js
data/<solver>.js
files/interactive/<solver>/
scripts/build_<solver>.py
app.js mapping + URL builder + interactiveParts branch
index.html script include
package.json check ako treba
```

## Pravila za generirane fajlove

Ne editirati rucno:

```text
data/*.js
files/interactive/**/*
files/ncvvo/**/*
sitemap.xml
```

Izuzetak je hitni debug, ali trajni fix treba ici kroz builder.

Ako builder promijeni veliki broj asseta, prvo provjeri:

```bash
git diff --stat
npm run check
python3 scripts/build_<solver>.py
```

Za `fetch_ncvvo.py` dodatno provjeri:

```text
- godine su 2013-2025
- nema duplicate year + term + subject + level
- lokalni ZIP linkovi postoje
- priority predmeti postoje za ljetni i jesenski rok gdje NCVVO ima paket
```

## Najcesca mjesta gdje se stvari pokvare

| Simptom | Prvo provjeri |
| --- | --- |
| Gumb `Otvori vježbu` je disabled | `data/<solver>.js` nema zapis s istim `archiveUrl` ili `kind`. |
| Solver kaze `Ispit nije pronađen` | ID format u standalone JS-u se ne poklapa s ID formatom iz `app.js`/buildera. |
| Progress se ne vidi na subject pageu | Storage key helper u `app.js` ne cita isti prefix/ID kao solver. |
| Simulacija koristi spremljene odgovore | Solver mora postivati `simulation.active` i ne smije ucitati localStorage u tom modu. |
| Nakon regeneracije nestane puno asseta | Builder vjerojatno radi `shutil.rmtree(ASSET_ROOT)`; provjeri da gradi sve podrzane ispite, ne samo subset. |
| Stari NCVVO paket se ne parsira | Provjeri nazive PDF-ova u ZIP-u; stariji paketi imaju nedosljedne nazive i encoding. |

## Brza orijentacija za Hrvatski

Hrvatski ima dva odvojena solvera:

1. `hrvatski.html` + `croatian-choice.js`
   - knjizevnost/jezik, zadaci s izborom i eventualno otvoreni zadaci
   - data: `data/croatian-choice.js`
   - builder: `scripts/build_croatian_choice.py`

2. `hrvatski-pisanje.html` + `croatian-writing.js`
   - `sazetak` i `skolski-esej`
   - data: `data/croatian-writing.js`
   - builder: `scripts/build_croatian_writing.py`
   - samo pregled zadatka i sluzbenih kriterija; nema unosa, OCR-a ni ocjenjivanja

Na exam detail pageu `app.js` prikazuje oba kao zasebne ispitne cjeline.

## Brza orijentacija za Engleski

Engleski ima tri dijela:

```text
Čitanje   -> engleski-citanje.html   -> english-reading.js
Slušanje  -> engleski-slusanje.html  -> english-listening.js
Esej      -> engleski-esej.html      -> english-essay.js
```

Sva tri se mapiraju preko istog `archiveUrl`, ali u zasebne data fajlove.

## Brza orijentacija za otvorene zadatke

Fizika, matematika, povijest, geografija, psihologija i politika mogu imati kombinaciju:

```text
tasks / questions         # auto-checkable dio
openTasks / openQuestions # otvoreni dio
answers                   # sluzbeni odgovori za auto-check
solutions/sourceImages    # za prikaz zadataka i rjesenja
```

Self-review otvoreni zadaci koriste bodovni input i izrez sluzbenoga rjesenja.
Tako rade fizika, matematika, povijest, geografija, psihologija i politika.
