(function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
      <div>
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
    backHref,
    backLabel,
    paperUrl,
    archiveUrl,
    eyebrow,
    title,
    iconName = "",
    summaryHtml = "",
  }) {
    const style = subjectColor ? ` style="--subject-color: ${escapeHtml(subjectColor)}"` : "";

    return `
      <header class="solver-header"${style}>
        <div class="solver-header__toolbar">
          <a class="solver-header__back" href="${escapeHtml(backHref)}">${escapeHtml(backLabel)}</a>
          ${renderDownloads(paperUrl, archiveUrl)}
        </div>

        <div class="solver-header__main">
          ${renderIdentity({ eyebrow, title, iconName })}
          <div class="solver-summary">
            ${summaryHtml}
          </div>
        </div>
      </header>
    `;
  }

  window.renderSolverHeader = renderSolverHeader;
})();
