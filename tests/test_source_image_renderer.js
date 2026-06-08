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

const overlay = context.window.renderSourceImageCrop(source, "Zadatak", {
  overlayHtml: "<button>Odgovor</button>",
});
if (overlay.includes("source-crop--segmented") || !overlay.includes("800 / 1000")) {
  throw new Error("Source crops with overlays must remain continuous");
}

console.log("source image renderer checks passed");
