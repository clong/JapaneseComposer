import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ASK_SYSTEM_PROMPT } from './openai-prompts.js';

test('ask prompt requires English responses', () => {
  assert.match(ASK_SYSTEM_PROMPT, /All explanatory text must be in English\./);
  assert.doesNotMatch(
    ASK_SYSTEM_PROMPT,
    /Respond in the same language as the question when possible/i
  );
});
