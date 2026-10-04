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
    Fizika: "#225b67",
    Filozofija: "#574d3f",
    Geografija: "#3f5f3b",
    "Hrvatski jezik": "#7a3f4a",
    Informatika: "#2e5c72",
    Kemija: "#315f69",
    "Likovna umjetnost": "#6a4f3d",
    Matematika: "#4f4b78",
    Njemački: "#3e5876",
    "Njemački jezik": "#3e5876",
    "Politika i gospodarstvo": "#5c4a42",
    Povijest: "#6a4b3d",
    Psihologija: "#5a4968",
    Sociologija: "#4e5960",
  };

  const subjectIcons = {
    Biologija: "dna",
    Engleski: "language-english",
    "Engleski jezik": "language-english",
    Fizika: "atom",
    Filozofija: "lightbulb",
    Geografija: "globe-hemisphere-west",
    "Hrvatski jezik": "book-open-text",
    Informatika: "binary",
    Kemija: "flask",
    "Likovna umjetnost": "palette",
    Matematika: "sigma",
    Njemački: "language-german",
    "Njemački jezik": "language-german",
    "Politika i gospodarstvo": "bank",
    Povijest: "scroll",
    Psihologija: "brain",
    Sociologija: "users-three",
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
    "njemački|čitanje": "book-open",
    "njemacki|citanje": "book-open",
    "njemački|slušanje": "music-2",
    "njemacki|slusanje": "music-2",
    "njemački|pisanje": "book-open-text",
    "njemacki|pisanje": "book-open-text",
    "njemački jezik|čitanje": "book-open",
    "njemacki jezik|citanje": "book-open",
    "njemački jezik|slušanje": "music-2",
    "njemacki jezik|slusanje": "music-2",
    "njemački jezik|pisanje": "book-open-text",
    "njemacki jezik|pisanje": "book-open-text",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function validSourceCrop(source, crop) {
    const dimensions = [
      source?.width,
      source?.height,
      crop?.x,
      crop?.y,
      crop?.width,
      crop?.height,
    ].map(Number);
    return Boolean(
      source?.url &&
        dimensions.every((value) => Number.isFinite(value) && value >= 0) &&
        Number(source.width) > 0 &&
        Number(source.height) > 0 &&
        Number(crop.width) > 0 &&
        Number(crop.height) > 0,
    );
  }

  function renderSourceImageCrop(source, alt, options = {}) {
    const crop = source?.crop;
    if (!validSourceCrop(source, crop)) return "";

    const variant = options.variant === "pdf" ? "pdf" : "physics";
    const figureClass = `${variant}-source-figure`;
    const cropClass = `${variant}-source-crop${options.cropClass ? ` ${options.cropClass}` : ""}`;
    const displayWidth = options.constrainWidth
      ? `width: min(100%, ${Math.min(820, Math.max(260, Math.ceil(Number(crop.width))))}px); `
      : "";
    const compactStyle = options.compact ? "min-width: 0; " : "";
    const loading = options.loading === "eager" ? "eager" : "lazy";
    const width = (Number(source.width) / Number(crop.width)) * 100;
    const offsetX = (-Number(crop.x) / Number(source.width)) * 100;
    const offsetY = (-Number(crop.y) / Number(source.height)) * 100;

    return `
      <figure class="${figureClass}">
        <div
          class="${cropClass}"
          style="${displayWidth}${compactStyle}aspect-ratio: ${crop.width} / ${crop.height}"
        >
          <img
            src="${escapeHtml(source.url)}"
            alt="${escapeHtml(alt)}"
            width="${Number(source.width)}"
            height="${Number(source.height)}"
            loading="${loading}"
            decoding="async"
            style="width: ${width}%; transform: translate(${offsetX}%, ${offsetY}%);"
          >
          ${options.overlayHtml || ""}
        </div>
      </figure>
    `;
  }

  window.renderSourceImageCrop = renderSourceImageCrop;

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
    if (window.renderPhosphorIcon) return window.renderPhosphorIcon(iconName, className);

    return `
      <svg class="${escapeHtml(className)}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <use href="./assets/phosphor-icons.svg#${escapeHtml(iconName)}"></use>
      </svg>
    `;
  }

  function renderDownloads(paperUrl, archiveUrl) {
    if (!paperUrl && !archiveUrl) return "";
    return `
      <nav class="solver-header__downloads" aria-label="Materijali ispita">
        ${paperUrl ? `<a href="${escapeHtml(paperUrl)}" target="_blank" rel="noreferrer">
          Otvori službeni PDF
        </a>` : ""}
        ${archiveUrl ? `<a href="${escapeHtml(archiveUrl)}" target="_blank" rel="noreferrer">
          Preuzmi ZIP
        </a>` : ""}
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

  function renderSolverFooter({ navigationAttribute, navigationLabel, buttonClass = "primary-button", buttonContent }) {
    return `
      <footer class="solver-sticky-footer">
        <div class="solver-sticky-footer__inner">
          <nav class="task-navigation" ${navigationAttribute} aria-label="${escapeHtml(navigationLabel)}"></nav>
          <div class="solver-sticky-footer__controls">
            <div class="solver-sticky-footer__status">
              ${icon("list-checks", "solver-sticky-footer__status-icon")}
              <div class="solver-sticky-footer__status-copy" aria-live="polite">
                <strong id="footer-answer-progress" data-answer-progress></strong>
                <span id="footer-score-summary" data-score-summary></span>
              </div>
            </div>
            <div class="solver-sticky-footer__actions">
              <button class="${escapeHtml(buttonClass)}" id="check-answers" data-finish type="button">${buttonContent}</button>
            </div>
          </div>
        </div>
      </footer>`;
  }

  function renderQuickSelectShell({ navId = "question-quickselect", jumpId, jumpLabel = "Pitanje", actionHtml = "" } = {}) {
    return `<aside class="question-quickselect${jumpId || actionHtml ? " question-quickselect--with-action" : ""}" aria-label="Brzi odabir pitanja">
      <div class="question-quickselect__heading"><strong>Brzi odabir</strong><small>Pitanja</small></div>
      <nav class="question-quickselect__list" id="${escapeHtml(navId)}"></nav>
      ${jumpId || actionHtml ? `<div class="question-quickselect__tools">${jumpId ? `<label class="question-jump" for="${escapeHtml(jumpId)}"><span>${escapeHtml(jumpLabel)}</span><select id="${escapeHtml(jumpId)}" aria-label="Odaberi ${escapeHtml(jumpLabel.toLocaleLowerCase("hr"))}"></select></label>` : ""}${actionHtml}</div>` : ""}
    </aside>`;
  }

  function renderQuickSelectItems(items) {
    return items.map((item) => {
      const status = ["answered", "correct", "wrong", "excluded"].includes(item.status) ? item.status : "";
      const stateClass = status ? ` question-quickselect__link--${status}` : "";
      return `<a class="question-quickselect__link${stateClass}" href="#pitanje-${escapeHtml(item.target)}" data-quick-question="${escapeHtml(item.target)}" data-quick-group="${escapeHtml(item.group ?? item.target)}" aria-label="${escapeHtml(item.itemLabel || "Pitanje")} ${escapeHtml(item.label)}, ${escapeHtml(item.answerState)}">${escapeHtml(item.label)}</a>`;
    }).join("");
  }

  function renderQuickSelectOptions(items) {
    return items.map((item) => `<option value="${escapeHtml(item.target)}" data-quick-group="${escapeHtml(item.group ?? item.target)}">${escapeHtml(item.label)}</option>`).join("");
  }

  function bindQuickSelect({ root = document, navId = "question-quickselect", jumpId, onJump }) {
    const jumpTo = (question) => {
      const target = root.querySelector(`#pitanje-${question}`);
      if (!target) return;
      onJump(question);
      target.scrollIntoView({ block: "start", behavior: "auto" });
      history.replaceState(null, "", `#pitanje-${question}`);
    };
    const nav = root.querySelector(`#${navId}`);
    if (nav && !nav.dataset.quickSelectBound) {
      nav.dataset.quickSelectBound = "true";
      nav.addEventListener("click", (event) => {
        const link = event.target.closest("[data-quick-question]");
        if (!link || !nav.contains(link)) return;
        event.preventDefault();
        jumpTo(link.dataset.quickQuestion);
      });
    }
    const jump = jumpId && root.querySelector(`#${jumpId}`);
    if (jump && !jump.dataset.quickSelectBound) {
      jump.dataset.quickSelectBound = "true";
      jump.addEventListener("change", () => jumpTo(jump.value));
    }
  }

  function updateQuickSelectActiveState({ root = document, navId = "question-quickselect", jumpId, activeGroup }) {
    root.querySelectorAll(`#${navId} [data-quick-question]`).forEach((link) => {
      const active = String(link.dataset.quickGroup) === String(activeGroup);
      link.classList.toggle("question-quickselect__link--active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    const jump = jumpId && root.querySelector(`#${jumpId}`);
    const option = jump && [...jump.options].find((entry) => String(entry.dataset.quickGroup || entry.value) === String(activeGroup));
    if (option) jump.value = option.value;
  }

  function activeQuestionFromScroll(selector, attribute = "questionNumber", root = document) {
    const questions = [...root.querySelectorAll(selector)];
    if (!questions.length) return null;
    const focusLine = Math.min(window.innerHeight * 0.28, 240);
    let active = questions[0];
    for (const question of questions) {
      if (question.getBoundingClientRect().top > focusLine) break;
      active = question;
    }
    return active.dataset[attribute];
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
  window.SolverControls = { renderFooter: renderSolverFooter, renderQuickSelectShell, renderQuickSelectItems, renderQuickSelectOptions, bindQuickSelect, updateQuickSelectActiveState, activeQuestionFromScroll };
  window.formatSolverExamTitle = formatExamTitle;
})();
