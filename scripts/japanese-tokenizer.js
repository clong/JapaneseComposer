import { createRequire } from 'node:module';
import path from 'node:path';
import kuromoji from 'kuromoji';

let tokenizerPromise;
export function japaneseTokenizer() {
  if (!tokenizerPromise) tokenizerPromise = new Promise((resolve, reject) => {
    const require = createRequire(import.meta.url);
    kuromoji.builder({ dicPath: path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict') })
      .build((error, tokenizer) => error ? reject(error) : resolve(tokenizer));
  }).catch(error => { tokenizerPromise = null; throw error; });
  return tokenizerPromise;
}
