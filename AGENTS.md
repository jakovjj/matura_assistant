# Asistent za Mature

## Project context

Asistent za Mature is a Croatian website for easier preparation and, later, online live
solving of state graduation exams (`državna matura`).

The current milestone is intentionally narrow:

- provide a clean archive of downloadable exam packages
- cover exam years 2013 through 2025
- prioritize Hrvatski jezik, Engleski jezik, Matematika, Fizika, and Biologija
- do not add parsing, answer checking, accounts, or a backend yet

Keep the interface bare-bones and professional. It is visually inspired by
`ncvvo.hr`: navy header, restrained typography, document-oriented layout,
simple controls, and no decorative marketing treatment. Always keep the
`Neslužbeni projekt` label visible so the site cannot be mistaken for an
official NCVVO service.

## Current architecture

This is a dependency-free static site:

- `index.html`: page structure and Croatian copy
- `styles.css`: responsive styling
- `app.js`: client-side filters and exam table rendering
- `engleski-citanje.html`: standalone interactive English reading page
- `english-reading.html`: redirect kept for old links to English reading
- `english-reading.js`: English reading solver UI and local answer storage
- `data/exams.js`: generated archive index; do not edit manually
- `data/english-reading.js`: generated English reading index; do not edit manually
- `files/ncvvo/`: mirrored ZIP packages from the public NCVVO archive
- `files/interactive/english-reading/`: extracted PDFs for supported reading exams
- `scripts/fetch_ncvvo.py`: deterministic NCVVO archive scraper
- `scripts/build_english_reading.py`: deterministic English reading data builder
- `README.md`: local usage instructions

Serve it locally with:

```bash
python3 -m http.server 8080
```

Keep `files/ncvvo/` deployed alongside the static site. User-facing download
links in `data/exams.js` are local paths into that directory, so the live site
does not depend on NCVVO availability when serving existing packages.

## Exam archive

The canonical source is the public NCVVO archive:

`https://www.ncvvo.hr/kategorija/drzavna-matura/provedeni-ispiti/`

Refresh generated data with:

```bash
python3 scripts/fetch_ncvvo.py
```

The scraper reads NCVVO WordPress archive posts, keeps regular ZIP packages
hosted on `www.ncvvo.hr`, and mirrors them into `files/ncvvo/`. It intentionally
excludes translated variants, grading-threshold PDFs, duplicate legacy links,
and off-domain legacy files. Generated download URLs point to local mirrors;
the upstream URLs remain in generated metadata for traceability.

NCVVO older posts contain malformed nested links and inconsistent naming.
Preserve the scraper's normalization and deduplication behavior unless a
verified archive case requires a change.

## UI constraints

- Keep download buttons as the primary action.
- Preserve subject, year, term, and text-search filters.
- The desktop sidebar is sticky and must fit inside the viewport.
- The expanded subject list scrolls inside the sidebar.
- On smaller screens the sidebar becomes a normal content block without an
  internal scroll area.
- Use Croatian for user-facing copy.

## Interactive practice behavior

- Opening `Vježbaj` for an archive package must not create progress, mark the
  exam as started, or show a placeholder percentage. Progress is derived from
  saved answers in defined interactive exams.
- If an archive package has no defined interactive exam, show a clear Croatian
  message such as `Nema definiranog interaktivnog ispita za sada.` and leave the
  exam otherwise unchanged.
- If an exam is split into multiple parts, say that explicitly and let the user
  choose the part to solve. For English, show `Čitanje`, `Slušanje`, and `Esej`.
- Available parts should start the correct solver directly. For English
  `Čitanje`, link straight to the English reading solver.
- Unavailable parts should remain selectable and then show the same "not
  defined yet" message instead of starting any placeholder flow.

## Verification

After code changes, run:

```bash
node --check app.js
python3 -m py_compile scripts/fetch_ncvvo.py
```

After scraper changes, regenerate `data/exams.js` and check:

- years remain within 2013 through 2025
- there are no duplicate `year + term + subject + level` records
- priority subjects remain present for both annual terms
- displayed local download URLs respond successfully
