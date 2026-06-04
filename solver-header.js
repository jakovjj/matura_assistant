(function () {
  const termLabels = {
    "ljetni rok": "Ljetni rok",
    "jesenski rok": "Jesenski rok",
  };

  const termAliases = {
    "prvi rok": "ljetni rok",
    "drugi rok": "jesenski rok",
    "ljetni rok": "ljetni rok",
    "jesenski rok": "jesenski rok",
  };

  const subjectColors = {
    Biologija: "#2f5d50",
    Engleski: "#36517c",
    "Engleski jezik": "#36517c",
    Etika: "#5b4b63",
    Fizika: "#225b67",
    Filozofija: "#574d3f",
    Geografija: "#3f5f3b",
    "Grčki jezik": "#4d5370",
    "Hrvatski jezik": "#7a3f4a",
    Informatika: "#2e5c72",
    Kemija: "#315f69",
    "Latinski jezik": "#5b5140",
    "Likovna umjetnost": "#6a4f3d",
    Matematika: "#4f4b78",
    "Mađarski jezik": "#4e5d47",
    "Mađarski jezik i književnost": "#465a4f",
    "Politika i gospodarstvo": "#5c4a42",
    Povijest: "#6a4b3d",
    Psihologija: "#5a4968",
    Sociologija: "#4e5960",
    "Srpski jezik": "#574a70",
    "Talijanski jezik i književnost": "#4b5a5f",
    Vjeronauk: "#4f5943",
  };

  const subjectIcons = {
    Biologija: "dna",
    Engleski: "book-open-text",
    "Engleski jezik": "book-open-text",
    Etika: "scale",
    Fizika: "atom",
    Filozofija: "lightbulb",
    Geografija: "earth",
    "Grčki jezik": "omega",
    "Hrvatski jezik": "book-open-text",
    Informatika: "binary",
    Kemija: "flask-conical",
    "Latinski jezik": "amphora",
    "Likovna umjetnost": "palette",
    Matematika: "sigma",
    "Mađarski jezik": "languages",
    "Mađarski jezik i književnost": "library",
    "Politika i gospodarstvo": "landmark",
    Povijest: "history",
    Psihologija: "brain",
    Sociologija: "users-round",
    "Srpski jezik": "languages",
    "Talijanski jezik i književnost": "library",
    Vjeronauk: "church",
  };

  const partIcons = {
    "engleski|čitanje": "book-open",
    "engleski|citanje": "book-open",
    "engleski|slušanje": "music-2",
    "engleski|slusanje": "music-2",
    "engleski|esej": "book-open-text",
    "engleski jezik|čitanje": "book-open",
    "engleski jezik|citanje": "book-open",
    "engleski jezik|slušanje": "music-2",
    "engleski jezik|slusanje": "music-2",
    "engleski jezik|esej": "book-open-text",
    "hrvatski|sažetak": "book-open-text",
    "hrvatski|sazetak": "book-open-text",
    "hrvatski|školski esej": "book-open-text",
    "hrvatski|skolski esej": "book-open-text",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeKey(value) {
    return String(value ?? "").trim().toLocaleLowerCase("hr");
  }

  function formatTerm(term) {
    const normalizedTerm = termAliases[normalizeKey(term)] || normalizeKey(term);
    return termLabels[normalizedTerm] || String(term ?? "").trim();
  }

  function formatLevel(level) {
    const value = String(level ?? "").trim();
    if (/^bez\s+razine$/i.test(value)) return "";
    return value.replace(/\s*razina$/i, "").trim();
  }

  function formatExamTitle(exam = {}) {
    const source = exam || {};
    const year = String(source.year ?? "").trim();
    const titleStart = year ? `${year}.` : "";
    const detailParts = [formatTerm(source.term), formatLevel(source.level)].filter(Boolean);

    if (!detailParts.length) return titleStart;
    return `${titleStart} (${detailParts.join(", ")})`.trim();
  }

  function formatEyebrow(subject, part) {
    const subjectLabel = String(subject ?? "").trim();
    const partLabel = String(part ?? "").trim();

    if (subjectLabel && partLabel) return `${subjectLabel} - ${partLabel}`;
    return subjectLabel || partLabel;
  }

  function resolveSubjectColor(subject, subjectColor) {
    return subjectColor || subjectColors[String(subject ?? "").trim()] || "#001d4d";
  }

  function resolveIconName({ subject, part, iconName }) {
    if (iconName) return iconName;

    const subjectLabel = String(subject ?? "").trim();
    const partLabel = String(part ?? "").trim();
    const partIcon = partIcons[`${normalizeKey(subjectLabel)}|${normalizeKey(partLabel)}`];

    return partIcon || subjectIcons[subjectLabel] || "book-open";
  }

  function icon(iconName, className) {
    if (!iconName) return "";

    return `
      <svg class="${escapeHtml(className)}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <use href="./assets/lucide-icons.svg#${escapeHtml(iconName)}"></use>
      </svg>
    `;
  }

  function renderDownloads(paperUrl, archiveUrl) {
    return `
      <nav class="solver-header__downloads" aria-label="Materijali ispita">
        <a href="${escapeHtml(paperUrl)}" target="_blank" rel="noreferrer">
          Otvori službeni PDF
        </a>
        <a href="${escapeHtml(archiveUrl)}" target="_blank" rel="noreferrer">
          Preuzmi ZIP
        </a>
      </nav>
    `;
  }

  function renderIdentity({ eyebrow, title, iconName }) {
    const copy = `
      <div class="solver-header__identity-copy">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
    `;

    if (!iconName) return copy;

    return `
      <div class="solver-header__identity">
        <span class="subject-symbol solver-header__subject-symbol">
          ${icon(iconName, "subject-symbol__icon")}
        </span>
        ${copy}
      </div>
    `;
  }

  function renderSolverHeader({
    subjectColor = "",
    subject = "",
    part = "",
    exam = null,
    backHref,
    backLabel,
    paperUrl,
    archiveUrl,
    eyebrow = "",
    title = "",
    iconName = "",
    summaryHtml = "",
    navigationHtml = "",
  }) {
    const resolvedIconName = resolveIconName({ subject, part, iconName });
    const resolvedSubjectColor = resolveSubjectColor(subject, subjectColor);
    const titleOffset = resolvedIconName ? "48px" : "0px";
    const style = ` style="--subject-color: ${escapeHtml(resolvedSubjectColor)}; --solver-header-title-offset: ${titleOffset}"`;
    const resolvedEyebrow = eyebrow || formatEyebrow(subject, part);
    const resolvedTitle = title || formatExamTitle(exam);

    return `
      <header class="solver-header"${style}>
        <div class="solver-header__toolbar">
          <a class="solver-header__back" href="${escapeHtml(backHref)}">${escapeHtml(backLabel)}</a>
          ${renderDownloads(paperUrl, archiveUrl)}
        </div>

        <div class="solver-header__main">
          ${renderIdentity({
            eyebrow: resolvedEyebrow,
            title: resolvedTitle,
            iconName: resolvedIconName,
          })}
          <div class="solver-summary">
            ${summaryHtml}
          </div>
        </div>

        ${
          navigationHtml
            ? `<div class="solver-header__footer">
                ${navigationHtml}
              </div>`
            : ""
        }
      </header>
    `;
  }

  let solverFooterResizeObserver = null;
  let observedSolverFooter = null;

  function setSolverStickyFooterHeight() {
    const footer = document.querySelector(".solver-sticky-footer");
    const height = footer ? Math.ceil(footer.getBoundingClientRect().height) : 0;

    if (height > 0) {
      document.documentElement.style.setProperty("--solver-sticky-footer-height", `${height}px`);
    } else {
      document.documentElement.style.removeProperty("--solver-sticky-footer-height");
    }
  }

  function observeSolverStickyFooter() {
    const footer = document.querySelector(".solver-sticky-footer");
    setSolverStickyFooterHeight();

    if (!("ResizeObserver" in window) || footer === observedSolverFooter) return;

    if (solverFooterResizeObserver) solverFooterResizeObserver.disconnect();

    observedSolverFooter = footer;

    if (!footer) return;

    solverFooterResizeObserver = new ResizeObserver(setSolverStickyFooterHeight);
    solverFooterResizeObserver.observe(footer);
  }

  const solverFooterMutationObserver = new MutationObserver(observeSolverStickyFooter);
  solverFooterMutationObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", setSolverStickyFooterHeight);
  requestAnimationFrame(observeSolverStickyFooter);

  window.renderSolverHeader = renderSolverHeader;
  window.formatSolverExamTitle = formatExamTitle;
})();
