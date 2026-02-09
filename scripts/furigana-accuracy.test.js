import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kuromoji from 'kuromoji';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dicPath = path.join(root, 'node_modules', 'kuromoji', 'dict');

const kanjiRegex = /[\u3400-\u9fff]/;
const japaneseCharRange =
  '\u3005\u3006\u3007\u303b\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d';
const kanaRegex = /[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]/;
const tokenizableCharRange = `${japaneseCharRange}0-9\uFF10-\uFF19`;
const tokenizableRunRegex = new RegExp(`[${tokenizableCharRange}]+`, 'g');
const monthTokenRegex = /^[0-9\uFF10-\uFF19]+月$/;
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('ja', { granularity: 'word' })
  : null;

const tokenReadingOverrides = new Map([
  ['日本', 'にほん'],
  ['大谷', 'おおたに'],
  ['弘和', 'ひろかず']
]);

const compoundReadingOverrides = new Map([
  ['世界大会', 'せかいたいかい'],
  ['大活躍', 'だいかつやく'],
  ['翔平', 'しょうへい']
]);

const ARTICLE_TEXT = `２０２６年には、
イタリアの
ミラノと コルティナ・ダンペッツォという地域で
オリンピック・パラリンピックがあります。
また、 野球とサッカーでも
大きな世界大会があります。

野球の世界大会は
３月から始まるWBCです。

２０２５年１２月
日本チームの監督、 井端 弘和 さんは
１２月までに 出場が決まった選手を
発表しました。
その中には、 メジャーリーグで大活躍している
大谷 翔平 選手もいます。

前回の ２０２３年の大会でも
大谷選手をはじめ
日本チームは とても活躍し、
アメリカチームを倒して、 優勝しました。
今回も 大谷選手の参加が決まり、
日本チームの活躍が 注目されています。`;

const EXPECTED_FURIGANA = `２０２６年{ねん}には、
イタリアの
ミラノと コルティナ・ダンペッツォという地域{ちいき}で
オリンピック・パラリンピックがあります。
また、 野球{やきゅう}とサッカーでも
大{おお}きな世界大会{せかいたいかい}があります。

野球{やきゅう}の世界大会{せかいたいかい}は
３月{がつ}から始{はじ}まるWBCです。

２０２５年{ねん}１２月{がつ}
日本{にほん}チームの監督{かんとく}、 井端{いばた} 弘和{ひろかず} さんは
１２月{がつ}までに 出場{しゅつじょう}が決{き}まった選手{せんしゅ}を
発表{はっぴょう}しました。
その中{なか}には、 メジャーリーグで大活躍{だいかつやく}している
大谷{おおたに} 翔平{しょうへい} 選手{せんしゅ}もいます。

前回{ぜんかい}の ２０２３年{ねん}の大会{たいかい}でも
大谷{おおたに}選手{せんしゅ}をはじめ
日本{にほん}チームは とても活躍{かつやく}し、
アメリカチームを倒{たお}して、 優勝{ゆうしょう}しました。
今回{こんかい}も 大谷{おおたに}選手{せんしゅ}の参加{さんか}が決{き}まり、
日本{にほん}チームの活躍{かつやく}が 注目{ちゅうもく}されています。`;

let tokenizerPromise;

function buildTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath }).build((error, tokenizer) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(tokenizer);
      });
    });
  }
  return tokenizerPromise;
}

function hasKanji(text) {
  return kanjiRegex.test(text);
}

function hasKana(text) {
  return kanaRegex.test(text);
}

function toHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0x60);
  });
}

function segmentLine(line) {
  if (!segmenter) {
    return line.split(/(\s+)/);
  }
  const segments = [];
  for (const { segment } of segmenter.segment(line)) {
    segments.push(segment);
  }
  return segments;
}

function splitTokenizableRuns(text) {
  if (!text) {
    return [{ type: 'plain', text: '' }];
  }
  tokenizableRunRegex.lastIndex = 0;
  const segments = [];
  let lastIndex = 0;
  for (const match of text.matchAll(tokenizableRunRegex)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ type: 'plain', text: text.slice(lastIndex, start) });
    }
    const runText = match[0];
    if (runText) {
      segments.push({ type: 'tokenize', text: runText });
    }
    lastIndex = start + runText.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'plain', text: text.slice(lastIndex) });
  }
  if (!segments.length) {
    segments.push({ type: 'plain', text });
  }
  return segments;
}

function tokenizeLineWithKuromoji(line, tokenizer) {
  if (!tokenizer) {
    return null;
  }
  const tokens = [];
  const segments = splitTokenizableRuns(line);
  segments.forEach((segment) => {
    if (segment.type === 'plain') {
      tokens.push({ text: segment.text, reading: '' });
      return;
    }
    const kuromojiTokens = tokenizer.tokenize(segment.text);
    kuromojiTokens.forEach((token) => {
      const reading = token.reading && token.reading !== '*' ? token.reading : '';
      tokens.push({
        text: token.surface_form || '',
        reading
      });
    });
  });
  return tokens;
}

function applyReadingOverrides(tokens) {
  if (!Array.isArray(tokens)) {
    return tokens;
  }

  const merged = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    if (!current || !current.text) {
      merged.push(current);
      continue;
    }

    const next = tokens[i + 1];
    if (next && next.text && !/^\s+$/.test(current.text) && !/^\s+$/.test(next.text)) {
      const combinedText = current.text + next.text;
      const combinedReading = compoundReadingOverrides.get(combinedText);
      if (combinedReading) {
        merged.push({ text: combinedText, reading: combinedReading });
        i += 1;
        continue;
      }
    }

    merged.push(current);
  }

  return merged.map((token) => {
    if (!token || !token.text) {
      return token;
    }
    const override = tokenReadingOverrides.get(token.text);
    if (override) {
      return { ...token, reading: override };
    }
    if (monthTokenRegex.test(token.text)) {
      return { ...token, reading: 'がつ' };
    }
    return token;
  });
}

function getLineTokens(line, tokenizer) {
  const kuromojiTokens = tokenizeLineWithKuromoji(line, tokenizer);
  if (kuromojiTokens) {
    return applyReadingOverrides(kuromojiTokens);
  }
  const segments = segmentLine(line).map((segment) => ({ text: segment, reading: '' }));
  return applyReadingOverrides(segments);
}

function splitTokenForFurigana(token, reading) {
  if (!reading) {
    return [{ type: 'plain', text: token }];
  }

  const parts = token.match(/[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]+|[^\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]+/g) || [];
  const hiraReading = toHiragana(reading);
  let rIdx = 0;
  const segments = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (hasKana(part)) {
      segments.push({ type: 'kana', text: part });
      const partHira = toHiragana(part);
      const foundIdx = hiraReading.indexOf(partHira, rIdx);
      if (foundIdx >= 0) {
        rIdx = foundIdx + partHira.length;
      }
      continue;
    }

    if (hasKanji(part)) {
      const nextKana = parts.slice(i + 1).find((item) => hasKana(item));
      let readingPart = '';
      if (nextKana) {
        const nextKanaHira = toHiragana(nextKana);
        const foundIdx = hiraReading.indexOf(nextKanaHira, rIdx);
        if (foundIdx >= 0) {
          readingPart = hiraReading.slice(rIdx, foundIdx);
          rIdx = foundIdx;
        } else {
          readingPart = hiraReading.slice(rIdx);
          rIdx = hiraReading.length;
        }
      } else {
        readingPart = hiraReading.slice(rIdx);
        rIdx = hiraReading.length;
      }
      segments.push({
        type: 'kanji',
        text: part,
        reading: readingPart
      });
      continue;
    }

    segments.push({ type: 'plain', text: part });
  }

  return segments;
}

function toFuriganaMarkup(text, tokenizer) {
  const lines = text.split('\n');
  const outputLines = [];

  for (const line of lines) {
    const segments = getLineTokens(line, tokenizer);
    let output = '';
    segments.forEach((segment) => {
      const raw = segment?.text ?? '';
      if (!raw) {
        return;
      }
      const reading = segment.reading ? toHiragana(segment.reading) : '';
      const parts = hasKanji(raw) && reading
        ? splitTokenForFurigana(raw, reading)
        : [{ type: 'plain', text: raw }];
      parts.forEach((part) => {
        if (part.type === 'kanji' && part.reading) {
          output += `${part.text}{${part.reading}}`;
        } else {
          output += part.text;
        }
      });
    });
    outputLines.push(output);
  }

  return outputLines.join('\n');
}

test('furigana accuracy for the WBC/2026 article screenshots', async () => {
  const tokenizer = await buildTokenizer();
  const actual = toFuriganaMarkup(ARTICLE_TEXT, tokenizer);
  assert.equal(actual, EXPECTED_FURIGANA);
});
