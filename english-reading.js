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
let activeTaskNumber;
let activeQuestionNumber;
let checked = false;
const simulation = window.createExamSimulation({ onFinish: finishSimulation });

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

function renderCheckButtonContent() {
  return `
    <svg class="solver-sticky-footer__action-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg#${checkButtonIcon()}"></use>
    </svg>
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

function renderCroppedImage(source, alt) {
  if (!validSourceImage(source)) return "";

  const crop = source.crop;
  const width = (source.width / crop.width) * 100;
  const offsetX = (-crop.x / source.width) * 100;
  const offsetY = (-crop.y / source.height) * 100;

  return `
    <figure class="pdf-source-figure">
      <div
        class="pdf-source-crop"
        style="aspect-ratio: ${crop.width} / ${crop.height}"
      >
        <img
          src="${escapeHtml(source.url)}"
          alt="${escapeHtml(alt)}"
          width="${source.width}"
          height="${source.height}"
          loading="lazy"
          decoding="async"
          style="width: ${width}%; transform: translate(${offsetX}%, ${offsetY}%);"
        >
      </div>
    </figure>
  `;
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
  return (
    renderStructuredTaskContent(task) ||
    `<div class="task-source english-reading-source">
      ${renderTaskSource(task.text)}
      ${renderFallbackQuestionList(task)}
    </div>`
  );
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
  const body = renderQuestionText(question.bodyLines);
  const options = renderQuestionOptions(question.options);

  return `
    <article
      class="physics-source-question english-source-question"
      id="odgovor-${escapeHtml(number)}"
      data-question-number="${escapeHtml(number)}"
    >
      <h4>${escapeHtml(number)}</h4>
      <div class="physics-source-question__body english-source-question__body">
        ${body || `<p>Pitanje ${escapeHtml(number)}</p>`}
        ${options}
      </div>
      ${renderQuestion(task, number)}
    </article>
  `;
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function examUrl(exam) {
  return `./engleski-citanje.html?exam=${encodeURIComponent(exam.id)}`;
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
  activeTaskNumber = exam.tasks[0].number;
  activeQuestionNumber = exam.tasks[0].firstQuestion;

  app.innerHTML = `
    ${renderSolverHeader({
      backHref: englishSubjectUrl,
      backLabel: "← Natrag na Engleski jezik",
      paperUrl: exam.paperUrl,
      archiveUrl: exam.archiveUrl,
      eyebrow: "Engleski - čitanje",
      title: `${exam.year}. · ${formatTerm(exam.term)} · ${exam.level} razina`,
      summaryHtml: `
        ${simulation.renderTimer()}
        <strong id="answer-progress"></strong>
        <span id="score-summary"></span>
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
      <section class="task-content-panel english-reading-task-panel" id="task-content-panel"></section>
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
        <nav class="task-navigation" id="task-navigation" aria-label="Zadatci čitanja"></nav>
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            <svg class="solver-sticky-footer__status-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <use href="./assets/lucide-icons.svg#list-checks"></use>
            </svg>
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
  `;

  document.querySelector("#check-answers")?.addEventListener("click", checkAnswers);

  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskContent();
  simulation.start(exam.durationMinutes);
}

function renderTaskNavigation() {
  document.querySelector("#task-navigation").innerHTML = solverExam.tasks
    .map((task) => {
      const total = task.lastQuestion - task.firstQuestion + 1;
      const activeClass = task.number === activeTaskNumber ? " task-button--active" : "";
      return `
        <button class="task-button${activeClass}" data-task="${task.number}" type="button">
          <strong>Zadatak ${task.number}</strong>
          <small>${taskAnsweredCount(task)}/${total}</small>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll(".task-button").forEach((button) => {
    button.addEventListener("click", () => selectTask(Number(button.dataset.task)));
  });
}

function renderQuestionQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const questions = allQuestions(solverExam);
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = questions.length <= 2;

  quickSelect.innerHTML = questions
    .map((question) => {
      const answer = responses[question];
      const stateClass = answer ? " question-quickselect__link--answered" : "";
      const resultClass = checked
        ? answer === solverExam.answers[question]
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
  const score = checked ? `${totalScore()}/${total} točno` : "";
  scoreSummary.textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderTaskContent() {
  const task = solverExam.tasks.find((candidate) => candidate.number === activeTaskNumber);
  document.querySelector("#task-content-panel").innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Pitanja iz knjižice</p>
        <h3>Zadatak ${task.number}</h3>
      </div>
      <small>Pitanja ${task.firstQuestion}–${task.lastQuestion}</small>
    </div>
    ${renderTaskSourceContent(task)}
  `;
  bindResponseListeners();
}

function bindResponseListeners() {
  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });

  document.querySelectorAll('input[type="text"][data-question]').forEach((input) => {
    input.addEventListener("input", () => updateResponse(input.dataset.question, input.value));
  });
}

function renderQuestion(task, question) {
  const answer = responses[question] || "";
  const resultClass = checked
    ? answer === solverExam.answers[question]
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  if (task.kind === "text") {
    return `
      <label class="physics-inline-response english-inline-text-response ${resultClass}">
        <span class="physics-inline-response__label">Upiši odgovor</span>
        <input
          data-question="${escapeHtml(question)}"
          type="text"
          value="${escapeHtml(answer)}"
          autocomplete="off"
          aria-label="Odgovor na pitanje ${question}"
          ${simulation.inputDisabledAttribute()}
        >
      </label>
    `;
  }

  return `
    <fieldset class="physics-inline-response ${resultClass}">
      <legend>Odgovor na ${escapeHtml(question)}. pitanje</legend>
      <span class="physics-inline-response__label">Odaberi odgovor</span>
      <div class="choice-list">
        ${task.options
          .map((option) => renderChoice(question, option, answer))
          .join("")}
      </div>
      ${renderFeedback(question, answer)}
    </fieldset>
  `;
}

function renderChoice(question, option, answer) {
  const selected = option === answer;
  const correct = option === solverExam.answers[question];
  let resultClass = "";
  if (checked && correct) resultClass = " answer-choice--correct";
  if (checked && selected && !correct) resultClass = " answer-choice--wrong";

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
  if (!checked) return "";
  const correctAnswer = solverExam.answers[question];
  if (answer === correctAnswer) return `<small class="response-feedback">Točno.</small>`;
  return `<small class="response-feedback">Točan odgovor: ${correctAnswer}.</small>`;
}

function updateResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  checked = false;
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) responses[question] = normalizedAnswer;
  else delete responses[question];
  activeQuestionNumber = Number(question);
  saveResponses();
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  if (wasChecked) renderTaskContent();
}

function taskForQuestion(question) {
  return solverExam.tasks.find(
    (task) => question >= task.firstQuestion && question <= task.lastQuestion,
  );
}

function selectQuestion(question) {
  const task = taskForQuestion(question);
  if (!task) return;

  activeTaskNumber = task.number;
  activeQuestionNumber = question;
  renderTaskNavigation();
  renderTaskContent();
  renderQuestionQuickSelect();

  document
    .querySelector(`#odgovor-${question}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function selectTask(taskNumber) {
  activeTaskNumber = taskNumber;
  const task = solverExam.tasks.find((candidate) => candidate.number === activeTaskNumber);
  activeQuestionNumber = task?.firstQuestion || activeQuestionNumber;
  renderTaskNavigation();
  renderTaskContent();
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
    renderTaskNavigation();
    renderQuestionQuickSelect();
    renderSolverSummary();
    renderTaskContent();
    return;
  }

  checked = true;
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskContent();
}

function finishSimulation(reason) {
  checked = solverExam.checkingSupported;
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskContent();

  if (reason === "submitted") recordSubmittedSimulation();

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }
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
    (question) => responses[question] === solverExam.answers[question],
  ).length;
}

function totalScore() {
  return solverExam.tasks.reduce((score, task) => score + taskScore(task), 0);
}

const id = selectedExamId();
if (!id) {
  window.location.replace(englishSubjectUrl);
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}
