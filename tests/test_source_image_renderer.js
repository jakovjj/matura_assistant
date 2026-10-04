const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  window: {},
  document: {
    readyState: "loading",
    addEventListener() {},
  },
  MutationObserver: class {
    observe() {}
  },
};

vm.runInNewContext(fs.readFileSync("source-image-viewer.js", "utf8"), context);

const source = {
  url: "page.png",
  width: 1000,
  height: 1600,
  crop: { x: 100, y: 200, width: 800, height: 1000 },
  segments: [
    { x: 100, y: 200, width: 800, height: 120 },
    { x: 100, y: 1100, width: 800, height: 100 },
  ],
};

const compact = context.window.renderSourceImageCrop(source, "Zadatak");
if (!compact.includes("source-crop--segmented") || !compact.includes("800 / 220")) {
  throw new Error("Segmented source crop was not rendered");
}

const footerSource = {
  ...source,
  height: 1684,
  crop: { x: 100, y: 200, width: 800, height: 1412 },
  segments: [
    { x: 100, y: 200, width: 800, height: 120 },
    { x: 100, y: 1576, width: 800, height: 36 },
  ],
};
const withoutFooter = context.window.renderSourceImageCrop(footerSource, "Rješenje");
const renderedSegments = withoutFooter.match(/class="source-crop-segment"/g) || [];
if (!withoutFooter.includes("source-crop--segmented") ||
    !withoutFooter.includes("800 / 120") ||
    renderedSegments.length !== 1) {
  throw new Error("A legacy footer-only segment was not ignored safely");
}

const overlay = context.window.renderSourceImageCrop(source, "Zadatak", {
  overlayHtml: "<button>Odgovor</button>",
});
if (overlay.includes("source-crop--segmented") || !overlay.includes("800 / 1000")) {
  throw new Error("Source crops with overlays must remain continuous");
}

console.log("source image renderer checks passed");
