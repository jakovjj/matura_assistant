# Prijemni za medicinu
# Prijemni za medicinu

Independent digital module. The latest user instruction allows necessary images
from the supplied PDF. All 444 question prompts and A–E answer controls are native
text; formulas use Unicode exponents/indices and explicit HTML subscripts. Two
structured tables are rendered as HTML. Ninety diagram/chemical-structure assets
are extracted as WebP, with the existing pan/zoom viewer. They contain diagrams,
not screenshots of complete questions.

## Complete document inventory

The source has 148 scanned PDF pages, no text layer, third edition. Internal
machine-readable inventory and source SHA-256: `content/medicine/inventory.json`.
PDF page numbers below are one-based; printed question pages are PDF page minus 10.

| PDF pages | Content | Questions / key |
|---|---|---|
| 1–6 | Cover, front matter, third-edition title, blank pages | No exercises |
| 7 | Third-edition preface | Collections drawn from 2016, 2018, 2019; individual years unspecified |
| 8 | Retained second-edition preface | Mentions 2015 and 2017, but those papers are **not** included here |
| 9–10 | Contents and blank page | — |
| 11–34 | Biology title, collection and answer letters | 1–108 on PDF 12–33; key 34 |
| 35–70 | Physics title, collection, answer letters, blank | 1–108 on PDF 36–68; key 69 |
| 71–102 | Chemistry title, collection and answer letters | 1–108 on PDF 72–101; key 102 |
| 103–140 | Original test A, 11 July 2020, academic year 2020/21 | Cover 103; rules 104; 1–120 on 105–139; filled key 140 |
| 141–145 | Admission conditions/application for 2021/22 | No additional examination paper |
| 146–148 | Colophon, blank, back cover | No exercises |

There are **444 unique source questions**: 108 biology + 108 physics + 108
chemistry + 120 in the original 2020 paper. The latter contains biology 1–40,
physics 41–80, chemistry 81–120. The document supplies answer letters, **not
worked solutions**. No examination years are invented for the collections.

## Reproducible import and review

Dependencies: Python 3, Pillow, Poppler `pdftoppm`, Tesseract 5 with `hrv` and `eng`.

```sh
python3 scripts/ocr_medicine.py
python3 scripts/build_medicine.py
python3 scripts/build_medicine.py --check
```

OCR creates cached 180-DPI PNG, text and TSV for every page in
`var/medicine/ocr/`. Question pages also have `-body` outputs using PSM 6 after
cropping the top 5.5% to omit running headers. `--pages 12-15,34 --workers 4`
limits OCR for corrections. Raw OCR never becomes published content automatically.
The OCR manifest detects a different input PDF rather than reusing its cache.

Reviewed transcriptions live in `content/medicine/pages/NNN.txt`; questions start
with `N.`, options with `A.` through `E.`. `[figure:id]` and `[table:id]` reference
reviewed assets. Figure boxes in `figures.json` use the full page normalized to
1000 pixels wide. Tables and keys are in independent JSON files. Wrapping hyphens
are removed during import; intentional inline hyphens remain.

Every question page was visually compared to its scan. All answer entries were
compared with the printed keys, and collection keys received a second independent
reading (which caught Physics 43: **D**). All 90 extracted assets were inspected
in contact sheets. `review-manifest.json` pins the reviewed source file hashes.
After an intentional content correction, compare it to the scan, then update
only that file's SHA-256 in the manifest. A changed transcription or key fails
the builder until that explicit review update. Do not bulk-update hashes to
bypass review. `--check` verifies output reproducibility, not scientific truth.

The builder validates complete numbering, five nonempty options, key lengths,
references, crop bounds and complete sets before replacing output files. It
writes:

- `content/medicine/audit.json`: internal per-question PDF/printed page, source
  number, key page and transcription hash, plus the source PDF hash.
- `data/medicine.js`: public question model with no book metadata or provenance.
- `data/medicine-catalog.js`: small catalog for the home/category page.
- `files/medicine/*.webp`: diagrams. These are already WebP, so they do not need
  PNG sibling generation by `optimize_images.py`.

Keep internal content, raw OCR and docs out of the server's public allowlist.
The supplied PDF is not linked in the interface. The module never enters the
NCVVO archive, scraper, indexes or NCVVO solvers.

## Source inconsistencies requiring editorial confirmation

`content/medicine/review-issues.json` records six possible source errors:

| Question | Issue |
|---|---|
| Biology collection 55 | Key C conflicts with the parent genotypes; A appears consistent |
| Biology collection 64 | Key E describes habitat; C describes the ecological niche |
| Biology collection 79 | Wording and option E conflict with the keyed B |
| Physics collection 39 | Direction of surface/mountain weight comparison conflicts with B |
| Original 2020, 64 | Printed mWb versus calculated approximately 1.54 μWb; key B |
| Original 2020, 73 | Diagram phase/distances do not clearly support keyed E |

These are **not silent editorial corrections**. The UI flags each before solving
and explains the discrepancy when checked; scoring follows the printed key.
Transcription verification does not mean the original source is error-free.
The random exam pool excludes all flagged collection questions. No unreadable
question has been invented. Remaining work is expert resolution of these six
source inconsistencies, not missing transcription.

## Sets, scoring and persistence

The home-page medicine card opens `/?predmet=Prijemni%20za%20medicinu`, not a
solver. This selection page shows only the 120-question **Nasumični ispit**
first and then the three subject collections under **Katalog pitanja**. The
random exam offers practice and simulation; collections offer only untimed
practice. The side guide explains saving, timing and scoring. Direct solver
URLs remain valid, including the verified
2020 paper for existing links, but the selection page does not advertise that
paper. A missing/unknown `exam` redirects to the selection page. The random
exam uses the 2020 scoring model; details appear in the solver, not as current
admission requirements. Do not present the assembled exam as an original paper
or invent a year for it.

- Three 108-question collections: untimed practice in source order, no
  simulation and no admission threshold. Old collection simulation URLs
  redirect to the same collection in practice mode.
- Original 2020 paper: 120 questions, **180 minutes**, +5 correct / 0 wrong or
  unanswered, no negative points, maximum 600, **330 total and 16 correct per
  subject**. Rules visually verified from PDF 104, not copied from current
  admission rules. The category sidebar separately labels current 2026/27 rules.
- `random-120`: 40 freshly sampled, unflagged collection questions per subject,
  180 minutes and the 2020 threshold model. Explicitly labeled **Nasumični
  ispit**; its year is null and it adds no new source questions. Practice saves
  selected question IDs with the first saved action, so reloads preserve the paper.
  Simulation samples afresh and stays transient.

`medicine-core.js` is pure scoring/answer validation. `medicine.js` uses
`createTaskSelfCheck()` and `createExamSimulation()`. It also calls
`SolverControls` from `solver-header.js` for the same footer, quick selection,
jump control and active-question tracking used by Croatian and Mathematics.
The shared result-modal
styles provide animated check, percentage, total and per-subject points, X/Escape
close and review without losing checked state. A final check covers all subjects.

Practice uses `asistent-za-mature:medicine:v1:<set-id>` in localStorage, including
answers, checked task IDs and, for a random paper, selected question IDs.
Merely opening a set does not write progress. Sets have separate saved attempts,
even where a random paper reuses collection questions. The category derives
progress from valid saved answers.
There is no account/backend or cross-device sync for medicine progress.

`nacin=simulacija` starts with empty transient answers and never reads or writes
practice storage. The shared start dialog explains the limit. Reload discards
the attempt; submission or expiry locks answers and opens results. No per-task
checking is available during simulation. The solver uses `renderSolverHeader()`
and shows all questions of the active subject in a scrolling list with quick
selection and subject tabs. Catalog questions retain their source order.

## Verification and deployment

```sh
node tests/medicine.cjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome \
  MEDICINE_ORIGIN=http://127.0.0.1:8080 node tests/medicine-browser.cjs
node --check app.js
python3 -m py_compile scripts/fetch_ncvvo.py scripts/ocr_medicine.py scripts/build_medicine.py
```

Browser tests cover category selection, catalog sequence, scrolling layout,
random selection, persistence, per-task checking, whole-paper scoring,
simulation isolation and mobile overflow. Core tests cover random selection,
all-correct/empty/all-wrong scoring, threshold
boundaries and a failing subject despite a passing overall score.

`server.js` permits `/medicina.html`, `/medicine.js`, `/medicine-core.js` and
`/medicine.css`; data/assets use existing allowed prefixes. Restart
`systemctl --user restart maturko-http.service` after server changes. Static
HTML/JS/CSS/data are read from disk. The home page's centered medicine card,
stethoscope and photograph are retained; its destination is the selection page.
