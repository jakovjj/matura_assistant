(() => {
  const CROP_SELECTOR = ".physics-source-crop, .pdf-source-crop";
  const INTERACTIVE_SELECTOR =
    "a, button, input, label, select, textarea, [role='button'], [data-completion-question]";
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;
  const fallbackRenderSourceImageCrop = window.renderSourceImageCrop;

  function escapeHtml(value) {
    return String(value)
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

  function validSegments(source) {
    const crop = source?.crop;
    const segments = Array.isArray(source?.segments) ? source.segments : [];
    if (segments.length < 2 || !validSourceCrop(source, crop)) return [];

    const cropXMax = Number(crop.x) + Number(crop.width);
    const cropYMax = Number(crop.y) + Number(crop.height);
    const valid = segments.every((segment) => {
      if (!validSourceCrop(source, segment)) return false;
      const x = Number(segment.x);
      const y = Number(segment.y);
      const width = Number(segment.width);
      const height = Number(segment.height);
      return (
        x >= Number(crop.x) &&
        y >= Number(crop.y) &&
        x + width <= cropXMax &&
        y + height <= cropYMax &&
        x === Number(crop.x) &&
        width === Number(crop.width)
      );
    });
    return valid ? segments : [];
  }

  function sourceCropImage(source, crop, alt, loading, index = 0) {
    const width = (Number(source.width) / Number(crop.width)) * 100;
    const offsetX = (-Number(crop.x) / Number(source.width)) * 100;
    const offsetY = (-Number(crop.y) / Number(source.height)) * 100;
    const accessibleAlt = index === 0 ? `alt="${escapeHtml(alt)}"` : 'alt="" aria-hidden="true"';
    return `
      <img
        src="${escapeHtml(source.url)}"
        ${accessibleAlt}
        width="${Number(source.width)}"
        height="${Number(source.height)}"
        loading="${loading}"
        decoding="async"
        style="width: ${width}%; transform: translate(${offsetX}%, ${offsetY}%);"
      >
    `;
  }

  window.renderSourceImageCrop = function renderSourceImageCrop(source, alt, options = {}) {
    try {
      const crop = source?.crop;
      if (!validSourceCrop(source, crop)) return "";

      const variant = options.variant === "pdf" ? "pdf" : "physics";
      const figureClass = `${variant}-source-figure`;
      const cropBaseClass = `${variant}-source-crop`;
      const cropClass = options.cropClass ? ` ${options.cropClass}` : "";
      const overlayHtml = options.overlayHtml || "";
      const segments = overlayHtml ? [] : validSegments(source);
      const renderedCrops = segments.length ? segments : [crop];
      const displayedHeight = renderedCrops.reduce(
        (total, segment) => total + Number(segment.height),
        0,
      );
      const segmentedClass = segments.length ? " source-crop--segmented" : "";
      const displayWidth = options.constrainWidth
        ? `width: min(100%, ${Math.min(820, Math.max(260, Math.ceil(Number(crop.width))))}px); `
        : "";
      const compactStyle = options.compact ? "min-width: 0; " : "";
      const loading = options.loading === "eager" ? "eager" : "lazy";
      const imageHtml = segments.length
        ? segments
            .map(
              (segment, index) => `
                <div
                  class="source-crop-segment"
                  style="aspect-ratio: ${segment.width} / ${segment.height}"
                >
                  ${sourceCropImage(source, segment, alt, loading, index)}
                </div>
              `,
            )
            .join("")
        : sourceCropImage(source, crop, alt, loading);

      return `
        <figure class="${figureClass}">
          <div
            class="${cropBaseClass}${cropClass}${segmentedClass}"
            style="${displayWidth}${compactStyle}aspect-ratio: ${crop.width} / ${displayedHeight}"
          >
            ${imageHtml}
            ${overlayHtml}
          </div>
        </figure>
      `;
    } catch (error) {
      console.error("Could not render segmented source image crop.", error);
      return typeof fallbackRenderSourceImageCrop === "function"
        ? fallbackRenderSourceImageCrop(source, alt, options)
        : "";
    }
  };

  let dialog;
  let viewport;
  let canvas;
  let cropClone;
  let previousFocus;
  let state = createState();
  const pointers = new Map();

  function createState() {
    return {
      scale: 1,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
  }

  function icon(name) {
    if (typeof window.renderLucideIcon === "function") {
      return window.renderLucideIcon(name, "source-image-viewer__icon");
    }
    return "";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function cropAspect(crop) {
    const ratio = getComputedStyle(crop).aspectRatio || crop.style.aspectRatio || "";
    const parts = ratio.split("/").map((part) => Number(part.trim()));
    if (parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0)) {
      return parts[0] / parts[1];
    }

    const rect = crop.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect.width / rect.height;
    return 1;
  }

  function ensureDialog() {
    if (dialog) return;

    dialog = document.createElement("div");
    dialog.className = "source-image-viewer";
    dialog.hidden = true;
    dialog.innerHTML = `
      <div class="source-image-viewer__backdrop" data-source-image-viewer-close></div>
      <section
        class="source-image-viewer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-image-viewer-title"
      >
        <div class="source-image-viewer__toolbar">
          <strong id="source-image-viewer-title">Prikaz zadatka</strong>
          <div class="source-image-viewer__controls">
            <button type="button" class="source-image-viewer__button" data-source-image-viewer-zoom-out aria-label="Smanji" title="Smanji">
              ${icon("zoom-out")}
            </button>
            <button type="button" class="source-image-viewer__button" data-source-image-viewer-reset aria-label="Vrati prikaz" title="Vrati prikaz">
              ${icon("rotate-ccw")}
            </button>
            <button type="button" class="source-image-viewer__button" data-source-image-viewer-zoom-in aria-label="Povećaj" title="Povećaj">
              ${icon("zoom-in")}
            </button>
            <button type="button" class="source-image-viewer__button" data-source-image-viewer-close aria-label="Zatvori" title="Zatvori">
              ${icon("x")}
            </button>
          </div>
        </div>
        <div class="source-image-viewer__viewport" tabindex="0">
          <div class="source-image-viewer__canvas"></div>
        </div>
      </section>
    `;
    document.body.append(dialog);

    viewport = dialog.querySelector(".source-image-viewer__viewport");
    canvas = dialog.querySelector(".source-image-viewer__canvas");

    dialog.addEventListener("click", handleDialogClick);
    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", handlePointerEnd);
    viewport.addEventListener("pointercancel", handlePointerEnd);
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("resize", fitActiveCrop);
  }

  function handleDialogClick(event) {
    if (event.target.closest("[data-source-image-viewer-close]")) {
      closeViewer();
      return;
    }
    if (event.target.closest("[data-source-image-viewer-zoom-in]")) {
      zoomAt(state.scale * 1.25, 0, 0);
      return;
    }
    if (event.target.closest("[data-source-image-viewer-zoom-out]")) {
      zoomAt(state.scale / 1.25, 0, 0);
      return;
    }
    if (event.target.closest("[data-source-image-viewer-reset]")) {
      resetView();
    }
  }

  function prepareClone(sourceCrop) {
    cropClone = sourceCrop.cloneNode(true);
    cropClone.removeAttribute("id");
    cropClone.removeAttribute("role");
    cropClone.removeAttribute("tabindex");
    cropClone.removeAttribute("aria-label");
    cropClone.removeAttribute("title");
    cropClone.classList.add("source-image-viewer__crop");
    cropClone.setAttribute("aria-hidden", "true");
    cropClone.querySelectorAll("a, button, input, select, textarea").forEach((control) => {
      control.setAttribute("tabindex", "-1");
      control.setAttribute("aria-hidden", "true");
    });
  }

  function fitActiveCrop() {
    if (!cropClone || dialog.hidden) return;

    const rect = viewport.getBoundingClientRect();
    const aspect = cropAspect(cropClone);
    const width = Math.max(1, Math.min(rect.width, rect.height * aspect));
    const height = Math.max(1, width / aspect);

    state.width = width;
    state.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    cropClone.style.width = "100%";
    cropClone.style.maxWidth = "none";
    cropClone.style.minWidth = "0";
    clampPan();
    updateTransform();
  }

  function openViewer(sourceCrop) {
    if (!sourceCrop?.querySelector("img")) return;

    ensureDialog();
    previousFocus = document.activeElement;
    state = createState();
    pointers.clear();
    prepareClone(sourceCrop);
    canvas.replaceChildren(cropClone);
    dialog.hidden = false;
    document.body.classList.add("source-image-viewer-open");
    requestAnimationFrame(() => {
      fitActiveCrop();
      viewport.focus({ preventScroll: true });
    });
  }

  function closeViewer() {
    if (!dialog || dialog.hidden) return;

    dialog.hidden = true;
    document.body.classList.remove("source-image-viewer-open");
    pointers.clear();
    viewport.classList.remove("source-image-viewer__viewport--dragging");
    canvas.replaceChildren();
    cropClone = null;
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
  }

  function resetView() {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    updateTransform();
  }

  function clampPan() {
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const overflowX = Math.max(0, (state.width * state.scale - rect.width) / 2);
    const overflowY = Math.max(0, (state.height * state.scale - rect.height) / 2);
    const slack = 48;
    state.x = clamp(state.x, -(overflowX + slack), overflowX + slack);
    state.y = clamp(state.y, -(overflowY + slack), overflowY + slack);
  }

  function updateTransform() {
    clampPan();
    canvas.style.transform = `translate(calc(-50% + ${state.x}px), calc(-50% + ${state.y}px)) scale(${state.scale})`;
    dialog
      .querySelector("[data-source-image-viewer-zoom-out]")
      ?.toggleAttribute("disabled", state.scale <= MIN_SCALE);
    dialog
      .querySelector("[data-source-image-viewer-zoom-in]")
      ?.toggleAttribute("disabled", state.scale >= MAX_SCALE);
  }

  function zoomAt(nextScale, pointX, pointY) {
    const oldScale = state.scale;
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (scale === oldScale) return;

    const contentX = (pointX - state.x) / oldScale;
    const contentY = (pointY - state.y) / oldScale;
    state.scale = scale;
    state.x = pointX - contentX * scale;
    state.y = pointY - contentY * scale;
    updateTransform();
  }

  function viewportPoint(event) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  }

  function pointerGesture() {
    const active = [...pointers.values()];
    if (active.length === 1) return { count: 1, x: active[0].x, y: active[0].y };
    if (active.length < 2) return { count: 0 };

    const first = active[0];
    const second = active[1];
    return {
      count: 2,
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      distance: Math.hypot(first.x - second.x, first.y - second.y),
    };
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;

    viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, viewportPoint(event));
    viewport.classList.add("source-image-viewer__viewport--dragging");
  }

  function handlePointerMove(event) {
    if (!pointers.has(event.pointerId)) return;

    const previous = pointerGesture();
    pointers.set(event.pointerId, viewportPoint(event));
    const current = pointerGesture();
    if (!current.count || !previous.count) return;

    if (current.count === 1 && previous.count === 1) {
      state.x += current.x - previous.x;
      state.y += current.y - previous.y;
      updateTransform();
      return;
    }

    if (current.count === 2 && previous.count === 2 && previous.distance > 0) {
      state.x += current.x - previous.x;
      state.y += current.y - previous.y;
      zoomAt(state.scale * (current.distance / previous.distance), current.x, current.y);
    }
  }

  function handlePointerEnd(event) {
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      viewport.classList.remove("source-image-viewer__viewport--dragging");
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    const point = viewportPoint(event);
    const factor = event.deltaY > 0 ? 0.88 : 1.12;
    zoomAt(state.scale * factor, point.x, point.y);
  }

  function handleDoubleClick(event) {
    const point = viewportPoint(event);
    zoomAt(state.scale > 1.05 ? 1 : 2, point.x, point.y);
  }

  function cropClicked(event) {
    const crop = event.target.closest(CROP_SELECTOR);
    if (!crop || !document.body.classList.contains("solver-page")) return;
    if (crop.closest(".source-image-viewer")) return;
    const interactiveTarget = event.target.closest(INTERACTIVE_SELECTOR);
    if (interactiveTarget && interactiveTarget !== crop) return;
    openViewer(crop);
  }

  function cropKeydown(event) {
    const crop = event.target.closest(CROP_SELECTOR);
    if (!crop || !document.body.classList.contains("solver-page")) return;
    if (crop.closest(".source-image-viewer")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openViewer(crop);
  }

  function viewerKeydown(event) {
    if (!dialog || dialog.hidden) return;

    if (event.key === "Escape") {
      closeViewer();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAt(state.scale * 1.25, 0, 0);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomAt(state.scale / 1.25, 0, 0);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      resetView();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      state.x += event.key === "ArrowLeft" ? 36 : -36;
      updateTransform();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      state.y += event.key === "ArrowUp" ? 36 : -36;
      updateTransform();
    }
  }

  function enhanceCrops(root = document) {
    root.querySelectorAll?.(CROP_SELECTOR).forEach((crop) => {
      if (crop.closest(".source-image-viewer")) return;
      if (crop.querySelector(INTERACTIVE_SELECTOR)) return;
      crop.setAttribute("role", "button");
      crop.setAttribute("tabindex", "0");
      crop.setAttribute("aria-label", "Otvori uvećani prikaz zadatka");
      crop.setAttribute("title", "Otvori uvećani prikaz");
    });
  }

  document.addEventListener("click", cropClicked);
  document.addEventListener("keydown", cropKeydown);
  document.addEventListener("keydown", viewerKeydown);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceCrops(node);
      });
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      enhanceCrops();
      observer.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    enhanceCrops();
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
