const data = window.ASISTENT_ZA_MATURE_ENGLISH_READING;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks čitanja iz engleskoga jezika.");
}

const app = document.querySelector("#reading-app");
const englishSubjectUrl = "./?predmet=Engleski%20jezik";

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

const legacyTermAliases = {
  "ljetni rok": ["prvi rok"],
  "jesenski rok": ["drugi rok"],
};

const pickerState = {
  level: "",
  year: "",
};

let solverExam;
let responses = {};
let activeTaskTypeId;
let activeQuestionNumber;
let checked = false;
const simulation = window.createExamSimulation({ onFinish: finishSimulation });
const selfCheck = window.createTaskSelfCheck();

// Na uskim ekranima overlay-praznine nad cijelom slikom teksta postanu nečitljive,
// pa nadopunjavanje renderiramo kao kartice po praznini (fokusirani crop + odgovor).
const mobileCompletionQuery =
  typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 760px)") : null;

function isMobileCompletionLayout() {
  return Boolean(mobileCompletionQuery?.matches);
}

mobileCompletionQuery?.addEventListener("change", () => {
  if (document.querySelector("#task-content-panel")) renderTaskTypeContent();
});

const taskTypeDefinitions = {
  choice: {
    id: "visestruki-izbor",
    label: "Višestruki izbor",
  },
  completion: {
    id: "nadopunjavanje",
    label: "Nadopunjavanje",
  },
};

function isChecked(question) {
  return checked || selfCheck.has(question);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function checkButtonLabel() {
  if (simulation.active && !simulation.finished) return "Predaj simulaciju";
  return checked ? "Sakrij rješenja" : "Provjeri odgovore";
}

function checkButtonIcon() {
  return checked && !(simulation.active && !simulation.finished) ? "eye-off" : "circle-check";
}

function checkButtonClass() {
  return checked && !(simulation.active && !simulation.finished)
    ? "primary-button primary-button--muted"
    : "primary-button";
}

function icon(iconName, className) {
  if (window.renderLucideIcon) return window.renderLucideIcon(iconName, className);

  return `
    <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg#${iconName}"></use>
    </svg>
  `;
}

function renderCheckButtonContent() {
  return `
    ${icon(checkButtonIcon(), "solver-sticky-footer__action-icon")}
    ${checkButtonLabel()}
  `;
}

function normalizeSearch(value) {
  return String(value)
    .toLocaleLowerCase("hr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("đ", "d");
}

function slugPart(value) {
  return normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTerm(term) {
  return termAliases[term] || term;
}

function formatTerm(term) {
  return termLabels[normalizeTerm(term)] || term;
}

function readingExamIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function readingStorageKeyForId(id) {
  return `asistent-za-mature:english-reading:${id}`;
}

function readingStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) => readingExamIdForTerm(exam, term)),
  ];

  return [...new Set(ids)].map(readingStorageKeyForId);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(readingExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: readingExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function highlightInline(value) {
  return escapeHtml(value)
    .replace(/\((\d+)\)\s*_{2,}/g, '<mark class="source-gap">($1) ____</mark>')
    .replace(/\b0→([A-Z])\b/g, '<mark class="source-example">0→$1</mark>');
}

function stripTaskHeading(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !/^\s*Task\s+\d+\s*$/.test(line))
    .filter((line) => !/^\s*Questions\s+\d+\s*[-–]\s*\d+\s*$/.test(line))
    .join("\n")
    .trim();
}

function blockLines(block) {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function blockText(block) {
  return blockLines(block).join(" ").replace(/\s+/g, " ");
}

function parseLeadingItems(block, pattern) {
  const items = [];

  for (const line of blockLines(block)) {
    const match = line.match(pattern);
    if (match) {
      items.push({ label: match[1], text: match[2].trim() });
    } else if (items.length) {
      items[items.length - 1].text = `${items[items.length - 1].text} ${line}`.trim();
    } else if (line) {
      return [];
    }
  }

  return items;
}

function renderSourceList(items, className) {
  return `
    <div class="${className}">
      ${items
        .map(
          (item) => `
            <div class="${className}__item">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${highlightInline(item.text)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSourceBlock(block, index) {
  const text = blockText(block);
  const optionItems = parseLeadingItems(block, /^([A-Z])\s+(.*)$/);
  const questionItems = parseLeadingItems(block, /^(\d{1,2})\s+(.*)$/);

  if (optionItems.length >= 2) {
    return renderSourceList(optionItems, "source-options");
  }

  if (questionItems.length >= 1) {
    return renderSourceList(questionItems, "source-questions");
  }

  if (/^(?:Which person|Which|What|Who|Where|Why|How)\b/i.test(text)) {
    return `<h5 class="source-subheading">${highlightInline(text)}</h5>`;
  }

  if (
    index < 2 ||
    /(?:For each question|Mark your answer|There is an example|Read the text|Read about|Complete the text|choose|Match each|Write your answer)/i.test(
      text,
    )
  ) {
    return `<div class="source-instructions">${highlightInline(text)}</div>`;
  }

  if (
    text.length <= 90 &&
    !/[.!?]$/.test(text) &&
    !/^(?:A|B|C|D|E|F|G|H|I|J|K|L|M|N)\b/.test(text)
  ) {
    return `<h4 class="source-title">${highlightInline(text)}</h4>`;
  }

  if (/^[A-Z]\s+[\p{Lu}0-9]/u.test(text) && text.length <= 80) {
    const [label, ...rest] = text.split(/\s+/);
    return `
      <h5 class="source-section-label">
        <span>${escapeHtml(label)}</span>
        ${highlightInline(rest.join(" "))}
      </h5>
    `;
  }

  return `<p>${highlightInline(text)}</p>`;
}

function renderTaskSource(text) {
  const blocks = stripTaskHeading(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map(renderSourceBlock).join("");
}

function validSourceImage(source) {
  const crop = source?.crop;
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
      source.width &&
      source.height &&
      crop.width &&
      crop.height,
  );
}

function renderCroppedImage(source, alt, options = {}) {
  if (!validSourceImage(source)) return "";
  return window.renderSourceImageCrop(source, alt, {
    ...options,
    variant: "pdf",
  });
}

function renderTaskSourceImages(task) {
  const sourceImages = Array.isArray(task.sourceImages)
    ? task.sourceImages.filter(validSourceImage)
    : [];
  if (!sourceImages.length) return "";

  return `
    <div class="pdf-source-list">
      ${sourceImages
        .map((source) => {
          const pageLabel = Number.isInteger(Number(source.page))
            ? `, stranica ${source.page}`
            : "";
          return renderCroppedImage(
            source,
            `Izvorni prikaz zadatka ${task.number} iz službene PDF knjižice${pageLabel}.`,
          );
        })
        .join("")}
    </div>
  `;
}

function renderTaskSourceContent(task) {
  if (hasInlineGapBlanks(task)) {
    if (isMobileCompletionLayout()) {
      // Provjera je per-redak (Provjeri gumb u svakoj kartici). Grupni kontroler
      // zadržavamo samo kao "Otvori ključ" fallback za zadatke bez auto-provjere.
      const fallback = checkableTaskGroupQuestions(task).length
        ? ""
        : renderInlineGapCheckControls(task);
      return `
        ${renderInlineGapCards(task)}
        ${fallback}
      `;
    }
    return `
      ${renderInlineGapSourceImages(task)}
      ${renderInlineGapCheckControls(task)}
    `;
  }

  const questionImageContent = renderQuestionImageTaskContent(task);
  if (questionImageContent) return questionImageContent;

  const sourceImages = renderTaskSourceImages(task);
  const sourceContent =
    sourceImages ||
    `<div class="task-source english-reading-source">
      ${renderTaskSource(task.text)}
    </div>`;

  return `
    ${sourceContent}
    ${renderTaskResponses(task)}
  `;
}

function hasInlineGapBlanks(task) {
  if (!["choice", "text"].includes(task?.kind) || !task?.blanks) return false;
  const sourceImages = Array.isArray(task.sourceImages) ? task.sourceImages : [];
  return taskQuestions(task).every((question) =>
    validInlineBlank(task.blanks[String(question)], sourceImages),
  );
}

function validInlineBlank(blank, sourceImages) {
  const source = sourceImages?.[blank?.sourceImageIndex];
  const crop = source?.crop;
  const values = [
    blank?.sourceImageIndex,
    blank?.x,
    blank?.y,
    blank?.width,
    blank?.height,
    crop?.width,
    crop?.height,
  ].map(Number);

  return Boolean(
    validSourceImage(source) &&
      values.every((value) => Number.isFinite(value)) &&
      Number(blank.width) > 0 &&
      Number(blank.height) > 0 &&
      Number(blank.x) >= 0 &&
      Number(blank.y) >= 0 &&
      Number(blank.x) < Number(crop.width) &&
      Number(blank.y) < Number(crop.height),
  );
}

function renderInlineGapSourceImages(task) {
  const sourceImages = inlineGapSourceImages(task);

  return `
    <section class="pdf-source-list english-inline-gap-context" aria-label="Tekst s prazninama">
      ${sourceImages
        .map(({ source, index }) =>
          renderCroppedImage(
            source,
            `Tekst s prazninama za zadatak ${task.number}, službeni prikaz ${index + 1}.`,
            {
              cropClass: "english-inline-gap-crop",
              overlayHtml: renderInlineGapControls(task, index),
            },
          ),
        )
        .join("")}
    </section>
  `;
}

function inlineGapSourceImages(task) {
  const sourceImages = task.sourceImages || [];
  const entries = sourceImages.map((source, index) => ({ source, index }));
  if (task.kind !== "choice") return entries;

  const blankSourceIndexes = taskQuestions(task)
    .map((question) => task.blanks[String(question)]?.sourceImageIndex)
    .filter((index) => Number.isInteger(index));
  if (!blankSourceIndexes.length) return entries;

  const lastBlankSourceIndex = Math.max(...blankSourceIndexes);
  return entries.filter(({ index }) => index <= lastBlankSourceIndex);
}

function usesSharedInlineChoiceBank(task) {
  if (task?.kind !== "choice" || !task?.blanks || !Array.isArray(task.options)) return false;
  const hasUnusedOptionInstruction = /\byou do not need\b/i.test(task.text || "");
  return hasUnusedOptionInstruction || task.options.length > taskQuestions(task).length;
}

// ---- Mobilni prikaz nadopunjavanja (vidi isMobileCompletionLayout) ----
// Prikazuje se cijeli službeni tekst, rezan isključivo na granicama redaka.
// Nakon retka s prazninom(ama) idu kontrole; dvije praznine u istom retku → jedan ispod drugog.

function renderInlineGapCards(task) {
  const shared = usesSharedInlineChoiceBank(task);
  const sections = inlineGapSourceImages(task)
    .map(({ source, index }) => renderEnglishImageRows(task, source, index, shared))
    .join("");

  return `
    <section class="english-completion-cards" aria-label="Tekst s prazninama za nadopunjavanje" data-card-task="${escapeHtml(task.number)}">
      ${sections}
    </section>
  `;
}

function renderEnglishImageRows(task, source, imageIndex, shared) {
  const crop = source?.crop;
  if (!crop) return "";

  const blanks = taskQuestions(task)
    .map(String)
    .filter((question) => task.blanks[question]?.sourceImageIndex === imageIndex)
    .map((question) => ({ question, blank: task.blanks[question] }))
    .sort(
      (a, b) => Number(a.blank.y) - Number(b.blank.y) || Number(a.blank.x) - Number(b.blank.x),
    );

  if (!blanks.length) {
    return renderEnglishTextSegment(source, 0, Number(crop.height), []);
  }

  const rows = englishGroupRows(blanks);
  const pad = 8;
  let html = "";
  let segTop = 0;

  rows.forEach((row) => {
    const segBottom = Math.min(Number(crop.height), row.bottom + pad);
    html += `
      <article class="english-completion-card">
        ${renderEnglishTextSegment(source, segTop, segBottom, row.blanks)}
        ${row.blanks.map((item) => renderEnglishRowControl(task, item.question, shared)).join("")}
      </article>
    `;
    segTop = segBottom;
  });

  if (segTop < Number(crop.height) - 2) {
    html += renderEnglishTextSegment(source, segTop, Number(crop.height), []);
  }

  return html;
}

function englishGroupRows(blanks) {
  const rows = [];
  blanks.forEach((item) => {
    const y = Number(item.blank.y);
    const height = Number(item.blank.height);
    const last = rows[rows.length - 1];
    if (last && y < last.y + height * 0.7) {
      last.blanks.push(item);
      last.bottom = Math.max(last.bottom, y + height);
    } else {
      rows.push({ y, bottom: y + height, blanks: [item] });
    }
  });
  rows.forEach((row) => row.blanks.sort((a, b) => Number(a.blank.x) - Number(b.blank.x)));
  return rows;
}

function renderEnglishTextSegment(source, segTop, segBottom, blanks) {
  const crop = source?.crop;
  const height = segBottom - segTop;
  if (!crop || !(height > 0)) return "";

  const segSource = {
    url: source.url,
    width: source.width,
    height: source.height,
    crop: { x: crop.x, y: Number(crop.y) + segTop, width: crop.width, height },
  };

  const markers = blanks
    .map(({ blank }) => {
      const style = [
        `left: ${(Number(blank.x) / Number(crop.width)) * 100}%`,
        `top: ${((Number(blank.y) - segTop) / height) * 100}%`,
        `width: ${(Number(blank.width) / Number(crop.width)) * 100}%`,
        `height: ${(Number(blank.height) / height) * 100}%`,
      ].join("; ");
      return `<span class="english-completion-band__marker" style="${style}" aria-hidden="true"></span>`;
    })
    .join("");

  return `
    <div class="english-completion-band">
      ${renderCroppedImage(segSource, "Tekst s prazninama, službeni prikaz.", {
        cropClass: "english-completion-band__crop",
        overlayHtml: markers,
      })}
    </div>
  `;
}

function renderEnglishRowControl(task, question, shared) {
  const answer = responses[question] || "";
  const resolved = isChecked(question) && correctAnswers(question).length > 0;
  let stateClass = answer ? " english-completion-row--answered" : "";
  if (resolved && answer) {
    stateClass += isCorrectAnswer(question, answer)
      ? " english-completion-row--correct"
      : " english-completion-row--wrong";
  }

  return `
    <div class="english-completion-row${stateClass}" id="odgovor-${escapeHtml(question)}" data-question-number="${escapeHtml(question)}" data-card-task="${escapeHtml(task.number)}">
      <div class="english-completion-row__head">
        <span class="english-completion-card__number">Praznina ${escapeHtml(question)}</span>
        ${renderEnglishCardStatus(question, answer, resolved)}
      </div>
      ${renderEnglishCardControl(task, question, answer, shared)}
      ${correctAnswers(question).length
        ? `<div class="solver-inline-actions">${selfCheck.renderButton(question, {
            hidden: simulation.active || checked,
          })}</div>`
        : ""}
      ${renderEnglishCardFeedback(question, answer, resolved)}
    </div>
  `;
}

function renderEnglishCardStatus(question, answer, resolved) {
  if (resolved && answer) {
    return isCorrectAnswer(question, answer)
      ? `<span class="english-completion-card__status english-completion-card__status--correct">Točno</span>`
      : `<span class="english-completion-card__status english-completion-card__status--wrong">Netočno</span>`;
  }
  return answer
    ? `<span class="english-completion-card__status">Odgovoreno</span>`
    : `<span class="english-completion-card__status english-completion-card__status--empty">Bez odgovora</span>`;
}

function renderEnglishCardControl(task, question, answer, shared) {
  if (task.kind === "text") {
    return `
      <input
        class="english-completion-card__input"
        id="card-input-${escapeHtml(question)}"
        data-question="${escapeHtml(question)}"
        type="text"
        value="${escapeHtml(answer)}"
        autocomplete="off"
        aria-label="Odgovor na prazninu ${escapeHtml(question)}"
        ${simulation.inputDisabledAttribute()}
      >
    `;
  }

  const optionMap = inlineChoiceOptionTextMap(task, question);
  const options = Array.isArray(task.options) && task.options.length
    ? task.options
    : ["A", "B", "C", "D"];
  const usedOptions = shared ? inlineChoiceUsedOptions(task, question) : new Map();
  const resolved = isChecked(question) && correctAnswers(question).length > 0;

  return `
    <div class="english-completion-card__options" role="${shared ? "group" : "radiogroup"}" aria-label="Ponuđeni odgovori za prazninu ${escapeHtml(question)}">
      ${options
        .map((option) =>
          renderEnglishCardOption(question, option, optionMap[option], answer, resolved, usedOptions),
        )
        .join("")}
    </div>
  `;
}

function renderEnglishCardOption(question, option, text, answer, resolved, usedOptions) {
  const selected = option === answer;
  const correct = isCorrectAnswer(question, option);
  let resultClass = "";
  if (resolved && correct) resultClass = " english-completion-card__option--correct";
  if (resolved && selected && !correct) resultClass = " english-completion-card__option--wrong";
  const selectedClass = selected ? " english-completion-card__option--selected" : "";
  const usedBy = usedOptions.get(option) || [];
  const usedClass = usedBy.length && !selected ? " english-completion-card__option--used" : "";
  const usedNote = usedBy.length
    ? `<small class="english-completion-card__option-note">u ${escapeHtml(usedBy.join(", "))}</small>`
    : "";

  return `
    <button
      type="button"
      class="english-completion-card__option${selectedClass}${resultClass}${usedClass}"
      aria-pressed="${selected}"
      data-english-card-question="${escapeHtml(question)}"
      data-english-card-option="${escapeHtml(option)}"
      ${simulation.inputDisabledAttribute()}
    >
      <span class="english-completion-card__option-letter">${escapeHtml(option)}</span>
      <span class="english-completion-card__option-text">${escapeHtml(text || `Odgovor ${option}`)}</span>
      ${usedNote}
    </button>
  `;
}

function renderEnglishCardFeedback(question, answer, resolved) {
  if (!resolved) return "";
  const answers = correctAnswers(question);
  if (isCorrectAnswer(question, answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${escapeHtml(answers.join(" ili "))}.</small>`;
}

function bindEnglishCompletionCards() {
  document.querySelectorAll("[data-english-card-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const question = button.dataset.englishCardQuestion;
      const next = responses[question] === button.dataset.englishCardOption
        ? ""
        : button.dataset.englishCardOption;
      updateResponse(question, next);
    });
  });
}

// Ažurira mobilne retke nakon promjene odgovora bez punog re-rendera.
// Prolazi kroz sve retke jer "iskorišteno" u dijeljenom banku ovisi o svim odgovorima.
function syncEnglishCompletionCards() {
  const rows = document.querySelectorAll(".english-completion-row[data-card-task]");
  if (!rows.length) return;

  rows.forEach((row) => {
    const question = row.dataset.questionNumber;
    const taskNumber = Number(row.dataset.cardTask);
    const task = solverExam.tasks.find((candidate) => candidate.number === taskNumber);
    const answer = responses[question] || "";
    const shared = task ? usesSharedInlineChoiceBank(task) : false;

    row.classList.toggle("english-completion-row--answered", Boolean(answer));

    const head = row.querySelector(".english-completion-row__head");
    if (head) {
      head.innerHTML = `
        <span class="english-completion-card__number">Praznina ${escapeHtml(question)}</span>
        ${renderEnglishCardStatus(question, answer, false)}
      `;
    }

    const usedOptions = shared && task ? inlineChoiceUsedOptions(task, question) : new Map();
    row.querySelectorAll("[data-english-card-option]").forEach((button) => {
      const option = button.dataset.englishCardOption;
      const selected = option === answer;
      button.classList.toggle("english-completion-card__option--selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      const usedBy = usedOptions.get(option) || [];
      button.classList.toggle(
        "english-completion-card__option--used",
        Boolean(usedBy.length) && !selected,
      );
    });
  });
}

function renderInlineGapControls(task, sourceImageIndex) {
  const source = task.sourceImages[sourceImageIndex];
  return taskQuestions(task)
    .filter((question) => task.blanks[String(question)]?.sourceImageIndex === sourceImageIndex)
    .map((question) => renderInlineGapControl(task, String(question), source))
    .join("");
}

function renderInlineGapControl(task, question, source) {
  if (task.kind === "choice") return renderInlineChoiceBlank(task, question, source);
  return renderInlineTextInput(task, question, source);
}

function renderInlineTextInput(task, question, source) {
  const answer = responses[question] || "";
  const stateClass = inlineTextBlankStateClass(question, answer);

  return `
    <input
      class="english-text-blank${stateClass}"
      id="odgovor-${escapeHtml(question)}"
      data-question="${escapeHtml(question)}"
      type="text"
      value="${escapeHtml(answer)}"
      autocomplete="off"
      aria-label="Odgovor na pitanje ${escapeHtml(question)}"
      style="${inlineTextBlankStyle(task.blanks[question], source)}"
      ${simulation.inputDisabledAttribute()}
    >
  `;
}

function renderInlineChoiceBlank(task, question, source) {
  const answer = responses[question] || "";
  const stateClass = inlineChoiceBlankStateClass(question, answer);

  return `
    <button
      class="english-choice-blank${stateClass}"
      id="odgovor-${escapeHtml(question)}"
      type="button"
      data-question="${escapeHtml(question)}"
      data-inline-choice-question="${escapeHtml(question)}"
      data-inline-choice-task="${escapeHtml(task.number)}"
      value="${escapeHtml(answer)}"
      aria-haspopup="dialog"
      aria-expanded="false"
      aria-label="${escapeHtml(inlineChoiceBlankAriaLabel(question, answer))}"
      style="${inlineChoiceBlankStyle(task.blanks[question], source)}"
      ${simulation.inputDisabledAttribute()}
    >
      ${renderInlineChoiceBlankContent(answer)}
    </button>
  `;
}

function inlineTextBlankStateClass(question, answer) {
  const answeredClass = answer ? " english-text-blank--answered" : "";
  if (!isChecked(question) || !correctAnswers(question).length) return answeredClass;
  return `${answeredClass}${
    isCorrectAnswer(question, answer)
      ? " english-text-blank--correct"
      : " english-text-blank--wrong"
  }`;
}

function inlineChoiceBlankStateClass(question, answer) {
  const answeredClass = answer ? " english-choice-blank--answered" : "";
  if (!isChecked(question) || !correctAnswers(question).length) return answeredClass;
  return `${answeredClass}${
    isCorrectAnswer(question, answer)
      ? " english-choice-blank--correct"
      : " english-choice-blank--wrong"
  }`;
}

function renderInlineChoiceBlankContent(answer) {
  return `
    <span>${escapeHtml(answer)}</span>
    <span class="english-choice-blank__chevron" aria-hidden="true"></span>
  `;
}

function inlineChoiceBlankAriaLabel(question, answer) {
  if (answer) return `Praznina ${question}, odabrano ${answer}. Promijeni odgovor.`;
  return `Praznina ${question}, nije odgovoreno.`;
}

function inlineTextBlankStyle(blank, source) {
  return inlineGapBlankStyle(blank, source, {
    extraHeight: 9,
    extraWidth: 24,
    minHeight: 24,
    minWidth: 72,
  });
}

function inlineChoiceBlankStyle(blank, source) {
  return inlineGapBlankStyle(blank, source, {
    extraHeight: 3,
    extraWidth: 4,
    minHeight: 22,
    minWidth: 44,
  });
}

function inlineGapBlankStyle(blank, source, options) {
  const crop = source.crop;
  const fieldHeight = Math.max(options.minHeight, Number(blank.height) + options.extraHeight);
  const preferredWidth = Math.max(options.minWidth, Number(blank.width) + options.extraWidth);
  const centerX = Number(blank.x) + Number(blank.width) / 2;
  const centerY = Number(blank.y) + Number(blank.height) / 2;
  const left = Math.max(0, Math.min(crop.width - preferredWidth, centerX - preferredWidth / 2));
  const top = Math.max(0, Math.min(crop.height - fieldHeight, centerY - fieldHeight / 2));
  const width = Math.min(crop.width - left, preferredWidth);
  const height = Math.min(crop.height - top, fieldHeight);

  return [
    `left: ${(left / crop.width) * 100}%`,
    `top: ${(top / crop.height) * 100}%`,
    `width: ${(width / crop.width) * 100}%`,
    `height: ${(height / crop.height) * 100}%`,
  ].join("; ");
}

function renderInlineGapCheckControls(task) {
  if (simulation.active) return "";
  const checkableQuestions = checkableTaskGroupQuestions(task);
  if (checkableQuestions.length) return renderInlineTextGapCheckControls(task, checkableQuestions);

  const keyLink = renderTaskAnswerKeyLink(task);
  if (keyLink) {
    return `
      <section class="english-inline-check-list english-inline-check-list--group" aria-label="Provjera zadatka">
        ${keyLink}
      </section>
    `;
  }

  return "";
}

function renderInlineTextGapCheckControls(task, questions) {
  const answeredQuestions = answeredTaskGroupQuestions(questions);
  const active =
    answeredQuestions.length > 0 &&
    answeredQuestions.every((question) => selfCheck.has(question));
  const answered = answeredQuestions.length > 0;
  const resultHtml = renderInlineTextGapResults(questions);

  return `
    <section class="english-inline-check-list english-inline-check-list--group" aria-label="Provjera zadatka">
      ${
        checked
          ? ""
          : `
            <button
              class="inline-check-button english-inline-group-check-button${active ? " inline-check-button--active" : ""}"
              type="button"
              data-inline-gap-group-check="${escapeHtml(task.number)}"
              aria-pressed="${active ? "true" : "false"}"
              ${answered ? "" : "disabled"}
            >
              ${icon(active ? "eye-off" : "circle-check", "inline-check-button__icon")}
              <span>${active ? "Sakrij rješenja" : "Provjeri"}</span>
            </button>
          `
      }
      ${resultHtml}
    </section>
  `;
}

function checkableTaskGroupQuestions(task) {
  if (!usesTaskGroupSelfCheck(task)) return [];
  return taskQuestions(task)
    .map(String)
    .filter((question) => correctAnswers(question).length);
}

function usesTaskGroupSelfCheck(task) {
  return task?.kind === "text" || hasInlineGapBlanks(task);
}

function answeredTaskGroupQuestions(questions) {
  return questions.filter((question) => String(responses[String(question)] || "").trim());
}

function renderInlineTextGapResults(questions) {
  const visibleQuestions = checked
    ? questions
    : questions.filter(
        (question) =>
          selfCheck.has(question) && String(responses[String(question)] || "").trim(),
      );
  if (!visibleQuestions.length) return "";

  return `
    <div class="english-inline-group-results">
      ${visibleQuestions
        .map((question) => {
          const answer = responses[question] || "";
          const resultClass = isCorrectAnswer(question, answer)
            ? " english-inline-group-result--correct"
            : " english-inline-group-result--wrong";

          return `
            <div class="english-inline-group-result${resultClass}">
              <strong>${escapeHtml(question)}.</strong>
              ${renderFeedback(question, answer)}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTaskAnswerKeyLink(task) {
  if (simulation.active || checked || !solverExam?.keyUrl) return "";
  return `
    <a
      class="inline-check-button english-inline-group-check-button"
      href="${escapeHtml(solverExam.keyUrl)}"
      target="_blank"
      rel="noreferrer"
      aria-label="Otvori službeni ključ za zadatak ${escapeHtml(task.number)}"
    >
      ${icon("book-open", "inline-check-button__icon")}
      <span>Otvori ključ</span>
    </a>
  `;
}

function taskOptionTextMap(task) {
  const groups = taskOptionTextGroups(task);
  const lastGroup = groups[groups.length - 1];
  return lastGroup ? optionGroupTextMap(lastGroup) : {};
}

function taskOptionTextGroups(task) {
  if (!task.options?.length) return [];

  const optionSet = new Set(task.options || []);
  const optionPattern = new RegExp(
    `^\\s*([${escapeRegExp((task.options || []).join(""))}])(?:[.)])?\\s+(.+)$`,
  );
  const anyOptionPattern = /^\s*([A-Z])(?:[.)])?\s+(.+)$/;
  const exampleOptions = new Set(
    [...String(task.text || "").matchAll(/\b0\s*→\s*([A-Z])\b/g)].map((match) => match[1]),
  );
  const firstOption = task.options?.[0];
  const groups = [];
  let currentGroup = [];
  let current = null;
  let parsing = false;

  for (const line of stripTaskHeading(task.text).split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(optionPattern);
    if (match && optionSet.has(match[1])) {
      if (
        currentGroup.length &&
        (match[1] === firstOption || currentGroup.some((option) => option.label === match[1]))
      ) {
        groups.push(currentGroup);
        currentGroup = [];
      }

      current = {
        label: match[1],
        text: match[2].trim(),
      };
      currentGroup.push(current);
      parsing = true;
      continue;
    }

    if (!parsing || !current || !trimmed) continue;
    const externalOptionMatch = trimmed.match(anyOptionPattern);
    if (
      externalOptionMatch &&
      !optionSet.has(externalOptionMatch[1]) &&
      exampleOptions.has(externalOptionMatch[1])
    ) {
      current = null;
      parsing = false;
      continue;
    }
    if (/^\d{1,2}\b/.test(trimmed) || /^Task\s+\d+/i.test(trimmed)) {
      current = null;
      parsing = false;
      continue;
    }
    current.text = `${current.text} ${trimmed}`.trim();
  }

  if (currentGroup.length) groups.push(currentGroup);
  return groups.filter((group) => group.length >= 2);
}

function optionGroupTextMap(group) {
  return group.reduce((map, option) => {
    map[option.label] = option.text;
    return map;
  }, {});
}

function inlineChoiceOptionTextMap(task, questionNumber) {
  const groups = taskOptionTextGroups(task);
  if (groups.length <= 1 || usesSharedInlineChoiceBank(task)) {
    return taskOptionTextMap(task);
  }

  const questions = taskQuestions(task).map(String);
  const questionIndex = questions.indexOf(String(questionNumber));
  if (questionIndex === -1) return taskOptionTextMap(task);

  const hasLeadingExampleGroup =
    groups.length > questions.length && /\bexample\b/i.test(task.text || "");
  const groupIndex = hasLeadingExampleGroup ? questionIndex + 1 : questionIndex;
  const group = groups[groupIndex];
  return group ? optionGroupTextMap(group) : taskOptionTextMap(task);
}

function openInlineChoicePopover(questionNumber, anchor) {
  if (simulation.finished) return;

  const task = solverExam.tasks.find((candidate) => candidate.number === Number(anchor.dataset.inlineChoiceTask));
  if (!task) return;

  closeInlineChoicePopover();
  anchor.setAttribute("aria-expanded", "true");
  const popover = document.createElement("div");
  popover.className = "english-choice-popover";
  popover.id = "english-choice-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `Odgovori za prazninu ${questionNumber}`);
  popover.innerHTML = renderInlineChoicePopover(task, questionNumber);
  document.body.append(popover);
  placeInlineChoicePopover(popover, anchor);

  popover.querySelector("[data-inline-choice-popover-close]")?.addEventListener("click", () => {
    closeInlineChoicePopover();
    anchor.focus();
  });

  popover.querySelectorAll("[data-inline-choice-option]").forEach((button) => {
    button.addEventListener("click", () => {
      updateResponse(questionNumber, button.dataset.inlineChoiceOption);
      anchor.focus();
    });
  });

  const selected = popover.querySelector(".english-choice-popover__option--selected");
  (selected || popover.querySelector("[data-inline-choice-option]"))?.focus();
  window.setTimeout(() => {
    document.addEventListener("click", closeInlineChoicePopover, { once: true });
  }, 0);
}

function renderInlineChoicePopover(task, questionNumber) {
  const answer = responses[questionNumber] || "";
  const optionMap = inlineChoiceOptionTextMap(task, questionNumber);
  const usedOptions = inlineChoiceUsedOptions(task, questionNumber);

  return `
    <div class="english-choice-popover__heading">
      <strong>${escapeHtml(questionNumber)}</strong>
      <button type="button" data-inline-choice-popover-close aria-label="Zatvori odabir">&times;</button>
    </div>
    <div class="english-choice-popover__options">
      ${(task.options || [])
        .map((option) => {
          const selectedClass = option === answer ? " english-choice-popover__option--selected" : "";
          const usedBy = usedOptions.get(option) || [];
          const usedClass = usedBy.length && option !== answer
            ? " english-choice-popover__option--used"
            : "";
          const usedLabel = usedBy.length
            ? ` aria-label="${escapeHtml(`${option}, već odabrano u praznini ${usedBy.join(", ")}`)}"`
            : "";
          return `
            <button
              class="english-choice-popover__option${selectedClass}${usedClass}"
              type="button"
              data-inline-choice-option="${escapeHtml(option)}"
              ${usedLabel}
            >
              <strong>${escapeHtml(option)}</strong>
              <span>${escapeHtml(optionMap[option] || `Odgovor ${option}`)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function inlineChoiceUsedOptions(task, questionNumber) {
  if (!usesSharedInlineChoiceBank(task)) return new Map();

  const optionSet = new Set(task.options || []);
  const usedOptions = new Map();
  taskQuestions(task)
    .map(String)
    .filter((question) => question !== String(questionNumber))
    .forEach((question) => {
      const answer = String(responses[question] || "").trim();
      if (!answer || !optionSet.has(answer)) return;
      if (!usedOptions.has(answer)) usedOptions.set(answer, []);
      usedOptions.get(answer).push(question);
    });

  return usedOptions;
}

function placeInlineChoicePopover(popover, anchor) {
  const anchorRect = anchor.getBoundingClientRect();
  const gap = 8;
  const viewportPadding = 12;
  let left = Math.max(viewportPadding, anchorRect.left);
  let top = anchorRect.bottom + gap;

  if (left + popover.offsetWidth > window.innerWidth - viewportPadding) {
    left = window.innerWidth - popover.offsetWidth - viewportPadding;
  }
  if (top + popover.offsetHeight > window.innerHeight - viewportPadding) {
    top = anchorRect.top - popover.offsetHeight - gap;
  }

  popover.style.left = `${Math.max(viewportPadding, left)}px`;
  popover.style.top = `${Math.max(viewportPadding, top)}px`;
}

function closeInlineChoicePopover() {
  document.querySelector("#english-choice-popover")?.remove();
  document
    .querySelectorAll("[data-inline-choice-question][aria-expanded='true']")
    .forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function renderTaskResponses(task) {
  const total = task.lastQuestion - task.firstQuestion + 1;
  const groupCheckControls =
    task.kind === "text" && !hasInlineGapBlanks(task)
      ? renderInlineGapCheckControls(task)
      : "";

  return `
    <section class="english-reading-responses" aria-label="Digitalni list za odgovore">
      <div class="english-reading-responses__heading">
        <strong>Digitalni list za odgovore</strong>
        <small>${taskAnsweredCount(task)}/${total}</small>
      </div>
      <div class="response-list">
        ${taskQuestions(task).map((question) => renderQuestion(task, String(question))).join("")}
      </div>
      ${groupCheckControls}
    </section>
  `;
}

function allQuestions(exam) {
  return exam.tasks.flatMap((task) => {
    const questions = [];
    for (let question = task.firstQuestion; question <= task.lastQuestion; question += 1) {
      questions.push(question);
    }
    return questions;
  });
}

function loadResponses(exam) {
  const storedResponses = {};
  try {
    const knownQuestions = new Set(allQuestions(exam).map(String));
    for (const key of readingStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedResponses, stored);
      }
    }
    return Object.fromEntries(
      Object.entries(storedResponses).filter(
        ([question, answer]) => knownQuestions.has(question) && typeof answer === "string",
      ),
    );
  } catch {
    return {};
  }
}

function saveResponses() {
  if (simulation.active) return;

  try {
    localStorage.setItem(readingStorageKeyForId(solverExam.id), JSON.stringify(responses));
  } catch {
    // Solving still works if storage is unavailable.
  }
}

function answeredCount(exam, storedResponses = responses) {
  return allQuestions(exam).filter((question) => storedResponses[question]?.trim()).length;
}

function taskQuestions(task) {
  const questions = [];
  for (let question = task.firstQuestion; question <= task.lastQuestion; question += 1) {
    questions.push(question);
  }
  return questions;
}

function taskAnsweredCount(task) {
  return taskQuestions(task).filter((question) => responses[question]?.trim()).length;
}

function taskTypeDefinition(exam, task) {
  const firstCompletionTask = exam.level === "A" ? 3 : 4;
  return task.number >= firstCompletionTask
    ? taskTypeDefinitions.completion
    : taskTypeDefinitions.choice;
}

function taskTypes(exam = solverExam) {
  const groups = new Map();

  for (const task of exam?.tasks || []) {
    const definition = taskTypeDefinition(exam, task);
    if (!groups.has(definition.id)) {
      groups.set(definition.id, { ...definition, tasks: [] });
    }
    groups.get(definition.id).tasks.push(task);
  }

  return [...groups.values()];
}

function normalizeTaskTypeId(taskTypeId, exam = solverExam) {
  const types = taskTypes(exam);
  return types.some((type) => type.id === taskTypeId) ? taskTypeId : types[0]?.id;
}

function tasksForTaskType(taskTypeId = activeTaskTypeId, exam = solverExam) {
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  return taskTypes(exam).find((type) => type.id === normalizedTaskTypeId)?.tasks || [];
}

function questionsForTaskType(taskTypeId = activeTaskTypeId, exam = solverExam) {
  return tasksForTaskType(taskTypeId, exam).flatMap((task) => taskQuestions(task));
}

function taskTypeForQuestion(question, exam = solverExam) {
  const task = exam.tasks.find(
    (candidate) => question >= candidate.firstQuestion && question <= candidate.lastQuestion,
  );
  return task ? taskTypeDefinition(exam, task).id : normalizeTaskTypeId("", exam);
}

function taskTypeAnsweredCount(taskType) {
  return taskType.tasks.reduce((total, task) => total + taskAnsweredCount(task), 0);
}

function taskTypeQuestionCount(taskType) {
  return taskType.tasks.reduce((total, task) => total + taskQuestions(task).length, 0);
}

function correctAnswers(question) {
  const answer = solverExam?.answers?.[question];
  if (Array.isArray(answer)) return answer.filter(Boolean).map(String);
  return answer ? [String(answer)] : [];
}

function normalizeAnswer(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function isCorrectAnswer(question, answer) {
  const normalizedAnswer = normalizeAnswer(answer);
  return correctAnswers(question).some(
    (correctAnswer) => normalizeAnswer(correctAnswer) === normalizedAnswer,
  );
}

function trimEmptyLines(lines) {
  const trimmed = [...lines];
  while (trimmed.length && !trimmed[0].trim()) trimmed.shift();
  while (trimmed.length && !trimmed[trimmed.length - 1].trim()) trimmed.pop();
  return trimmed;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseQuestionSections(task) {
  const knownQuestions = new Set(taskQuestions(task).map(String));
  const contextLines = [];
  const sections = [];
  let currentSection = null;

  for (const line of stripTaskHeading(task.text).split("\n")) {
    const match = line.match(/^\s*(\d{1,2})(?:[.)])?\s+(.*)$/);
    if (match && knownQuestions.has(match[1])) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        number: match[1],
        lines: [match[2]],
      };
      continue;
    }

    if (currentSection) currentSection.lines.push(line);
    else contextLines.push(line);
  }

  if (currentSection) sections.push(currentSection);

  return {
    contextLines: trimEmptyLines(contextLines),
    sections,
  };
}

function hasQuestionImages(task) {
  return taskQuestions(task).every((question) =>
    questionSourceImages(task, String(question)).length,
  );
}

function questionSourceImages(task, question) {
  const source = task?.questionImages?.[String(question)];
  const images = Array.isArray(source) ? source : [source];
  return images.filter(validSourceImage);
}

function renderQuestionImageTaskContent(task) {
  if (task.kind !== "choice" || task.blanks || !task.options?.length) return "";
  if (!hasQuestionImages(task)) return "";

  const sourceImages = renderTaskSourceImages(task);
  if (!sourceImages) return "";

  const sections = taskQuestions(task).map((question) => ({
    number: String(question),
    sourceImages: questionSourceImages(task, String(question)),
    bodyLines: [],
    options: [],
  }));

  return `
    ${sourceImages}
    <div class="task-source english-reading-source english-reading-matching-questions">
      <div class="english-reading-question-list">
        ${sections.map((section) => renderSourceQuestion(task, section)).join("")}
      </div>
    </div>
  `;
}

function parseQuestionOptionLines(task, lines) {
  if (!task.options?.length) {
    return {
      bodyLines: trimEmptyLines(lines),
      options: [],
    };
  }

  const optionPattern = new RegExp(
    `^\\s*([${escapeRegExp(task.options.join(""))}])(?:[.)])?\\s+(.+)$`,
  );
  const bodyLines = [];
  const options = [];
  let currentOption = null;
  let parsingOptions = false;

  for (const line of lines) {
    const match = line.match(optionPattern);
    if (match) {
      parsingOptions = true;
      if (currentOption) options.push(currentOption);
      currentOption = {
        label: match[1],
        text: match[2].trim(),
      };
      continue;
    }

    if (parsingOptions) {
      if (currentOption && line.trim()) {
        currentOption.text = `${currentOption.text} ${line.trim()}`.trim();
      }
      continue;
    }

    bodyLines.push(line);
  }

  if (currentOption) options.push(currentOption);

  if (options.length < 2) {
    return {
      bodyLines: trimEmptyLines(lines),
      options: [],
    };
  }

  return {
    bodyLines: trimEmptyLines(bodyLines),
    options,
  };
}

function prepareQuestionSections(task, sections) {
  const preparedSections = sections.map((section) => ({
    number: section.number,
    ...parseQuestionOptionLines(task, section.lines),
  }));
  let globalOptions = [];
  const sectionsWithOptions = preparedSections.filter((section) => section.options.length >= 2);
  const lastSection = preparedSections[preparedSections.length - 1];

  if (
    sectionsWithOptions.length === 1 &&
    sectionsWithOptions[0] === lastSection &&
    preparedSections.slice(0, -1).every((section) => section.options.length === 0)
  ) {
    globalOptions = lastSection.options;
    lastSection.options = [];
  }

  return {
    sections: preparedSections,
    globalOptions,
  };
}

function renderQuestionText(lines) {
  const blocks = trimEmptyLines(lines)
    .join("\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => `<p>${highlightInline(blockText(block))}</p>`).join("");
}

function renderQuestionOptions(options) {
  return options.length ? renderSourceList(options, "source-options") : "";
}

function renderStructuredTaskContent(task) {
  const parsed = parseQuestionSections(task);
  if (parsed.sections.length !== taskQuestions(task).length) return "";

  const prepared = prepareQuestionSections(task, parsed.sections);
  const contextText = parsed.contextLines.join("\n").trim();
  const context = contextText ? renderTaskSource(contextText) : "";
  const globalOptions = renderQuestionOptions(prepared.globalOptions);

  return `
    <div class="task-source english-reading-source">
      ${context}
      ${globalOptions}
      <div class="english-reading-question-list">
        ${prepared.sections.map((section) => renderSourceQuestion(task, section)).join("")}
      </div>
    </div>
  `;
}

function renderFallbackQuestionList(task) {
  return `
    <div class="english-reading-question-list">
      ${taskQuestions(task)
        .map((question) =>
          renderSourceQuestion(task, {
            number: String(question),
            bodyLines: [`Pitanje ${question}`],
            options: [],
          }),
        )
        .join("")}
    </div>
  `;
}

function renderSourceQuestion(task, question) {
  const number = String(question.number);
  const sourceImage = renderQuestionSourceImages(question.sourceImages, number);
  const body = renderQuestionText(question.bodyLines);
  const options = renderQuestionOptions(question.options);

  return `
    <article
      class="physics-source-question english-source-question${sourceImage ? " physics-source-question--image" : ""}"
      id="odgovor-${escapeHtml(number)}"
      data-question-number="${escapeHtml(number)}"
    >
      ${sourceImage ? "" : `<h4>${escapeHtml(number)}</h4>`}
      <div class="physics-source-question__body english-source-question__body">
        ${sourceImage || body || `<p>Pitanje ${escapeHtml(number)}</p>`}
        ${options}
      </div>
      ${renderQuestion(task, number, { inline: true, includeId: false })}
    </article>
  `;
}

function renderQuestionSourceImages(sourceImages, number) {
  const images = Array.isArray(sourceImages) ? sourceImages.filter(validSourceImage) : [];
  return images
    .map((source, index) => {
      const partLabel = images.length > 1 ? `, dio ${index + 1}` : "";
      return renderCroppedImage(
        source,
        `Izvorni prikaz ${number}. pitanja iz službene PDF knjižice${partLabel}.`,
      );
    })
    .join("");
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function selectedTaskTypeId(exam) {
  return normalizeTaskTypeId(new URLSearchParams(window.location.search).get("vrsta"), exam);
}

function examUrl(exam, taskTypeId = activeTaskTypeId) {
  const params = new URLSearchParams({ exam: exam.id });
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  if (normalizedTaskTypeId) params.set("vrsta", normalizedTaskTypeId);
  if (simulation.active) params.set("nacin", "simulacija");
  return `./engleski-citanje.html?${params.toString()}`;
}

function renderPicker() {
  document.body.classList.remove("solver-page");
  const years = [...new Set(exams.map((exam) => exam.year))].sort((a, b) => b - a);

  app.innerHTML = `
    <div class="practice-overview">
      <div class="practice-overview__heading">
        <div>
          <p class="eyebrow">Čitanje</p>
          <h2>Odaberi ispit</h2>
        </div>
        <p>
          Dostupne su obje razine i oba godišnja roka od 2013. do 2025. godine.
          Pitanja su izdvojena iz izvornih knjižica, a odabir odgovora prikazan
          je odmah uz pripadajuće pitanje.
        </p>
      </div>

      <div class="practice-filter-bar">
        <label class="field">
          <span>Razina</span>
          <select id="practice-level-select">
            <option value="">Obje razine</option>
            <option value="A">A razina</option>
            <option value="B">B razina</option>
          </select>
        </label>
        <label class="field">
          <span>Godina ispita</span>
          <select id="practice-year-select">
            <option value="">Sve godine</option>
            ${years.map((year) => `<option value="${year}">${year}.</option>`).join("")}
          </select>
        </label>
      </div>

      <div id="practice-exam-list"></div>
    </div>
  `;

  document.querySelector("#practice-level-select").addEventListener("change", (event) => {
    pickerState.level = event.target.value;
    renderPickerList();
  });

  document.querySelector("#practice-year-select").addEventListener("change", (event) => {
    pickerState.year = event.target.value;
    renderPickerList();
  });

  renderPickerList();
}

function renderPickerList() {
  const filteredExams = exams.filter((exam) => {
    if (pickerState.level && exam.level !== pickerState.level) return false;
    return !pickerState.year || String(exam.year) === pickerState.year;
  });

  document.querySelector("#practice-exam-list").innerHTML = `
    <div class="practice-table-wrap">
      <table class="practice-exam-table">
        <thead>
          <tr>
            <th>Godina</th>
            <th>Rok</th>
            <th>Razina</th>
            <th>Napredak</th>
            <th>Provjera</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filteredExams.map(renderPickerRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPickerRow(exam) {
  const storedResponses = loadResponses(exam);
  const complete = answeredCount(exam, storedResponses);
  const total = allQuestions(exam).length;
  const checking = exam.checkingSupported
    ? `<span class="status-badge status-badge--available">Dostupna</span>`
    : `<span class="status-badge">Naknadno</span>`;

  return `
    <tr>
      <td><strong>${exam.year}.</strong></td>
      <td>${escapeHtml(formatTerm(exam.term))}</td>
      <td><span class="level-badge">${escapeHtml(exam.level)}</span></td>
      <td>${complete}/${total}</td>
      <td>${checking}</td>
      <td>
        <a class="start-link" href="${examUrl(exam)}">
          ${complete ? "Nastavi" : "Pokreni"}
        </a>
      </td>
    </tr>
  `;
}

function renderMissingExam() {
  document.body.classList.remove("solver-page");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani ispit čitanja nije dostupan.</p>
      <a class="start-link" href="${englishSubjectUrl}">Vrati se na Engleski jezik</a>
    </div>
  `;
}

function renderSolver(exam) {
  document.body.classList.add("solver-page");
  solverExam = exam;
  responses = simulation.active ? {} : loadResponses(exam);
  checked = false;
  selfCheck.reset();
  activeTaskTypeId = selectedTaskTypeId(exam);
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId, exam)[0];

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Engleski",
      part: "Čitanje",
      exam,
      backHref: englishSubjectUrl,
      backLabel: "← Natrag na Engleski jezik",
      paperUrl: exam.paperUrl,
      archiveUrl: exam.archiveUrl,
      summaryHtml: `
        ${simulation.renderTimer()}
        <strong id="answer-progress"></strong>
        <span id="score-summary"></span>
      `,
      navigationHtml: `
        <nav
          class="task-navigation solver-header__task-navigation"
          data-task-type-navigation
          aria-label="Vrste zadataka čitanja u ispitnom zaglavlju"
        ></nav>
      `,
    })}

    ${simulation.renderNotice()}

    ${
      exam.checkingSupported
        ? ""
        : `<p class="practice-notice">
            Automatska provjera za stariji format još nije dostupna. Uneseni odgovori
            ${
              simulation.active
                ? "iz simulacije ne spremaju se."
                : "spremaju se u ovome pregledniku, a službeni ključ nalazi se u izvornome ZIP-u."
            }
          </p>`
    }

    <div class="solver-question-layout english-reading-layout">
      <div class="solver-question-main" id="task-content-panel"></div>
      <aside class="question-quickselect" aria-label="Brzi odabir pitanja">
        <div class="question-quickselect__heading">
          <strong>Brzi odabir</strong>
          <small>Pitanja</small>
        </div>
        <nav class="question-quickselect__list" id="question-quickselect"></nav>
      </aside>
    </div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <nav
          class="task-navigation"
          data-task-type-navigation
          aria-label="Vrste zadataka čitanja"
        ></nav>
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            ${icon("list-checks", "solver-sticky-footer__status-icon")}
            <div class="solver-sticky-footer__status-copy">
              <strong id="footer-answer-progress"></strong>
              <span id="footer-score-summary"></span>
            </div>
          </div>
          <div class="solver-sticky-footer__actions">
            ${
              exam.checkingSupported || simulation.active
                ? `<button class="${checkButtonClass()}" id="check-answers" type="button">
                    ${renderCheckButtonContent()}
                  </button>`
                : ""
            }
          </div>
        </div>
      </div>
    </footer>

    <div class="exam-results-dialog" id="exam-results-dialog" role="dialog" aria-modal="true" aria-labelledby="exam-results-title" hidden>
      <div class="exam-results-dialog__backdrop"></div>
      <section class="exam-results-dialog__panel">
        <button class="exam-results-dialog__close" id="close-exam-results" type="button" aria-label="Zatvori rezultat">
          &times;
        </button>
        <svg class="exam-results-dialog__check" aria-hidden="true" focusable="false" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28"></circle>
          <path d="m20 33 8 8 17-18"></path>
        </svg>
        <p class="eyebrow">Rezultat cijeloga ispita</p>
        <h2 id="exam-results-title">Rješenja su provjerena</h2>
        <div class="exam-results-dialog__metrics">
          <div>
            <strong id="exam-results-percentage"></strong>
            <span>Riješenost</span>
          </div>
          <div>
            <strong id="exam-results-score"></strong>
            <span>Bodovi</span>
          </div>
        </div>
        <p>
          Rezultat obuhvaća sve zadatke čitanja. Zatvori prozor i pregledaj
          označene odgovore po zadatcima.
        </p>
      </section>
    </div>
  `;

  document.querySelector("#check-answers")?.addEventListener("click", checkAnswers);
  document.querySelector("#close-exam-results")?.addEventListener("click", closeResultsDialog);
  document.querySelector(".exam-results-dialog__backdrop")?.addEventListener("click", closeResultsDialog);
  document.addEventListener("keydown", closeResultsDialogOnEscape);

  renderTaskTypeNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskTypeContent();
  simulation.start(exam.durationMinutes);
}

function renderTaskTypeNavigation() {
  const navigationHtml = taskTypes()
    .map((taskType) => {
      const activeClass = taskType.id === activeTaskTypeId ? " task-button--active" : "";
      return `
        <a
          class="task-button${activeClass}"
          href="${examUrl(solverExam, taskType.id)}"
          data-task-type="${taskType.id}"
          ${taskType.id === activeTaskTypeId ? 'aria-current="true"' : ""}
        >
          <strong>${escapeHtml(taskType.label)}</strong>
          <small>${taskTypeAnsweredCount(taskType)}/${taskTypeQuestionCount(taskType)}</small>
        </a>
      `;
    })
    .join("");

  document.querySelectorAll("[data-task-type-navigation]").forEach((navigation) => {
    navigation.innerHTML = navigationHtml;
  });

  document.querySelectorAll("[data-task-type]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectTaskType(link.dataset.taskType);
    });
  });
}

function renderQuestionQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const questions = questionsForTaskType();
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = questions.length <= 2;

  quickSelect.innerHTML = questions
    .map((question) => {
      const answer = responses[question];
      const stateClass = answer ? " question-quickselect__link--answered" : "";
      const resultClass = isChecked(question) && correctAnswers(question).length
        ? isCorrectAnswer(question, answer)
          ? " question-quickselect__link--correct"
          : " question-quickselect__link--wrong"
        : "";
      const activeClass =
        Number(question) === Number(activeQuestionNumber) ? " question-quickselect__link--active" : "";
      const answerState = answer ? "odgovoreno" : "nije odgovoreno";

      return `
        <a
          class="question-quickselect__link${stateClass}${resultClass}${activeClass}"
          href="#odgovor-${question}"
          data-quick-question="${question}"
          aria-label="Pitanje ${question}, ${answerState}"
          ${activeClass ? 'aria-current="true"' : ""}
        >
          ${question}
        </a>
      `;
    })
    .join("");

  quickSelect.querySelectorAll("[data-quick-question]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectQuestion(Number(link.dataset.quickQuestion));
    });
  });
}

function renderSolverSummary() {
  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  document.querySelector("#answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#footer-answer-progress").textContent = `${complete}/${total} odgovora`;
  const checkButton = document.querySelector("#check-answers");
  if (checkButton) {
    checkButton.disabled =
      (simulation.finished && solverExam?.checkingSupported === false) ||
      (complete === 0 && !checked && !simulation.finished);
    checkButton.className = checkButtonClass();
    checkButton.innerHTML = renderCheckButtonContent();
  }

  const scoreSummary = document.querySelector("#score-summary");
  const resolved = allQuestions(solverExam).filter(
    (question) => isChecked(question) && correctAnswers(question).length,
  );
  const resolvedCorrect = resolved.filter(
    (question) => isCorrectAnswer(question, responses[question]),
  ).length;
  const score = resolved.length ? `${resolvedCorrect}/${resolved.length} točno` : "";
  scoreSummary.textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderTaskTypeContent() {
  document.querySelector("#task-content-panel").innerHTML = tasksForTaskType()
    .map(
      (task) => `
        <section
          class="task-content-panel english-reading-task-panel"
          data-task-number="${task.number}"
        >
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Pitanja iz knjižice</p>
              <h3>Zadatak ${task.number}</h3>
            </div>
            <small>Pitanja ${task.firstQuestion}–${task.lastQuestion}</small>
          </div>
          ${renderTaskSourceContent(task)}
        </section>
      `,
    )
    .join("");
  bindResponseListeners();
}

function bindResponseListeners() {
  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });

  selfCheck.bind(document.querySelector("#task-content-panel"), toggleSelfCheck);
  document.querySelectorAll('input[type="text"][data-question]').forEach((input) => {
    input.addEventListener("input", () => updateResponse(input.dataset.question, input.value));
  });
  document.querySelectorAll("[data-inline-choice-question]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openInlineChoicePopover(button.dataset.inlineChoiceQuestion, button);
    });
  });
  document.querySelectorAll("[data-inline-gap-group-check]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleInlineTextGapSelfCheck(Number(button.dataset.inlineGapGroupCheck));
    });
  });
  bindEnglishCompletionCards();
}

function toggleSelfCheck(question) {
  if (simulation.active || checked) return;
  selfCheck.toggle(question);
  renderTaskTypeNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskTypeContent();
}

function toggleInlineTextGapSelfCheck(taskNumber) {
  if (simulation.active || checked) return;

  const task = solverExam.tasks.find((candidate) => candidate.number === taskNumber);
  if (!usesTaskGroupSelfCheck(task)) return;

  const questions = checkableTaskGroupQuestions(task);
  const answeredQuestions = answeredTaskGroupQuestions(questions);
  if (!answeredQuestions.length) return;

  const active = answeredQuestions.every((question) => selfCheck.has(question));
  if (active) {
    questions.forEach((question) => selfCheck.delete(question));
  } else {
    answeredQuestions.forEach((question) => {
      if (!selfCheck.has(question)) selfCheck.toggle(question);
    });
  }

  renderTaskTypeNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskTypeContent();
}

function renderQuestion(task, question, options = {}) {
  const answer = responses[question] || "";
  const hasCorrectAnswer = correctAnswers(question).length > 0;
  const resultClass = isChecked(question) && hasCorrectAnswer
    ? isCorrectAnswer(question, answer)
      ? " response-question--correct"
      : " response-question--wrong"
    : "";
  const checkButton =
    task.kind === "text"
      ? ""
      : selfCheck.renderButton(question, {
          hidden: simulation.active || checked || !hasCorrectAnswer,
        });
  const idAttribute = options.includeId === false ? "" : ` id="odgovor-${escapeHtml(question)}"`;
  const inlineClass = options.inline ? " physics-inline-response" : "";

  if (task.kind === "text") {
    return `
      <div
        class="response-question response-question--text english-inline-text-response${inlineClass}${resultClass}"
        ${idAttribute}
      >
        <label class="english-inline-text-response__field">
          <strong>${escapeHtml(question)}.</strong>
          <input
            data-question="${escapeHtml(question)}"
            type="text"
            value="${escapeHtml(answer)}"
            autocomplete="off"
            aria-label="Odgovor na pitanje ${question}"
            ${simulation.inputDisabledAttribute()}
          >
        </label>
        ${checkButton}
        ${renderFeedback(question, answer)}
      </div>
    `;
  }

  return `
    <fieldset class="response-question${inlineClass}${resultClass}"${idAttribute}>
      <legend>${escapeHtml(question)}.</legend>
      <div class="choice-list">
        ${task.options
          .map((option) => renderChoice(question, option, answer))
          .join("")}
      </div>
      ${checkButton}
      ${renderFeedback(question, answer)}
    </fieldset>
  `;
}

function renderChoice(question, option, answer) {
  const selected = option === answer;
  const correct = isCorrectAnswer(question, option);
  let resultClass = "";
  if (isChecked(question) && correct) resultClass = " answer-choice--correct";
  if (isChecked(question) && selected && !correct) resultClass = " answer-choice--wrong";

  return `
    <label class="answer-choice${resultClass}">
      <input
        data-question="${question}"
        type="radio"
        name="answer-${question}"
        value="${option}"
        ${selected ? "checked" : ""}
        ${simulation.inputDisabledAttribute()}
      >
      <span>${option}</span>
    </label>
  `;
}

function renderFeedback(question, answer) {
  if (!isChecked(question)) return "";
  const answers = correctAnswers(question);
  if (!answers.length) return "";
  if (isCorrectAnswer(question, answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${answers.join(" ili ")}.</small>`;
}

function updateResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  const task = taskForQuestion(Number(question));
  const groupCheckQuestions = checkableTaskGroupQuestions(task);
  const wasSelfChecked = groupCheckQuestions.length
    ? groupCheckQuestions.some((groupQuestion) => selfCheck.has(groupQuestion))
    : selfCheck.has(question);
  closeInlineChoicePopover();
  checked = false;
  if (groupCheckQuestions.length) {
    groupCheckQuestions.forEach((groupQuestion) => selfCheck.delete(groupQuestion));
  } else {
    selfCheck.delete(question);
  }
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) responses[question] = normalizedAnswer;
  else delete responses[question];
  activeQuestionNumber = Number(question);
  saveResponses();
  renderTaskTypeNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  if (wasChecked || wasSelfChecked) {
    if (wasChecked) closeResultsDialog();
    renderTaskTypeContent();
  } else {
    renderTaskResponseSummary(task?.number);
    syncRenderedInlineResponse(question);
  }
}

function renderTaskResponseSummary(taskNumber) {
  const task = solverExam.tasks.find((candidate) => candidate.number === taskNumber);
  const summary = document.querySelector(
    `[data-task-number="${taskNumber}"] .english-reading-responses__heading small`,
  );
  if (!task || !summary) return;
  const total = task.lastQuestion - task.firstQuestion + 1;
  summary.textContent = `${taskAnsweredCount(task)}/${total}`;
}

function syncRenderedInlineResponse(question) {
  const answer = responses[question] || "";
  document.querySelectorAll('input[type="text"][data-question]').forEach((input) => {
    if (input.dataset.question !== String(question)) return;
    input.classList.toggle("english-text-blank--answered", Boolean(answer));
    input.classList.remove("english-text-blank--correct", "english-text-blank--wrong");
  });
  document.querySelectorAll("[data-inline-choice-question]").forEach((button) => {
    if (button.dataset.inlineChoiceQuestion !== String(question)) return;
    button.value = answer;
    button.innerHTML = renderInlineChoiceBlankContent(answer);
    button.classList.toggle("english-choice-blank--answered", Boolean(answer));
    button.classList.remove("english-choice-blank--correct", "english-choice-blank--wrong");
    button.setAttribute("aria-label", inlineChoiceBlankAriaLabel(question, answer));
  });
  document.querySelectorAll("[data-self-check]").forEach((button) => {
    if (String(button.dataset.selfCheck) === String(question)) button.disabled = !answer;
  });
  syncInlineGapGroupCheckButtons();
  syncEnglishCompletionCards();
}

function syncInlineGapGroupCheckButtons() {
  document.querySelectorAll("[data-inline-gap-group-check]").forEach((button) => {
    const task = solverExam.tasks.find(
      (candidate) => candidate.number === Number(button.dataset.inlineGapGroupCheck),
    );
    if (!task) return;
    button.disabled = !answeredTaskGroupQuestions(checkableTaskGroupQuestions(task)).length;
  });
}

function taskForQuestion(question) {
  return solverExam.tasks.find(
    (task) => question >= task.firstQuestion && question <= task.lastQuestion,
  );
}

function selectQuestion(question) {
  const taskTypeId = taskTypeForQuestion(question);
  const taskTypeChanged = taskTypeId !== activeTaskTypeId;
  activeTaskTypeId = taskTypeId;
  activeQuestionNumber = question;
  history.replaceState(null, "", examUrl(solverExam, activeTaskTypeId));
  renderTaskTypeNavigation();
  if (taskTypeChanged) renderTaskTypeContent();
  renderQuestionQuickSelect();

  document
    .querySelector(`#odgovor-${question}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function selectTaskType(taskTypeId) {
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (normalizedTaskTypeId === activeTaskTypeId) return;

  activeTaskTypeId = normalizedTaskTypeId;
  activeQuestionNumber = questionsForTaskType()[0];
  history.replaceState(null, "", examUrl(solverExam, activeTaskTypeId));
  renderTaskTypeNavigation();
  renderTaskTypeContent();
  renderQuestionQuickSelect();
  document.querySelector("#task-content-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    simulation.finish("submitted");
    return;
  }

  if (checked) {
    checked = false;
    selfCheck.reset();
    closeResultsDialog();
    renderTaskTypeNavigation();
    renderQuestionQuickSelect();
    renderSolverSummary();
    renderTaskTypeContent();
    return;
  }

  checked = true;
  selfCheck.reset();
  renderTaskTypeNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskTypeContent();
  openResultsDialog();
}

function finishSimulation(reason) {
  checked = solverExam.checkingSupported;
  renderTaskTypeNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskTypeContent();

  if (reason === "submitted") recordSubmittedSimulation();

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }

  if (checked) openResultsDialog();
}

function recordSubmittedSimulation() {
  if (!window.AsistentProfile) return;

  const total = allQuestions(solverExam).length;
  const checkingSupported = solverExam.checkingSupported !== false;
  const score = checkingSupported ? totalScore() : null;

  window.AsistentProfile.recordSimulationAttempt({
    solver: "english-reading",
    subject: "Engleski jezik",
    part: "Čitanje",
    examId: solverExam.id,
    year: solverExam.year,
    term: solverExam.term,
    level: solverExam.level,
    schoolYear: solverExam.schoolYear,
    durationMinutes: solverExam.durationMinutes,
    answered: answeredCount(solverExam),
    totalQuestions: total,
    score,
    maxScore: checkingSupported ? total : null,
    checkingSupported,
  });
}

function taskScore(task) {
  return taskQuestions(task).filter(
    (question) => isCorrectAnswer(question, responses[question]),
  ).length;
}

function totalScore() {
  return solverExam.tasks.reduce((score, task) => score + taskScore(task), 0);
}

function scorePercentage() {
  const total = allQuestions(solverExam).length;
  return total ? Math.round((totalScore() / total) * 100) : 0;
}

function openResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog) return;

  const total = allQuestions(solverExam).length;
  document.querySelector("#exam-results-percentage").textContent = `${scorePercentage()}%`;
  document.querySelector("#exam-results-score").textContent = `${totalScore()}/${total}`;
  dialog.hidden = false;
  document.body.classList.add("exam-results-dialog-open");
  document.querySelector("#close-exam-results")?.focus();
}

function closeResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog || dialog.hidden) return;

  dialog.hidden = true;
  document.body.classList.remove("exam-results-dialog-open");
  document.querySelector("#check-answers")?.focus();
}

function closeResultsDialogOnEscape(event) {
  if (event.key === "Escape") closeResultsDialog();
}

function startReadingPage() {
  const id = selectedExamId();
  if (!id) {
    window.location.replace(englishSubjectUrl);
    return;
  }

  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}

if (!simulation.active && window.AsistentProfile?.ready) {
  window.AsistentProfile.ready.finally(startReadingPage);
} else {
  startReadingPage();
}
