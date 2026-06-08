(() => {
  const source = {
    url: "/files/interactive/croatian-choice/hrvatski-2025-ljetni-rok/page-34.png",
    width: 1191,
    height: 1684,
  };
  const textCrop = { x: 72, y: 185, width: 1047, height: 342 };
  const letters = ["A", "B", "C", "D"];
  const questions = [
    {
      number: "58.1",
      blank: { x: 357, y: 19, width: 99, height: 31 },
      answerCrop: { x: 205, y: 632, width: 300, height: 30, rowGap: 32 },
    },
    {
      number: "58.2",
      blank: { x: 373, y: 80, width: 98, height: 32 },
      answerCrop: { x: 205, y: 912, width: 300, height: 30, rowGap: 32 },
    },
    {
      number: "58.3",
      blank: { x: 880, y: 111, width: 105, height: 31 },
      answerCrop: { x: 205, y: 1192, width: 350, height: 30, rowGap: 32 },
    },
    {
      number: "58.4",
      blank: { x: 122, y: 235, width: 99, height: 31 },
      answerCrop: { x: 715, y: 632, width: 330, height: 30, rowGap: 32 },
    },
    {
      number: "58.5",
      blank: { x: 367, y: 296, width: 105, height: 31 },
      answerCrop: { x: 715, y: 912, width: 380, height: 30, rowGap: 32 },
    },
  ];

  const app = document.querySelector("#completion-prototype");
  const fullTextDialog = document.querySelector("#full-text-dialog");
  const fullTextBody = document.querySelector("[data-full-text-body]");
  const responses = {};
  let currentIndex = 0;
  let advanceTimer;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cropImage(crop, className = "") {
    const imageWidth = (source.width / crop.width) * 100;
    const offsetX = (-crop.x / source.width) * 100;
    const offsetY = (-crop.y / source.height) * 100;

    return `
      <div
        class="source-crop${className ? ` ${className}` : ""}"
        style="aspect-ratio: ${crop.width} / ${crop.height}"
      >
        <img
          src="${source.url}"
          alt=""
          width="${source.width}"
          height="${source.height}"
          draggable="false"
          style="width: ${imageWidth}%; transform: translate(${offsetX}%, ${offsetY}%);"
        >
      </div>
    `;
  }

  function progressMarkup() {
    return questions
      .map((question, index) => {
        const activeClass = index === currentIndex ? " step-progress__button--active" : "";
        const answeredClass = responses[question.number]
          ? " step-progress__button--answered"
          : "";
        const state = responses[question.number] ? ", odgovoreno" : ", nije odgovoreno";

        return `
          <button
            class="step-progress__button${answeredClass}${activeClass}"
            type="button"
            data-step="${index}"
            aria-label="Praznina ${escapeHtml(question.number)}${state}"
            ${index === currentIndex ? 'aria-current="step"' : ""}
          >
            ${index + 1}
          </button>
        `;
      })
      .join("");
  }

  function textMarkup(question, className = "text-canvas") {
    const blank = question.blank;
    const left = (blank.x / textCrop.width) * 100;
    const top = (blank.y / textCrop.height) * 100;
    const width = (blank.width / textCrop.width) * 100;
    const height = (blank.height / textCrop.height) * 100;

    return `
      <div class="${className}">
        ${cropImage(textCrop)}
        <span
          class="active-blank"
          data-active-blank
          style="left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%;"
          aria-hidden="true"
        ></span>
      </div>
    `;
  }

  function answerRowsMarkup(question) {
    const selected = responses[question.number] || "";

    return letters
      .map((letter, index) => {
        const crop = {
          x: question.answerCrop.x,
          y: question.answerCrop.y + question.answerCrop.rowGap * index,
          width: question.answerCrop.width,
          height: question.answerCrop.height,
        };
        const selectedClass = selected === letter ? " option-button--selected" : "";

        return `
          <button
            class="option-button${selectedClass}"
            type="button"
            data-answer="${letter}"
            aria-label="Odgovor ${letter} za prazninu ${escapeHtml(question.number)}"
            aria-pressed="${selected === letter}"
          >
            <div
              class="option-source"
              style="--source-width: ${crop.width}px"
              aria-hidden="true"
            >
              ${cropImage(crop)}
            </div>
            <span class="option-button__mark" aria-hidden="true">✓</span>
          </button>
        `;
      })
      .join("");
  }

  function render() {
    clearTimeout(advanceTimer);
    const question = questions[currentIndex];
    const answered = Object.keys(responses).length;

    app.innerHTML = `
      <section class="completion-card" aria-labelledby="prototype-step-title">
        <nav class="step-progress" aria-label="Praznine u zadatku">
          ${progressMarkup()}
        </nav>

        <div class="step-heading">
          <div>
            <span>Aktivna praznina</span>
            <h2 id="prototype-step-title">${escapeHtml(question.number)}</h2>
          </div>
          <strong>${currentIndex + 1} od ${questions.length}</strong>
        </div>

        <section class="text-panel" aria-label="Povećani službeni tekst">
          <div class="text-panel__toolbar">
            <span>Praznina je centrirana. Povuci tekst lijevo ili desno za više konteksta.</span>
            <button class="text-action" type="button" data-show-full-text>
              Cijeli tekst
            </button>
          </div>
          <div class="text-viewport" data-text-viewport tabindex="0">
            ${textMarkup(question)}
          </div>
        </section>

        <section class="answer-section" aria-label="Ponuđeni odgovori">
          <div class="answer-section__heading">
            <strong>Odaberi odgovor</strong>
            <button
              class="clear-answer"
              type="button"
              data-clear-answer
              ${responses[question.number] ? "" : "hidden"}
            >
              Poništi
            </button>
          </div>
          <div class="option-list">
            ${answerRowsMarkup(question)}
          </div>
        </section>

        <p class="step-status" aria-live="polite">
          <strong>${answered}/${questions.length}</strong> odgovoreno
          ${answered === questions.length ? " · sve praznine imaju odgovor" : ""}
        </p>

        <nav class="step-navigation" aria-label="Kretanje između praznina">
          <button type="button" data-previous ${currentIndex === 0 ? "disabled" : ""}>
            Prethodna
          </button>
          <button
            type="button"
            data-next
            ${currentIndex === questions.length - 1 ? "disabled" : ""}
          >
            Sljedeća
          </button>
        </nav>
      </section>
    `;

    bindEvents();
    centerActiveBlank(false);
  }

  function bindEvents() {
    app.querySelectorAll("[data-step]").forEach((button) => {
      button.addEventListener("click", () => goToStep(Number(button.dataset.step)));
    });
    app.querySelectorAll("[data-answer]").forEach((button) => {
      button.addEventListener("click", () => selectAnswer(button.dataset.answer));
    });
    app.querySelector("[data-clear-answer]")?.addEventListener("click", clearAnswer);
    app.querySelector("[data-previous]")?.addEventListener("click", () => goToStep(currentIndex - 1));
    app.querySelector("[data-next]")?.addEventListener("click", () => goToStep(currentIndex + 1));
    app.querySelector("[data-show-full-text]")?.addEventListener("click", showFullText);
  }

  function goToStep(index) {
    if (index < 0 || index >= questions.length || index === currentIndex) return;
    currentIndex = index;
    render();
  }

  function selectAnswer(answer) {
    const question = questions[currentIndex];
    const changed = responses[question.number] !== answer;
    responses[question.number] = answer;
    render();

    if (changed && currentIndex < questions.length - 1) {
      advanceTimer = window.setTimeout(() => {
        currentIndex += 1;
        render();
      }, 420);
    }
  }

  function clearAnswer() {
    delete responses[questions[currentIndex].number];
    render();
  }

  function centerActiveBlank(smooth) {
    window.requestAnimationFrame(() => {
      const viewport = app.querySelector("[data-text-viewport]");
      const marker = app.querySelector("[data-active-blank]");
      if (!viewport || !marker) return;

      const target = marker.offsetLeft + marker.offsetWidth / 2 - viewport.clientWidth / 2;
      viewport.scrollTo({
        left: Math.max(0, target),
        behavior: smooth ? "smooth" : "auto",
      });
    });
  }

  function showFullText() {
    fullTextBody.innerHTML = `
      <div class="full-text-canvas">
        ${cropImage(textCrop)}
      </div>
    `;
    fullTextDialog.showModal();
  }

  document.querySelector("[data-close-full-text]")?.addEventListener("click", () => {
    fullTextDialog.close();
  });
  fullTextDialog.addEventListener("click", (event) => {
    if (event.target === fullTextDialog) fullTextDialog.close();
  });

  render();
})();
