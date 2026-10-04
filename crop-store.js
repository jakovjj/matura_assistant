// Manual crop corrections are separate from regenerated exam indexes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function createCropStore(root) {
  const file = path.join(root, 'var/crop-overrides.json');
  let entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  function parse(text, name) {
    const match = /^(window\.[A-Z_]+\s*=\s*)([\s\S]*?);?\s*$/.exec(text);
    if (!match) return null;
    let data;
    try { data = JSON.parse(match[2]); } catch { return null; }
    const sources = new Map();
    function visit(value, trail) {
      if (!value || typeof value !== 'object') return;
      if (value.url && value.crop && value.width > 0 && value.height > 0) {
        const id = crypto.createHash('sha256').update(JSON.stringify([name, trail, value.url, value.width, value.height, value.crop, value.segments])).digest('hex');
        sources.set(id, value);
        value.adminCropId = `${name}:${id}`;
        const saved = entries[value.adminCropId];
        if (saved) { value.crop = saved.crop; delete value.segments; }
      }
      for (const [key, child] of Object.entries(value)) visit(child, `${trail}/${key}`);
    }
    visit(data, '');
    return { text: `${match[1]}${JSON.stringify(data)};\n`, sources };
  }
  function resolve(id) {
    if (typeof id !== 'string' || !/^[a-z-]+\.js:[a-f0-9]{64}$/.test(id)) throw new Error('Nepoznat izrez.');
    const [name, hash] = id.split(':');
    const parsed = parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'), name);
    const source = parsed?.sources.get(hash);
    if (!source) throw new Error('Podaci ispita su promijenjeni. Osvježi stranicu.');
    return source;
  }
  function save(id, crop, previous, email) {
    const source = resolve(id);
    if (JSON.stringify(previous) !== JSON.stringify(source.crop)) {
      const error = new Error('Izrez je u međuvremenu promijenjen. Osvježi stranicu.'); error.status = 409; throw error;
    }
    if (!crop || !['x', 'y', 'width', 'height'].every(key => typeof crop[key] === 'number' && Number.isFinite(crop[key])) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > source.width || crop.y + crop.height > source.height) throw new Error('Izrez mora biti unutar izvorne stranice.');
    const clean = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, crop[key]]));
    const next = { ...entries, [id]: { crop: clean, updatedAt: new Date().toISOString(), updatedBy: email, previous: entries[id] || null } };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(next));
    fs.renameSync(`${file}.tmp`, file);
    entries = next;
    return clean;
  }
  return { parse, resolve, save };
}
module.exports = { createCropStore };
