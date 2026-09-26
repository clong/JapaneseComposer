import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadingSession, validateSession, addReadingVocabulary } from '../src/reading-model.js';
import { parseReadingArticles } from './reading-source.js';
import { articleHtml } from './reading-fixtures.js';

const [article] = parseReadingArticles(articleHtml);
const library = { word: '図書館', reading: 'としょかん', meaning: 'library' };

test('older sessions and new attempts start with an empty vocabulary bank', () => {
  const session = createReadingSession(article, 'original');
  const { vocabulary, ...legacy } = session;
  assert.deepEqual(validateSession(legacy).vocabulary, []);
  addReadingVocabulary(session, '図書館', [library]);
  assert.deepEqual(createReadingSession(session.article, 'new-attempt').vocabulary, []);
});

test('lookups preserve selected inflections, readings, meanings, and English alternatives', () => {
  const session = createReadingSession(article, 'vocabulary');
  const verb = { word: '食べる', reading: 'たべる', meaning: 'to eat' };
  addReadingVocabulary(session, '食べました', [verb]);
  const choices = [library, { word: '文庫', reading: 'ぶんこ', meaning: 'library; paperback' }];
  addReadingVocabulary(session, 'Library', choices);
  assert.equal(addReadingVocabulary(session, '“LIBRARY!”', choices), false);
  assert.equal(addReadingVocabulary(session, '食べました', [verb]), false);
  assert.deepEqual(validateSession(session).vocabulary, [
    { query: 'Library', entries: choices }, { query: '食べました', entries: [verb] }
  ]);
  assert.equal(addReadingVocabulary(session, 'library', [library]), true);
  assert.equal(session.vocabulary.length, 2);
  assert.deepEqual(session.vocabulary[0], { query: 'Library', entries: [library] });
});

test('vocabulary validation excludes unrelated payload fields and rejects malformed definitions', () => {
  const session = createReadingSession(article, 'vocabulary');
  addReadingVocabulary(session, '図書館', [{ ...library, choices: [library], privateField: 'discard' }]);
  assert.deepEqual(session.vocabulary, [{ query: '図書館', entries: [library] }]);
  for (const vocabulary of [{}, [null], [{ query: 'word', entries: [] }], [{ query: 'word', entries: [{ word: 42 }] }]]) {
    assert.throws(() => validateSession({ ...session, vocabulary }));
  }
});

test('Google Translate attribution survives vocabulary persistence without inventing a reading', () => {
  const session = createReadingSession(article, 'translation');
  const translated = { word: '見つからない語', reading: '', meaning: 'unmatched word', source: 'google-translate' };
  addReadingVocabulary(session, 'unmatched word', [translated]);
  assert.deepEqual(validateSession(JSON.parse(JSON.stringify(session))).vocabulary[0].entries, [translated]);
  // A later dictionary hit replaces the fallback and its source label.
  addReadingVocabulary(session, 'unmatched word', [library]);
  assert.deepEqual(session.vocabulary[0].entries, [library]);
});
