import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVocabResolutionOutput,
  resolveDictionaryVocabEntry,
  resolveSelectionVocabEntry
} from './vocab-resolver.js';

test('dictionary resolution prefers a kanji form for kana queries when available', () => {
  const entry = resolveDictionaryVocabEntry('たべる', [
    {
      japanese: [
        { word: '食べる', reading: 'たべる' },
        { word: 'たべる', reading: 'たべる' }
      ],
      senses: [{ english_definitions: ['to eat', 'to consume'] }]
    }
  ]);

  assert.deepEqual(entry, {
    word: '食べる',
    reading: 'たべる',
    meaning: 'to eat; to consume'
  });
});

test('dictionary resolution returns kana-only entries when no kanji form exists', () => {
  const entry = resolveDictionaryVocabEntry('こんにちは', [
    {
      japanese: [{ reading: 'こんにちは' }],
      senses: [{ english_definitions: ['hello', 'good afternoon'] }]
    }
  ]);

  assert.deepEqual(entry, {
    word: 'こんにちは',
    reading: 'こんにちは',
    meaning: 'hello; good afternoon'
  });
});

test('selection resolution uses the dictionary result before model fallback', async () => {
  let modelCalls = 0;

  const result = await resolveSelectionVocabEntry({
    text: 'たべる',
    dictionaryEntries: [
      {
        japanese: [{ word: '食べる', reading: 'たべる' }],
        senses: [{ english_definitions: ['to eat'] }]
      }
    ],
    resolveWithModel: async () => {
      modelCalls += 1;
      return { word: 'ignored', reading: 'ignored', meaning: 'ignored' };
    }
  });

  assert.equal(result.source, 'dictionary');
  assert.equal(modelCalls, 0);
  assert.deepEqual(result.entry, {
    word: '食べる',
    reading: 'たべる',
    meaning: 'to eat'
  });
});

test('selection resolution falls back to the model when the dictionary misses', async () => {
  const result = await resolveSelectionVocabEntry({
    text: '食べました',
    lookupText: '食べる',
    dictionaryEntries: [],
    resolveWithModel: async () => {
      return {
        word: '食べる',
        reading: 'たべる',
        meaning: 'to eat'
      };
    }
  });

  assert.equal(result.source, 'model');
  assert.deepEqual(result.entry, {
    word: '食べる',
    reading: 'たべる',
    meaning: 'to eat'
  });
});

test('selection resolution falls back to the raw selection when no richer result is available', async () => {
  const result = await resolveSelectionVocabEntry({
    text: 'おはよう',
    dictionaryEntries: [],
    resolveWithModel: async () => ({ word: 'おはよう', reading: 'おはよう', meaning: '' })
  });

  assert.equal(result.source, 'fallback');
  assert.deepEqual(result.entry, {
    word: 'おはよう',
    reading: 'おはよう',
    meaning: ''
  });
});

test('model output parsing accepts fenced JSON', () => {
  const entry = parseVocabResolutionOutput(
    '```json\n{"word":"行く","reading":"いく","meaning":"to go"}\n```',
    '行った'
  );

  assert.deepEqual(entry, {
    word: '行く',
    reading: 'いく',
    meaning: 'to go'
  });
});
