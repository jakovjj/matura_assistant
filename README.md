# Asistent za Mature

Bare-bones static archive for Croatian state graduation exam materials. Download
links point to ZIP packages mirrored on this server from the public NCVVO
archive.

## Refresh archive data

```bash
python3 scripts/fetch_ncvvo.py
```

The scraper uses the public NCVVO WordPress archive, keeps regular ZIP exam
packages from 2013 through 2025, downloads missing or invalid packages into
`files/ncvvo/`, and writes `data/exams.js` with local download links. Existing
valid ZIP packages are reused on later refreshes.

## Build English reading practice

```bash
python3 scripts/build_english_reading.py
```

The generator reads the mirrored English ZIP packages, extracts each reading
paper into `files/interactive/english-reading/`, extracts task text and answer
metadata, and writes `data/english-reading.js`. It requires `pdftotext` from
Poppler. Run it after refreshing the NCVVO archive index.

The interactive page is `engleski-citanje.html`. The old
`english-reading.html` URL redirects there for existing links.

## Run locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Run with @skole.hr magic-link login

The static site still works without a backend. To enable login, run the bundled
Node server instead:

```bash
node server.js
```

or:

```bash
npm start
```

By default `MAIL_TRANSPORT=log`, so login links are printed to the server log
instead of being sent. This is useful for development, but not for production.
Copy `.env.example` to `.env`, set `PUBLIC_BASE_URL` and `AUTH_SECRET`, then
choose one mail transport:

- `MAIL_TRANSPORT=sendmail` if the server has a configured sendmail-compatible
  mail transfer agent.
- `MAIL_TRANSPORT=smtp` with `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`. Run
  `npm install` first because SMTP sending uses Nodemailer.

Magic-link login only proves that the user can open mail sent to an
`@skole.hr` inbox. It is not AAI@EduHr authentication and should not be
presented as an official AAI@EduHr integration.
