import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadingAi } from './reading-ai.js';
import { parseReadingArticles } from './reading-source.js';
import { articleHtml, englishFor } from './reading-fixtures.js';

test('live OpenAI rubric accepts paraphrases and minor errors but rejects changed facts and negation', {
  skip: process.env.READING_LIVE_EVAL !== '1', timeout: 300000
}, async () => {
  assert.ok(process.env.OPENAI_API_KEY, 'Set OPENAI_API_KEY before running the live evaluation.');
  const [article] = parseReadingArticles(articleHtml);
  const ai = createReadingAi();
  const cases = [
    ['ja-en', 0, 'The library has three books.', 'correct'],
    ['ja-en', 0, 'The library have three books.', 'correct'],
    ['ja-en', 0, 'The library has five books.', 'needs_revision'],
    ['ja-en', 1, 'It is not closed today.', 'correct'],
    ['ja-en', 1, 'It is closed today.', 'needs_revision'],
    ['en-ja', 0, 'としょかんにはほんがさんさつあります。', 'correct'],
    ['en-ja', 0, '図書館に本三冊あります。', 'correct'],
    ['en-ja', 0, '図書館には本が四冊あります。', 'needs_revision']
  ];
  for (const [direction, index, input, expected] of cases) {
    const result = await ai.grade({ article, direction, english: englishFor(article), answers: [{ id: article.sentences[index].id, input }] });
    assert.equal(result.results[0].verdict, expected, `${direction}: ${input} — ${result.results[0].explanation}`);
    assert.equal(Number.isInteger(result.results[0].score), true);
    if (expected === 'correct') {
      assert.equal(result.results[0].score, 100, `Meaning-preserving answer: ${input}`);
      assert.doesNotMatch(result.results[0].explanation, /preserves? the meaning|meaning matches/i);
    } else assert.ok(result.results[0].score < 90);
  }
});
