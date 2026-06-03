const data = window.ASISTENT_ZA_MATURE_CROATIAN_CHOICE;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks interaktivnih zadataka iz Hrvatskoga jezika.");
}

const app = document.querySelector("#croatian-app");

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

const defaultTaskTypeId = "citanje-s-polaznim-tekstom";
const taskTypeAliases = {
  abcd: defaultTaskTypeId,
  citanje: defaultTaskTypeId,
  "citanje-s-polaznim-tekstom": defaultTaskTypeId,
  "visestruki-izbor": "visestruki-izbor",
  nadopunjavanje: "nadopunjavanje",
};

let solverExam;
let questionByNumber = new Map();
let responses = {};
let activeTaskTypeId = defaultTaskTypeId;
let activeQuestionNumber;
let checked = false;
let quickSelectFrame;
const completionOptionLetters = ["A", "B", "C", "D"];
const simulation = window.createExamSimulation({ onFinish: finishSimulation });

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(iconName, className) {
  return `
    <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg#${iconName}"></use>
    </svg>
  `;
}

function checkButtonLabel() {
  if (simulation.active && !simulation.finished) return "Predaj simulaciju";
  return checked ? "Sakrij rješenja" : "Provjeri rješenja";
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

function choiceExamIdForTerm(exam, term) {
  const level = exam.level ? `-${exam.level.toLocaleLowerCase("hr")}` : "";
  return `hrvatski${level}-${exam.year}-${slugPart(term)}`;
}

function choiceStorageKeyForId(id) {
  return `asistent-za-mature:croatian-choice:${id}`;
}

function choiceStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) => choiceExamIdForTerm(exam, term)),
  ];

  return [...new Set(ids)].map(choiceStorageKeyForId);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(choiceExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: choiceExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function tasks(exam = solverExam) {
  return exam?.tasks || [];
}

function taskQuestions(task) {
  return (task?.questions || []).map((question) => String(question.number));
}

function allQuestions(exam = solverExam) {
  return tasks(exam).flatMap(taskQuestions);
}

function taskForId(taskTypeId, exam = solverExam) {
  return tasks(exam).find((task) => task.id === taskTypeId) || tasks(exam)[0];
}

function questionsForTaskType(taskTypeId = activeTaskTypeId, exam = solverExam) {
  return taskQuestions(taskForId(taskTypeId, exam));
}

function buildQuestionMap(exam) {
  return new Map(
    tasks(exam).flatMap((task) =>
      task.questions.map((question) => [String(question.number), question]),
    ),
  );
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function normalizeTaskTypeId(taskTypeId, exam = solverExam) {
  const normalized = taskTypeAliases[taskTypeId] || taskTypeId || defaultTaskTypeId;
  return taskForId(normalized, exam)?.id || tasks(exam)[0]?.id || defaultTaskTypeId;
}

function selectedTaskTypeId(exam) {
  const params = new URLSearchParams(window.location.search);
  return normalizeTaskTypeId(params.get("vrsta") || params.get("cjelina"), exam);
}

function examUrl(exam, taskTypeId = defaultTaskTypeId) {
  const params = new URLSearchParams({ exam: exam.id });
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  if (normalizedTaskTypeId !== tasks(exam)[0]?.id) {
    params.set("vrsta", normalizedTaskTypeId);
  }
  if (simulation.active) params.set("nacin", "simulacija");
  return `./hrvatski.html?${params.toString()}`;
}

function croatianSubjectUrl() {
  return "./?predmet=Hrvatski%20jezik";
}

function correctAnswers(question) {
  const answer = solverExam.answers[question];
  return Array.isArray(answer) ? answer : [answer].filter(Boolean);
}

function isCorrectAnswer(question, answer) {
  return correctAnswers(question).includes(answer);
}

function loadResponses(exam) {
  const storedResponses = {};
  try {
    const knownQuestions = new Set(allQuestions(exam));
    for (const key of choiceStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedResponses, stored);
      }
    }
    return Object.fromEntries(
      Object.entries(storedResponses).filter(
        ([question, answer]) =>
          knownQuestions.has(question) && typeof answer === "string" && /^[A-D]$/.test(answer),
      ),
    );
  } catch {
    return {};
  }
}

function saveResponses() {
  if (simulation.active) return;

  try {
    localStorage.setItem(choiceStorageKeyForId(solverExam.id), JSON.stringify(responses));
  } catch {
    // Solving still works if storage is unavailable.
  }
}

function answeredCount(exam = solverExam, storedResponses = responses) {
  return allQuestions(exam).filter((question) => storedResponses[question]?.trim()).length;
}

function taskAnsweredCount(task) {
  return taskQuestions(task).filter((question) => responses[question]?.trim()).length;
}

function renderMissingExam() {
  document.body.classList.remove("solver-page", "croatian-solver-page");
  app.classList.remove("croatian-solver-active");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani ispit iz Hrvatskoga jezika nije dostupan.</p>
      <a class="start-link" href="${croatianSubjectUrl()}">Vrati se na Hrvatski jezik</a>
    </div>
  `;
}

function renderSolver(exam, taskTypeId) {
  document.body.classList.add("solver-page", "croatian-solver-page");
  app.classList.add("croatian-solver-active");
  solverExam = exam;
  questionByNumber = buildQuestionMap(exam);
  responses = simulation.active ? {} : loadResponses(exam);
  activeTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId, exam)[0] || allQuestions(exam)[0];
  checked = false;

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Hrvatski jezik",
      exam,
      backHref: croatianSubjectUrl(),
      backLabel: "← Odaberi drugi ispit",
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
          aria-label="Vrste zadataka u ispitnom zaglavlju"
        ></nav>
      `,
    })}

    ${simulation.renderNotice()}

    <div id="section-content"></div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <nav
          class="task-navigation"
          data-task-type-navigation
          aria-label="Vrste zadataka u ispitu"
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
            <button class="${checkButtonClass()}" id="check-answers" type="button">
              ${renderCheckButtonContent()}
            </button>
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
          Rezultat obuhvaća sve vrste zadataka. Zatvori prozor i pregledaj
          označene odgovore u svakoj vrsti zadatka.
        </p>
      </section>
    </div>
  `;

  document.querySelector("#check-answers").addEventListener("click", checkAnswers);
  document.querySelector("#close-exam-results").addEventListener("click", closeResultsDialog);
  document.querySelector(".exam-results-dialog__backdrop").addEventListener("click", closeResultsDialog);
  document.addEventListener("keydown", closeResultsDialogOnEscape);
  document.addEventListener("click", closeCompletionPopoverOnDocumentClick);
  window.addEventListener("resize", closeCompletionPopover);
  window.addEventListener("scroll", closeCompletionPopover, { passive: true });

  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  simulation.start(exam.durationMinutes);
}

function renderTaskTypeNavigation() {
  const navigationHtml = tasks()
    .map((task) => {
      const isActive = task.id === activeTaskTypeId;
      return `
        <a
          class="task-button${isActive ? " task-button--active" : ""}"
          href="${examUrl(solverExam, task.id)}"
          data-task-type="${task.id}"
          ${isActive ? 'aria-current="true"' : ""}
        >
          <strong>${escapeHtml(task.label)}</strong>
          <small>${taskAnsweredCount(task)}/${taskQuestions(task).length}</small>
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

function selectTaskType(taskTypeId) {
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (normalizedTaskTypeId === activeTaskTypeId) return;

  activeTaskTypeId = normalizedTaskTypeId;
  activeQuestionNumber = questionsForTaskType()[0];
  history.replaceState(null, "", examUrl(solverExam, activeTaskTypeId));
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  document.querySelector("#section-content")?.scrollIntoView({ block: "start" });
}

function renderSolverSummary() {
  const complete = answeredCount();
  const total = allQuestions().length;
  document.querySelector("#answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#footer-answer-progress").textContent = `${complete}/${total} odgovora`;
  const checkButton = document.querySelector("#check-answers");
  checkButton.disabled =
    (simulation.finished && solverExam?.checkingSupported === false) ||
    (complete === 0 && !checked && !simulation.finished);
  checkButton.className = checkButtonClass();
  checkButton.innerHTML = renderCheckButtonContent();

  const score = checked ? `${totalScore()}/${total} bodova` : "";
  document.querySelector("#score-summary").textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderTaskTypeContent() {
  const task = taskForId(activeTaskTypeId);
  const questions = task.questions || [];
  const hasInteractiveCompletion = hasInteractiveCompletionBlanks(task);

  document.querySelector("#section-content").innerHTML = `
    <div class="solver-question-layout">
      <section class="task-content-panel physics-task-content-panel" id="task-content-panel"></section>
      <aside class="question-quickselect" aria-label="Brzi odabir pitanja">
        <div class="question-quickselect__heading">
          <strong>Brzi odabir</strong>
          <small>Pitanja</small>
        </div>
        <nav class="question-quickselect__list" id="question-quickselect"></nav>
      </aside>
    </div>
  `;

  document.querySelector("#task-content-panel").innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Pitanja iz knjižice</p>
        <h3>${escapeHtml(task.label)}</h3>
      </div>
      <small>${questions.length} pitanja</small>
    </div>
    <div class="task-source physics-source-list">
      ${renderTaskContext(task, hasInteractiveCompletion)}
      ${hasInteractiveCompletion ? "" : questions.map(renderSourceQuestion).join("")}
    </div>
  `;

  bindResponseListeners();
  bindCompletionHotspots();
  renderQuickSelect();
  bindQuickSelectTracking();
}

function renderTaskContext(task, hasInteractiveCompletion) {
  if (hasInteractiveCompletion) return renderCompletionContext(task);
  return renderContextImages(task.sourceImages, "Tekst s prazninama i ponuđeni odgovori");
}

function hasInteractiveCompletionBlanks(task) {
  const questions = task?.questions || [];
  const images = completionSourceImages(task);
  return (
    task?.id === "nadopunjavanje" &&
    questions.length > 0 &&
    questions.every((question) =>
      validCompletionBlank(question.blank, images?.[question.blank?.sourceImageIndex]),
    )
  );
}

function completionSourceImages(task) {
  return task?.textImages?.length ? task.textImages : task?.sourceImages || [];
}

function validCompletionBlank(blank, source) {
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
    source?.url &&
      values.every((value) => Number.isFinite(value)) &&
      Number(blank?.width) > 0 &&
      Number(blank?.height) > 0 &&
      Number(crop?.width) > 0 &&
      Number(crop?.height) > 0 &&
      Number(blank?.x) >= 0 &&
      Number(blank?.y) >= 0 &&
      Number(blank?.x) < Number(crop?.width) &&
      Number(blank?.y) < Number(crop?.height),
  );
}

function renderCompletionContext(task) {
  const images = completionSourceImages(task);
  if (!images.length) return "";

  return `
    <section class="croatian-source-context croatian-completion-context" aria-label="Tekst s prazninama">
      ${images
        .map((image, index) =>
          renderCroppedImage(
            image,
            `Tekst s prazninama i ponuđeni odgovori, službeni prikaz ${index + 1}.`,
            {
              cropClass: "croatian-completion-crop",
              overlayHtml: renderCompletionHotspots(task, index),
            },
          ),
        )
        .join("")}
    </section>
  `;
}

function renderCompletionHotspots(task, sourceImageIndex) {
  const images = completionSourceImages(task);
  return (task.questions || [])
    .filter((question) => question.blank?.sourceImageIndex === sourceImageIndex)
    .map((question) => renderCompletionBlankButton(question, images[sourceImageIndex]))
    .join("");
}

function renderCompletionBlankButton(question, source) {
  const number = String(question.number);
  const answer = responses[number] || "";
  const stateClass = completionBlankStateClass(number, answer);

  return `
    <button
      class="croatian-completion-blank${stateClass}"
      id="pitanje-${escapeHtml(number)}"
      type="button"
      data-question-number="${escapeHtml(number)}"
      data-completion-question="${escapeHtml(number)}"
      aria-haspopup="dialog"
      aria-expanded="false"
      aria-label="${escapeHtml(completionBlankAriaLabel(number, answer))}"
      style="${completionBlankStyle(question.blank, source)}"
      ${simulation.inputDisabledAttribute()}
    >
      ${renderCompletionBlankContent(number, answer)}
    </button>
  `;
}

function completionBlankStateClass(question, answer) {
  const answeredClass = answer ? " croatian-completion-blank--answered" : "";
  if (!checked) return answeredClass;
  return `${answeredClass}${
    isCorrectAnswer(question, answer)
      ? " croatian-completion-blank--correct"
      : " croatian-completion-blank--wrong"
  }`;
}

function completionBlankStyle(blank, source) {
  const crop = source.crop;
  const paddingX = 3;
  const fieldHeight = 24;
  const left = Math.max(0, Number(blank.x) - paddingX);
  const top = Math.max(0, Number(blank.y) + Number(blank.height) - fieldHeight - 1);
  const width = Math.min(crop.width - left, Number(blank.width) + paddingX * 2);
  const height = Math.min(crop.height - top, fieldHeight);

  return [
    `left: ${(left / crop.width) * 100}%`,
    `top: ${(top / crop.height) * 100}%`,
    `width: ${(width / crop.width) * 100}%`,
    `height: ${(height / crop.height) * 100}%`,
  ].join("; ");
}

function renderCompletionBlankContent(question, answer) {
  const text = completionBlankDisplayText(question, answer);
  return `
    <span>${escapeHtml(text)}</span>
    <span class="croatian-completion-blank__chevron" aria-hidden="true"></span>
  `;
}

function completionBlankDisplayText(question, answer) {
  if (!answer) return "";
  return questionByNumber.get(String(question))?.options?.[answer] || answer;
}

function completionBlankAriaLabel(question, answer) {
  if (answer) return `Praznina ${question}, odabrano ${answer}. Promijeni odgovor.`;
  return `Praznina ${question}, odaberi odgovor.`;
}

function renderSourceQuestion(question) {
  const number = String(question.number);
  const sourceImage = renderCroppedImage(
    question.sourceImage,
    `Izvorni prikaz ${number}. pitanja iz službene PDF knjižice.`,
  );
  const completionPrompt = activeTaskTypeId === "nadopunjavanje"
    ? `<p>Odaberi odgovor za prazninu ${escapeHtml(number)}.</p>`
    : "";

  return `
    ${renderContextImages(question.contextImages, "Polazni tekst")}
    <article
      class="physics-source-question${sourceImage ? " physics-source-question--image" : ""}"
      id="pitanje-${escapeHtml(number)}"
      data-question-number="${escapeHtml(number)}"
    >
      ${sourceImage ? "" : `<h4>${escapeHtml(number)}</h4>`}
      <div class="physics-source-question__body">
        ${sourceImage || completionPrompt}
      </div>
      ${renderQuestion(number)}
    </article>
  `;
}

function renderContextImages(images = [], title) {
  if (!images.length) return "";
  return `
    <section class="croatian-source-context">
      <p class="eyebrow">${escapeHtml(title)}</p>
      ${images
        .map((image, index) =>
          renderCroppedImage(image, `${title}, službeni prikaz ${index + 1}.`),
        )
        .join("")}
    </section>
  `;
}

function renderCroppedImage(source, alt, options = {}) {
  const crop = source?.crop;
  const dimensions = [
    source?.width,
    source?.height,
    crop?.x,
    crop?.y,
    crop?.width,
    crop?.height,
  ].map(Number);
  if (!source?.url || dimensions.some((value) => !Number.isFinite(value) || value < 0)) return "";
  if (!source.width || !source.height || !crop.width || !crop.height) return "";

  const width = (source.width / crop.width) * 100;
  const offsetX = (-crop.x / source.width) * 100;
  const offsetY = (-crop.y / source.height) * 100;
  const cropClass = options.cropClass ? ` ${options.cropClass}` : "";

  return `
    <figure class="physics-source-figure">
      <div class="physics-source-crop${cropClass}" style="aspect-ratio: ${crop.width} / ${crop.height}">
        <img
          src="${escapeHtml(source.url)}"
          alt="${escapeHtml(alt)}"
          width="${source.width}"
          height="${source.height}"
          loading="lazy"
          decoding="async"
          style="width: ${width}%; transform: translate(${offsetX}%, ${offsetY}%);"
        >
        ${options.overlayHtml || ""}
      </div>
    </figure>
  `;
}

function bindResponseListeners() {
  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });
}

function bindCompletionHotspots() {
  document.querySelectorAll("[data-completion-question]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openCompletionPopover(button.dataset.completionQuestion, button);
    });
  });
}

function completionOptionsForQuestion(question) {
  const sourceOptions = question?.options || {};
  return completionOptionLetters.map((option) => ({
    option,
    text: sourceOptions[option] || "",
  }));
}

function openCompletionPopover(questionNumber, anchor) {
  if (simulation.finished) return;

  const question = questionByNumber.get(String(questionNumber));
  if (!question) return;

  closeCompletionPopover();
  anchor.setAttribute("aria-expanded", "true");
  const popover = document.createElement("div");
  popover.className = "croatian-completion-popover";
  popover.id = "croatian-completion-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `Odgovori za prazninu ${questionNumber}`);
  popover.innerHTML = renderCompletionPopover(questionNumber, question);
  document.body.append(popover);
  placeCompletionPopover(popover, anchor);

  popover.querySelector("[data-completion-popover-close]")?.addEventListener("click", () => {
    closeCompletionPopover();
    anchor.focus();
  });

  popover.querySelectorAll("[data-completion-option]").forEach((button) => {
    button.addEventListener("click", () => {
      updateResponse(questionNumber, button.dataset.completionOption);
      anchor.focus();
    });
  });

  const selected = popover.querySelector(".croatian-completion-popover__option--selected");
  (selected || popover.querySelector("[data-completion-option]"))?.focus();
}

function renderCompletionPopover(questionNumber, question) {
  const answer = responses[questionNumber] || "";

  return `
    <div class="croatian-completion-popover__heading">
      <strong>${escapeHtml(questionNumber)}</strong>
      <button type="button" data-completion-popover-close aria-label="Zatvori odabir">&times;</button>
    </div>
    <div class="croatian-completion-popover__options">
      ${completionOptionsForQuestion(question)
        .map(({ option, text }) => {
          const selectedClass =
            option === answer ? " croatian-completion-popover__option--selected" : "";
          return `
            <button
              class="croatian-completion-popover__option${selectedClass}"
              type="button"
              data-completion-option="${option}"
            >
              <strong>${option}</strong>
              <span>${escapeHtml(text || `Odgovor ${option}`)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function placeCompletionPopover(popover, anchor) {
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

function closeCompletionPopover() {
  document.querySelector("#croatian-completion-popover")?.remove();
  document.querySelectorAll("[data-completion-question][aria-expanded='true']").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function closeCompletionPopoverOnDocumentClick(event) {
  const popover = document.querySelector("#croatian-completion-popover");
  if (!popover) return;
  if (popover.contains(event.target) || event.target.closest("[data-completion-question]")) return;
  closeCompletionPopover();
}

function quickSelectGroupNumber(question) {
  return String(question).split(".")[0];
}

function quickSelectItems() {
  const items = [];
  for (const question of questionsForTaskType()) {
    const number = String(question);
    const group = quickSelectGroupNumber(number);
    const previousItem = items[items.length - 1];
    if (previousItem?.group === group) {
      previousItem.questions.push(number);
      continue;
    }

    items.push({
      label: group,
      target: number,
      group,
      questions: [number],
    });
  }
  return items;
}

function quickSelectAnswerState(item) {
  const answeredCountForItem = item.questions.filter((question) => responses[question]).length;
  if (answeredCountForItem === item.questions.length) return "odgovoreno";
  if (answeredCountForItem > 0) return "djelomično odgovoreno";
  return "nije odgovoreno";
}

function activeQuickSelectGroup() {
  return quickSelectGroupNumber(activeQuestionNumber);
}

function renderQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const items = quickSelectItems();
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = items.length <= 2;

  quickSelect.innerHTML = items
    .map((item) => {
      const isAnswered = item.questions.every((question) => responses[question]);
      const stateClass = isAnswered ? " question-quickselect__link--answered" : "";
      const resultClass = checked
        ? item.questions.every((question) => isCorrectAnswer(question, responses[question]))
          ? " question-quickselect__link--correct"
          : " question-quickselect__link--wrong"
        : "";
      const activeClass =
        item.group === activeQuickSelectGroup() ? " question-quickselect__link--active" : "";
      const answerState = quickSelectAnswerState(item);
      const itemLabel = item.questions.length > 1 ? "Zadatak" : "Pitanje";
      return `
        <a
          class="question-quickselect__link${stateClass}${resultClass}${activeClass}"
          href="#pitanje-${escapeHtml(item.target)}"
          data-quick-question="${escapeHtml(item.target)}"
          data-quick-group="${escapeHtml(item.group)}"
          aria-label="${itemLabel} ${escapeHtml(item.label)}, ${answerState}"
          ${activeClass ? 'aria-current="true"' : ""}
        >
          ${escapeHtml(item.label)}
        </a>
      `;
    })
    .join("");

  quickSelect.querySelectorAll("[data-quick-question]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const question = link.dataset.quickQuestion;
      const target = document.getElementById(`pitanje-${question}`);
      activeQuestionNumber = question;
      updateQuickSelectActiveState();
      target?.scrollIntoView({ block: "start", behavior: "auto" });
      if (target) history.replaceState(null, "", `#pitanje-${question}`);
    });
  });
}

function bindQuickSelectTracking() {
  window.removeEventListener("scroll", queueActiveQuestionUpdate);
  window.addEventListener("scroll", queueActiveQuestionUpdate, { passive: true });
  updateActiveQuestionFromScroll();
}

function queueActiveQuestionUpdate() {
  if (quickSelectFrame) return;
  quickSelectFrame = window.requestAnimationFrame(updateActiveQuestionFromScroll);
}

function updateActiveQuestionFromScroll() {
  quickSelectFrame = undefined;
  const questions = [...document.querySelectorAll("[data-question-number]")];
  if (!questions.length) return;

  const focusLine = Math.min(window.innerHeight * 0.28, 240);
  let activeQuestion = questions[0];
  for (const question of questions) {
    if (question.getBoundingClientRect().top > focusLine) break;
    activeQuestion = question;
  }

  const nextQuestionNumber = activeQuestion.dataset.questionNumber;
  if (nextQuestionNumber === activeQuestionNumber) return;
  activeQuestionNumber = nextQuestionNumber;
  updateQuickSelectActiveState();
}

function updateQuickSelectActiveState() {
  const activeGroup = activeQuickSelectGroup();
  document.querySelectorAll("[data-quick-question]").forEach((link) => {
    const linkGroup = link.dataset.quickGroup || link.dataset.quickQuestion;
    const isActive = linkGroup === activeGroup;
    link.classList.toggle("question-quickselect__link--active", isActive);
    if (isActive) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function renderQuestion(question) {
  const answer = responses[question] || "";
  const resultClass = checked
    ? isCorrectAnswer(question, answer)
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  return `
    <fieldset class="physics-inline-response ${resultClass}">
      <legend>Odgovor na ${escapeHtml(question)}. pitanje</legend>
      <span class="physics-inline-response__label">Odaberi odgovor</span>
      <div class="choice-list">
        ${["A", "B", "C", "D"]
          .map((option) => renderChoice(question, option, answer))
          .join("")}
      </div>
      ${renderFeedback(question, answer)}
    </fieldset>
  `;
}

function renderChoice(question, option, answer) {
  const selected = option === answer;
  const correct = isCorrectAnswer(question, option);
  let resultClass = "";
  if (checked && correct) resultClass = " answer-choice--correct";
  if (checked && selected && !correct) resultClass = " answer-choice--wrong";

  return `
    <label class="answer-choice${resultClass}">
      <input
        data-question="${escapeHtml(question)}"
        type="radio"
        name="answer-${escapeHtml(question)}"
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
  const answers = correctAnswers(question);
  if (answers.includes(answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${answers.join(" ili ")}.</small>`;
}

function updateResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  closeCompletionPopover();
  checked = false;
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) responses[question] = normalizedAnswer;
  else delete responses[question];
  saveResponses();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderQuickSelect();
  if (wasChecked) renderTaskTypeContent();
  else syncRenderedResponse(question);
}

function syncRenderedResponse(question) {
  const answer = responses[question] || "";

  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    if (input.dataset.question === question) input.checked = input.value === answer;
  });

  document.querySelectorAll("[data-completion-question]").forEach((button) => {
    const number = button.dataset.completionQuestion;
    const buttonAnswer = responses[number] || "";
    button.innerHTML = renderCompletionBlankContent(number, buttonAnswer);
    button.classList.toggle("croatian-completion-blank--answered", Boolean(buttonAnswer));
    button.classList.remove(
      "croatian-completion-blank--correct",
      "croatian-completion-blank--wrong",
    );
    button.setAttribute("aria-label", completionBlankAriaLabel(number, buttonAnswer));
  });
}

function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    simulation.finish("submitted");
    return;
  }

  if (checked) {
    checked = false;
    closeResultsDialog();
    renderTaskTypeNavigation();
    renderSolverSummary();
    renderTaskTypeContent();
    return;
  }

  checked = true;
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  openResultsDialog();
}

function finishSimulation(reason) {
  checked = true;
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();

  if (reason === "submitted") recordSubmittedSimulation();
  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }
  openResultsDialog();
}

function recordSubmittedSimulation() {
  if (!window.AsistentProfile) return;

  const total = allQuestions().length;
  window.AsistentProfile.recordSimulationAttempt({
    solver: "croatian-choice",
    subject: "Hrvatski jezik",
    part: "Čitanje, književnost i hrvatski jezik",
    examId: solverExam.id,
    year: solverExam.year,
    term: solverExam.term,
    level: solverExam.level,
    schoolYear: solverExam.schoolYear,
    durationMinutes: solverExam.durationMinutes,
    answered: answeredCount(),
    totalQuestions: total,
    score: totalScore(),
    maxScore: total,
    percentage: scorePercentage(),
    checkingSupported: true,
  });
}

function totalScore() {
  return allQuestions().filter((question) => isCorrectAnswer(question, responses[question])).length;
}

function scorePercentage() {
  const maximum = allQuestions().length;
  return maximum ? Math.round((totalScore() / maximum) * 100) : 0;
}

function openResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog) return;

  document.querySelector("#exam-results-percentage").textContent = `${scorePercentage()}%`;
  document.querySelector("#exam-results-score").textContent = `${totalScore()}/${allQuestions().length}`;
  dialog.hidden = false;
  document.body.classList.add("exam-results-dialog-open");
  document.querySelector("#close-exam-results").focus();
}

function closeResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog || dialog.hidden) return;

  dialog.hidden = true;
  document.body.classList.remove("exam-results-dialog-open");
  document.querySelector("#check-answers")?.focus();
}

function closeResultsDialogOnEscape(event) {
  if (event.key !== "Escape") return;
  closeCompletionPopover();
  closeResultsDialog();
}

const id = selectedExamId();
if (!id) {
  window.location.replace(croatianSubjectUrl());
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam, selectedTaskTypeId(exam));
  else renderMissingExam();
}
