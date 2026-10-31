#!/usr/bin/env node
/**
 * Wire an AI-generated image into one destination's photo slot: resize the
 * raw PNG into thumb/full JPEGs at the site's standard asset paths, update
 * that destination's photoTopics[index] in its source shard (surgical edit,
 * not a full JSON.stringify -- see CLAUDE.md's reformatting warning), and
 * write the matching record directly into data/fiction/photos.json.
 *
 * photos.json is normally a build output, but build-photos.mjs's own reuse
 * check (`prev.full && (prev.wanted ?? prev.topic) === topic`) means a hand
 * -written record survives an ordinary (non --force) rebuild untouched, as
 * long as the topic text here matches the shard's photoTopics[index] exactly.
 *
 * Usage: node tools/wire-generated-photo.mjs <manifest.json>
 * Manifest: [{ destId, index, topic, pngPath, credit }]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARD_DIR = join(ROOT, 'data', 'fiction', 'destinations');
const PHOTOS_PATH = join(ROOT, 'data', 'fiction', 'photos.json');
const THUMB_DIR = join(ROOT, 'assets', 'img', 'thumbs', 'fiction');
const FULL_DIR = join(ROOT, 'assets', 'img', 'full', 'fiction');

function findObjectBounds(text, needleIndex) {
  // Scan backward from the "id": "..." match to the enclosing object's `{`.
  let depth = 0;
  let start = -1;
  for (let i = needleIndex; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start === -1) throw new Error('could not find enclosing { before id match');
  // Scan forward from start to find the matching `}`.
  depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('could not find matching } after id match');
  return [start, end + 1];
}

async function findShardFile(destId) {
  const files = await readdir(SHARD_DIR);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const text = await readFile(join(SHARD_DIR, f), 'utf8');
    if (text.includes(`"id": "${destId}"`)) return { file: f, text };
  }
  throw new Error(`destination "${destId}" not found in any shard`);
}

async function updateShardTopic(destId, index, newTopic) {
  const { file, text } = await findShardFile(destId);
  const idNeedle = `"id": "${destId}"`;
  const idPos = text.indexOf(idNeedle);
  const [start, end] = findObjectBounds(text, idPos);
  const objText = text.slice(start, end);

  // "photos" is the per-destination topic-string array inside this object's
  // text (fiction shards; real-world shards use the same field name); parse
  // it in isolation to avoid full-file JSON.parse/stringify reformatting.
  const match = /"photos"\s*:\s*(\[[\s\S]*?\])/.exec(objText);
  if (!match) throw new Error(`no photos array found for ${destId}`);
  const topics = JSON.parse(match[1]);
  if (index < 0 || index >= topics.length) throw new Error(`index ${index} out of range for ${destId} (has ${topics.length} topics)`);
  const oldTopic = topics[index];

  const oldNeedle = JSON.stringify(oldTopic);
  const newNeedle = JSON.stringify(newTopic);
  // Replace only the Nth occurrence within this topics array substring --
  // topics can repeat text across different slots in rare cases, so replace
  // positionally within the array text, not globally.
  const arrayText = match[1];
  const parts = [];
  let topicIdx = 0;
  let cursor = 0;
  let depth2 = 0;
  // Simple approach: since topics are flat strings, split on the quoted
  // string boundaries isn't trivial with naive regex if topics contain
  // escaped quotes, so instead find the index-th JSON string literal.
  let i2 = 0, found = 0, replaceStart = -1, replaceEnd = -1;
  while (i2 < arrayText.length) {
    if (arrayText[i2] === '"') {
      const strStart = i2;
      i2++;
      while (i2 < arrayText.length && arrayText[i2] !== '"') {
        if (arrayText[i2] === '\\') i2++;
        i2++;
      }
      const strEnd = i2 + 1;
      if (found === index) { replaceStart = strStart; replaceEnd = strEnd; break; }
      found++;
      i2 = strEnd;
      continue;
    }
    i2++;
  }
  if (replaceStart === -1) throw new Error(`could not locate string literal #${index} in photoTopics for ${destId}`);
  const newArrayText = arrayText.slice(0, replaceStart) + newNeedle + arrayText.slice(replaceEnd);
  const newObjText = objText.slice(0, match.index) + '"photos": ' + newArrayText + objText.slice(match.index + match[0].length);
  const newFullText = text.slice(0, start) + newObjText + text.slice(end);

  await writeFile(join(SHARD_DIR, file), newFullText, 'utf8');
  return oldTopic;
}

async function updatePhotosJson(destId, index, record) {
  const store = JSON.parse(await readFile(PHOTOS_PATH, 'utf8'));
  store.photos[destId] ??= [];
  while (store.photos[destId].length <= index) store.photos[destId].push({ topic: '' });
  store.photos[destId][index] = record;
  await writeFile(PHOTOS_PATH, JSON.stringify(store, null, 1), 'utf8');
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error('usage: node wire-generated-photo.mjs <manifest.json>');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  for (const entry of manifest) {
    const { destId, index, topic, pngPath, credit } = entry;
    const thumbPath = join(THUMB_DIR, `${destId}-${index}.jpg`);
    const fullPath = join(FULL_DIR, `${destId}-${index}.jpg`);

    await execFileP('python', [join(ROOT, 'tools', 'resize-generated.py'), pngPath, thumbPath, fullPath]);

    const oldTopic = await updateShardTopic(destId, index, topic);

    const record = {
      topic,
      full: `assets/img/full/fiction/${destId}-${index}.jpg`,
      thumb: `assets/img/thumbs/fiction/${destId}-${index}.jpg`,
      credit: credit || 'AI-generated for Vacation Guru',
      license: 'AI-generated, no copyright claimed',
      source: '',
    };
    await updatePhotosJson(destId, index, record);

    console.log(`  ${destId} [${index}] "${oldTopic}" -> "${topic}"  (${record.full})`);
  }
  console.log(`wired ${manifest.length} photo(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
