(() => {
  const icons = {
  "arrow-left": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"m12 19-7-7 7-7\" />\n    <path d=\"M19 12H5\" />"
  },
  "arrow-right": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M5 12h14\" />\n    <path d=\"m12 5 7 7-7 7\" />"
  },
  "amphora": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8\" />\n    <path d=\"M10 5H8a2 2 0 0 0 0 4h.68\" />\n    <path d=\"M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8\" />\n    <path d=\"M14 5h2a2 2 0 0 1 0 4h-.68\" />\n    <path d=\"M18 22H6\" />\n    <path d=\"M9 2h6\" />"
  },
  "atom": {
    "viewBox": "0 0 24 24",
    "content": "<circle cx=\"12\" cy=\"12\" r=\"1\" />\n    <path d=\"M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z\" />\n    <path d=\"M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z\" />"
  },
  "binary": {
    "viewBox": "0 0 24 24",
    "content": "<rect x=\"14\" y=\"14\" width=\"4\" height=\"6\" rx=\"2\" />\n    <rect x=\"6\" y=\"4\" width=\"4\" height=\"6\" rx=\"2\" />\n    <path d=\"M6 20h4\" />\n    <path d=\"M14 10h4\" />\n    <path d=\"M6 14h2v6\" />\n    <path d=\"M14 4h2v6\" />"
  },
  "book-open": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M12 7v14\" />\n    <path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\" />"
  },
  "book-open-text": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M12 7v14\" />\n    <path d=\"M16 12h2\" />\n    <path d=\"M16 8h2\" />\n    <path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\" />\n    <path d=\"M6 12h2\" />\n    <path d=\"M6 8h2\" />"
  },
  "camera": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z\" />\n    <circle cx=\"12\" cy=\"13\" r=\"3\" />"
  },
  "brain": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M12 18V5\" />\n    <path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\" />\n    <path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\" />\n    <path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\" />\n    <path d=\"M18 18a4 4 0 0 0 2-7.464\" />\n    <path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\" />\n    <path d=\"M6 18a4 4 0 0 1-2-7.464\" />\n    <path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\" />"
  },
  "church": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M10 9h4\" />\n    <path d=\"M12 7v5\" />\n    <path d=\"M14 21v-3a2 2 0 0 0-4 0v3\" />\n    <path d=\"m18 9 3.52 2.147a1 1 0 0 1 .48.854V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.999a1 1 0 0 1 .48-.854L6 9\" />\n    <path d=\"M6 21V7a1 1 0 0 1 .376-.782l5-3.999a1 1 0 0 1 1.249.001l5 4A1 1 0 0 1 18 7v14\" />"
  },
  "circle-check": {
    "viewBox": "0 0 24 24",
    "content": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n    <path d=\"m9 12 2 2 4-4\" />"
  },
  "clock": {
    "viewBox": "0 0 24 24",
    "content": "<circle cx=\"12\" cy=\"12\" r=\"10\" />\n    <path d=\"M12 6v6l4 2\" />"
  },
  "cookie": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5\" />\n    <path d=\"M8.5 8.5v.01\" />\n    <path d=\"M16 15.5v.01\" />\n    <path d=\"M12 12v.01\" />\n    <path d=\"M11 17v.01\" />\n    <path d=\"M7 14v.01\" />"
  },
  "dna": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"m10 16 1.5 1.5\" />\n    <path d=\"m14 8-1.5-1.5\" />\n    <path d=\"M15 2c-1.798 1.998-2.518 3.995-2.807 5.993\" />\n    <path d=\"m16.5 10.5 1 1\" />\n    <path d=\"m17 6-2.891-2.891\" />\n    <path d=\"M2 15c6.667-6 13.333 0 20-6\" />\n    <path d=\"m20 9 .891.891\" />\n    <path d=\"M3.109 14.109 4 15\" />\n    <path d=\"m6.5 12.5 1 1\" />\n    <path d=\"m7 18 2.891 2.891\" />\n    <path d=\"M9 22c1.798-1.998 2.518-3.995 2.807-5.993\" />"
  },
  "earth": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M21.54 15H17a2 2 0 0 0-2 2v4.54\" />\n    <path d=\"M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17\" />\n    <path d=\"M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05\" />\n    <circle cx=\"12\" cy=\"12\" r=\"10\" />"
  },
  "eye-off": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49\" />\n    <path d=\"M14.084 14.158a3 3 0 0 1-4.242-4.242\" />\n    <path d=\"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143\" />\n    <path d=\"m2 2 20 20\" />"
  },
  "flask-conical": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2\" />\n    <path d=\"M6.453 15h11.094\" />\n    <path d=\"M8.5 2h7\" />"
  },
  "history": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" />\n    <path d=\"M3 3v5h5\" />\n    <path d=\"M12 7v5l4 2\" />"
  },
  "house": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" />\n    <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />"
  },
  "landmark": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M10 18v-7\" />\n    <path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\" />\n    <path d=\"M14 18v-7\" />\n    <path d=\"M18 18v-7\" />\n    <path d=\"M3 22h18\" />\n    <path d=\"M6 18v-7\" />"
  },
  "languages": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"m5 8 6 6\" />\n    <path d=\"m4 14 6-6 2-3\" />\n    <path d=\"M2 5h12\" />\n    <path d=\"M7 2h1\" />\n    <path d=\"m22 22-5-10-5 10\" />\n    <path d=\"M14 18h6\" />"
  },
  "library": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"m16 6 4 14\" />\n    <path d=\"M12 6v14\" />\n    <path d=\"M8 8v12\" />\n    <path d=\"M4 4v16\" />"
  },
  "list-checks": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"m3 17 2 2 4-4\" />\n    <path d=\"m3 7 2 2 4-4\" />\n    <path d=\"M13 6h8\" />\n    <path d=\"M13 12h8\" />\n    <path d=\"M13 18h8\" />"
  },
  "lightbulb": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5\" />\n    <path d=\"M9 18h6\" />\n    <path d=\"M10 22h4\" />"
  },
  "music-2": {
    "viewBox": "0 0 24 24",
    "content": "<circle cx=\"8\" cy=\"18\" r=\"4\" />\n    <path d=\"M12 18V2l7 4\" />"
  },
  "omega": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M3 20h4.5a.5.5 0 0 0 .5-.5v-.282a.52.52 0 0 0-.247-.437 8 8 0 1 1 8.494-.001.52.52 0 0 0-.247.438v.282a.5.5 0 0 0 .5.5H21\" />"
  },
  "palette": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\" />\n    <circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\" />\n    <circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\" />\n    <circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\" />\n    <circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />"
  },
  "scale": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M12 3v18\" />\n    <path d=\"m19 8 3 8a5 5 0 0 1-6 0zV7\" />\n    <path d=\"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1\" />\n    <path d=\"m5 8 3 8a5 5 0 0 1-6 0zV7\" />\n    <path d=\"M7 21h10\" />"
  },
  "sigma": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2\" />"
  },
  "star": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\" />"
  },
  "users-round": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M18 21a8 8 0 0 0-16 0\" />\n    <circle cx=\"10\" cy=\"8\" r=\"5\" />\n    <path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\" />"
  },
  "wrench": {
    "viewBox": "0 0 24 24",
    "content": "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z\" />"
  },
  "workflow": {
    "viewBox": "0 0 24 24",
    "content": "<rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\" />\n    <path d=\"M7 11v4a2 2 0 0 0 2 2h4\" />\n    <rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\" />"
  }
};

  function escapeAttribute(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("\"", "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  window.renderLucideIcon = (iconName, className) => {
    const icon = icons[iconName] || icons["book-open"];
    const classAttribute = className ? ` class="${escapeAttribute(className)}"` : "";

    return `<svg${classAttribute} aria-hidden="true" focusable="false" viewBox="${icon.viewBox}">${icon.content}</svg>`;
  };
})();
