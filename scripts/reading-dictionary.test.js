import { test } from 'node:test';
import assert from 'node:assert/strict';
import kuromoji from 'kuromoji';
import { fileURLToPath } from 'node:url';
import { readingLookupTarget } from '../src/reading-model.js';
import { dictionarySelectionLanguage, englishLookupQuery, englishDictionaryChoices, dictionaryClipboardText } from '../src/dictionary-query.js';
import { createEnglishDictionarySearch } from './english-dictionary.js';

test('dictionary selection resolves inflected words and preserves kana and compound nouns', async () => {
  const dicPath = fileURLToPath(new URL('../node_modules/kuromoji/dict/', import.meta.url));
  const tokenizer = await new Promise((resolve,reject) => kuromoji.builder({dicPath}).build((error,value)=>error?reject(error):resolve(value)));
  for (const [selected, expected] of [['食べました','食べる'],['食べていた','食べる'],['大きかった','大きい'],['ありがとう','ありがとう'],['図書館','図書館'],['秋雨前線','秋雨前線']]) {
    assert.equal(readingLookupTarget(selected,tokenizer.tokenize(selected)),expected);
  }
  assert.equal(readingLookupTarget('未知の単語'),'未知の単語');
});

test('English selections accept words and short phrases without disturbing Japanese lookup', () => {
  for (const value of ['Library', '“Good morning!”', 'ice cream', "don't", 'well-known', 'Ｂｏｏｋ']) assert.equal(dictionarySelectionLanguage(value), 'en');
  for (const value of ['食べました', 'ありがとう', '図書館']) assert.equal(dictionarySelectionLanguage(value), 'ja');
  for (const value of ['', null, '1234', '<script>', 'one two three four five six seven', 'x'.repeat(81)]) assert.equal(dictionarySelectionLanguage(value), null);
  assert.equal(englishLookupQuery('“Good   morning!”'), 'good morning');
  assert.equal(englishLookupQuery('BOOK'), englishLookupQuery('book'));
});

test('English dictionary searches whole gloss words and ranks direct equivalents before compounds', () => {
  const search = createEnglishDictionarySearch({
    a: { words: ['本屋'], readings: ['ほんや'], glosses: ['book shop', 'bookstore'] },
    b: { words: ['予約'], readings: ['よやく'], glosses: ['to book (a hotel, etc.)'] },
    c: { words: ['本'], readings: ['ほん'], glosses: ['book', 'volume'] },
    d: { words: ['図書館'], readings: ['としょかん'], glosses: ['library'] },
    e: { words: ['読む'], readings: ['よむ'], glosses: ['to read'] },
    f: { words: [], readings: ['おはよう'], glosses: ['good morning'] }
  });
  assert.equal(search('BOOK')[0].words[0], '本');
  assert.equal(search('read')[0].words[0], '読む');
  assert.equal(search('library')[0].words[0], '図書館');
  assert.equal(search('good morning')[0].readings[0], 'おはよう');
  assert.deepEqual(search('book shop').map((entry) => entry.words[0]), ['本屋']);
  assert.deepEqual(search('book library'), []);
  assert.deepEqual(search('boo'), []);
  assert.deepEqual(search('unknown'), []);
  assert.deepEqual(search('__proto__'), []);
  assert.equal(search('book', 1).length, 1);
});

test('English choices keep Japanese readings with all relevant senses and clipboard text is plain text', () => {
  const entries = [
    { japanese: [{ word: '本', reading: 'ほん' }], senses: [{ english_definitions: ['book'] }, { english_definitions: ['volume'] }] },
    { japanese: [{ word: '本', reading: 'ほん' }], senses: [{ english_definitions: ['duplicate'] }] },
    { japanese: [{ reading: 'ブック' }], senses: [{ english_definitions: ['book'] }] },
    { japanese: [{ word: 'invalid' }], senses: [] }
  ];
  const choices = englishDictionaryChoices(entries);
  assert.deepEqual(choices, [{ word: '本', reading: 'ほん', meaning: 'book; volume' }, { word: 'ブック', reading: 'ブック', meaning: 'book' }]);
  assert.equal(dictionaryClipboardText(choices), '本\nほん\nbook; volume\n\nブック\nbook');
  assert.deepEqual(englishDictionaryChoices(null), []);
  assert.equal(englishDictionaryChoices(Array.from({ length: 10 }, (_, i) => ({ japanese: [{ word: `語${i}` }], senses: [{ english_definitions: ['word'] }] }))).length, 5);
  const laterSense = { japanese: [{ word: '読む', reading: 'よむ' }], senses: [{ english_definitions: ['sense one', 'sense two', 'sense three', 'sense four', 'sense five', 'to read'] }] };
  assert.ok(englishDictionaryChoices([laterSense], 'read')[0].meaning.startsWith('to read;'));
});

test('common everyday equivalents rank ahead of obscure or specialized English matches', () => {
  const search = createEnglishDictionarySearch({
    obscure: { words: ['書誌'], glosses: ['book'], common: false },
    news: { words: ['書籍'], glosses: ['book', 'publication'], common: true, frequencyRank: 9 },
    everyday: { words: ['本'], glosses: ['book', 'volume'], common: true, everyday: true, frequencyRank: 99 },
    compound: { words: ['絵本'], glosses: ['picture book'], common: true, everyday: true, frequencyRank: 1 }
  });
  assert.deepEqual(search('book').map((entry) => entry.words[0]), ['本', '書籍', '書誌', '絵本']);
});
