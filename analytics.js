(() => {
  const clarityTagId = "x0a1kkmiqz";

  window.clarity = window.clarity || function clarityQueue() {
    (window.clarity.q = window.clarity.q || []).push(arguments);
  };

  function loadClarity() {
    if (document.querySelector(`[data-clarity-tag="${clarityTagId}"]`)) return;

    const script = document.createElement("script");
    script.async = true;
    script.dataset.clarityTag = clarityTagId;
    script.src = `https://www.clarity.ms/tag/${clarityTagId}`;
    document.head.append(script);
  }

  function scheduleClarity() {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadClarity, { timeout: 3000 });
      return;
    }

    window.setTimeout(loadClarity, 1200);
  }

  if (document.readyState === "complete") {
    scheduleClarity();
  } else {
    window.addEventListener("load", scheduleClarity, { once: true });
  }
})();
