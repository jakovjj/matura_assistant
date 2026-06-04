(() => {
  function formatRemainingTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  window.createExamSimulation = ({ onFinish }) => {
    const active =
      new URLSearchParams(window.location.search).get("nacin") === "simulacija";
    let deadline = 0;
    let finishReason = "";
    let timerId = 0;

    function statusText() {
      if (finishReason === "submitted") return "Simulacija predana";
      if (finishReason === "expired") return "Vrijeme je isteklo";
      if (!deadline) return "";

      const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      return `Preostalo ${formatRemainingTime(remainingSeconds)}`;
    }

    function updateTimer() {
      document.querySelectorAll("[data-simulation-timer]").forEach((element) => {
        element.textContent = statusText();
      });

      if (deadline && Date.now() >= deadline) finish("expired");
    }

    function finish(reason) {
      if (!active || finishReason) return;

      finishReason = reason;
      window.clearInterval(timerId);
      timerId = 0;
      updateTimer();
      onFinish(reason);
    }

    return {
      active,
      finish,
      get finished() {
        return Boolean(finishReason);
      },
      inputDisabledAttribute() {
        return finishReason ? " disabled" : "";
      },
      renderNotice() {
        if (!active) return "";

        return `
          <p class="practice-notice simulation-mode-notice">
            <strong>Simulacija mature:</strong> vrijeme je ograničeno, a odgovori i
            napredak iz ovoga pokušaja ne spremaju se.
          </p>
        `;
      },
      renderTimer() {
        if (!active) return "";

        return `
          <div class="simulation-timer">
            <svg class="simulation-timer__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <use href="#clock"></use>
            </svg>
            <span>
              <span>Simulacija mature</span>
              <strong data-simulation-timer>${statusText()}</strong>
            </span>
          </div>
        `;
      },
      start(durationMinutes) {
        if (!active || deadline || finishReason) return;

        deadline = Date.now() + Number(durationMinutes) * 60 * 1000;
        updateTimer();
        timerId = window.setInterval(updateTimer, 1000);
      },
    };
  };
})();
