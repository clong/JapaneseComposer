import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const inputPath = process.env.JMDICT_PATH || path.join(dataDir, 'JMdict_e');
const entriesPath = path.join(dataDir, 'jmdict-entries.json');
const indexPath = path.join(dataDir, 'jmdict-index.json');

await fs.mkdir(dataDir, { recursive: true });

const xml = await fs.readFile(inputPath, 'utf8');
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true
});

const parsed = parser.parse(xml);
const entriesRaw = parsed?.JMdict?.entry;
if (!entriesRaw) {
  throw new Error('No JMdict entries found.');
}

const entriesArray = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw];
const entries = {};
const index = {};

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function addIndex(key, id) {
  if (!key) return;
  if (!index[key]) {
    index[key] = [];
  }
  if (!index[key].includes(id)) {
    index[key].push(id);
  }
}

for (const entry of entriesArray) {
  const id = String(entry.ent_seq || '').trim();
  if (!id) {
    continue;
  }

  const words = ensureArray(entry.k_ele).map((item) => item.keb).filter(Boolean);
  const readings = ensureArray(entry.r_ele).map((item) => item.reb).filter(Boolean);

  const glosses = [];
  const senses = ensureArray(entry.sense);
  for (const sense of senses) {
    const glossItems = ensureArray(sense.gloss);
    for (const gloss of glossItems) {
      if (typeof gloss === 'string') {
        glosses.push(gloss);
      } else if (typeof gloss === 'object' && gloss['#text']) {
        glosses.push(gloss['#text']);
      }
      if (glosses.length >= 10) {
        break;
      }
    }
    if (glosses.length >= 10) {
      break;
    }
  }

  entries[id] = {
    id,
    words,
    readings,
    glosses
  };

  if (words.length) {
    words.forEach((word) => addIndex(word, id));
  }
  readings.forEach((reading) => addIndex(reading, id));
}

await fs.writeFile(entriesPath, JSON.stringify(entries));
await fs.writeFile(indexPath, JSON.stringify(index));

console.log(`JMdict build complete. Entries: ${Object.keys(entries).length}`);
console.log(`Wrote ${entriesPath}`);
console.log(`Wrote ${indexPath}`);
