(() => {
  function escapeAttribute(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function icon(name) {
    if (window.renderLucideIcon) return window.renderLucideIcon(name, "inline-check-button__icon");

    return `
      <svg class="inline-check-button__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <use href="./assets/lucide-icons.svg#${name}"></use>
      </svg>
    `;
  }

  window.isExcludedExamTask = (question) => question?.excluded === true;

  window.renderExcludedExamTaskNotice = () => `
    <p class="excluded-task-notice" role="note">
      Ovaj je zadatak izuzet iz bodovanja. Preskoči ga i nastavi na sljedeći zadatak.
    </p>
  `;

  // Shared per-task self-check used by every solver outside simulation mode.
  // It tracks which individual tasks the user has revealed and renders the
  // "Provjeri" button. Score aggregation stays in each solver so the
  // running result can include each checked task.
  window.createTaskSelfCheck = () => {
    const checkedQuestions = new Set();

    return {
      has(question) {
        return checkedQuestions.has(String(question));
      },
      get size() {
        return checkedQuestions.size;
      },
      reset() {
        checkedQuestions.clear();
      },
      delete(question) {
        checkedQuestions.delete(String(question));
      },
      toggle(question) {
        const key = String(question);
        if (checkedQuestions.has(key)) {
          checkedQuestions.delete(key);
          return false;
        }
        checkedQuestions.add(key);
        return true;
      },
      // Renders the inline button beside a task. Hidden during simulation or
      // once the whole exam has been checked, since the solution is already
      // revealed in those states. Practice mode allows revealing a solution
      // before the user selects an answer.
      renderButton(question, { disabled = false, hidden = false } = {}) {
        if (hidden) return "";
        const on = checkedQuestions.has(String(question));
        const label = on ? "Sakrij rješenje" : "Provjeri";
        return `
          <button
            class="inline-check-button${on ? " inline-check-button--active" : ""}"
            type="button"
            data-self-check="${escapeAttribute(question)}"
            aria-pressed="${on ? "true" : "false"}"
            ${disabled ? "disabled" : ""}
          >
            ${icon(on ? "eye-off" : "circle-check")}
            <span>${label}</span>
          </button>
        `;
      },
      bind(root, onToggle) {
        if (!root) return;
        root.querySelectorAll("[data-self-check]").forEach((button) => {
          button.addEventListener("click", () => onToggle(button.dataset.selfCheck));
        });
      },
    };
  };
})();
