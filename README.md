# Japanese Composer

A lightweight, dependency-free web-based Japanese/English journal composer with furigana toggle, kanji hover details, and a built-in vocabulary list.

## Quick start

```bash
npm run build
```

Open `dist/index.html` in your browser.

### Dev server (optional)

```bash
npm run dev
```

Then visit the printed local URL.

## Tests

```bash
npm test
```

The tests run the build script and verify the output artifacts.

## Dictionary lookup

The app uses the public Jisho API at `https://jisho.org/api/v1/search/words?keyword=` for kana readings and English meanings. If the API is unreachable, the composer still works, but kanji hover and furigana will show fallback text.

## Notes

- Vocabulary entries are stored in `localStorage` under the key `jc_vocab_list`.
- The UI language toggle switches labels between English and Japanese.
