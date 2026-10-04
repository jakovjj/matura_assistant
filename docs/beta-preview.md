# Exam list beta

Preview: https://matura.com.hr/assets/beta/index.html

The existing server already serves `/assets/`, including HTML. This preview
requires no DNS changes, allowlist changes, service restart, or links from the
main site. Every beta HTML page uses `noindex, nofollow`. The beta is publicly
accessible to anyone with the URL; it is not access protected.

## Scope and isolation

- `assets/beta/app.js` and `styles.css` are snapshots of the working frontend
  on 2026-09-12, not generated exam data. The beta app has query-based routing,
  beta solver links, and calls into `beta-view.js` for the subject exam list.
- `beta-view.js` contains the new inline parts, subject thresholds, and metadata disclosure.
- `beta.css` styles only the beta presentation.
- Solver HTML copies load the existing solver scripts and official datasets.
  `navigation.js` returns users to their beta subject and exam anchor.
- Profile/login pages remain the existing pages. Beta practice uses the same
  browser/profile progress as normal practice. This is a presentation preview,
  not a separate account or storage environment. Simulations retain their
  existing transient-answer behavior.
- No production HTML, JS, CSS, server configuration, generated indexes, or
  sitemaps were changed for this preview.

## Information retained

All defined parts, durations, practice/simulation actions, writing previews,
ZIP downloads, subject catalogs, grade thresholds and Croatian threshold notes
remain available. Each exam includes the exact existing official statistics
block when present: average, candidate count, grade distribution, and NCVVO
report link. Grade thresholds appear once beneath the year links in the subject sidebar,
including the Croatian threshold note; on mobile they expand on demand.
Exam-specific statistics still expand within each exam. Simulation explanations and the existing start dialog are retained.
Saved progress remains exam-wide and is labelled as such; existing best
simulation results appear beside their respective parts. Untouched progress is
shown as a dash. Unavailable parts explain their status when selected, while
ZIP downloads remain available.

Filters and the displayed exam count have been removed. Years remain jump
links, and all exams are shown; stale filter parameters are cleared from old
beta bookmarks. Returning from a solver restores the exact exam position.
A legacy beta `?ispit=` link resolves to that exam in its subject list.

## Verification

Run the browser check against a local server (default port 8080):

```bash
node tests/beta-preview.cjs
```

Requires Playwright and Chromium. If they are installed outside the repository,
set `PLAYWRIGHT_MODULE` to the module path and optionally `CHROMIUM_PATH` to the
browser executable. Set `BETA_ORIGIN=https://matura.com.hr` to check the deployed
preview. The test uses a fresh browser context and stores screenshots in `/tmp`.

Coverage includes removal of controls and stale filter behavior, shared subject
thresholds (verified equal across each subject), direct practice, return
navigation, simulation confirmation, mobile sidebar access, and exam metadata
and part preservation over all subject datasets. The first deployed check covered 448 exams, 638 parts,
and 82 official statistics blocks.

For further beta edits, bump query versions in beta HTML so the server's
one-day `/assets/` cache does not hide updates. Do not overwrite the snapshots
from production without reapplying the beta routing changes. After design
approval, integrate the presentation deliberately into the main app rather
than copying the entire snapshot over newer production work.
