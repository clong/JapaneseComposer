import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASK_SYSTEM_PROMPT,
  TUTOR_LESSON_PLAN_SYSTEM_PROMPT,
  TUTOR_REALTIME_SESSION_INSTRUCTIONS,
  TUTOR_SESSION_SUMMARY_SYSTEM_PROMPT,
  TUTOR_TURN_FEEDBACK_SYSTEM_PROMPT
} from './openai-prompts.js';

test('ask prompt requires English responses', () => {
  assert.match(ASK_SYSTEM_PROMPT, /All explanatory text must be in English\./);
  assert.doesNotMatch(
    ASK_SYSTEM_PROMPT,
    /Respond in the same language as the question when possible/i
  );
});

test('tutor prompts require structured JSON contracts', () => {
  assert.match(TUTOR_LESSON_PLAN_SYSTEM_PROMPT, /Return only valid JSON/);
  assert.match(TUTOR_LESSON_PLAN_SYSTEM_PROMPT, /"targetVocabulary":\[\]/);
  assert.match(TUTOR_TURN_FEEDBACK_SYSTEM_PROMPT, /"correctedPhrase":""/);
  assert.match(TUTOR_TURN_FEEDBACK_SYSTEM_PROMPT, /"severity" must be one of "note", "practice", or "important"/);
  assert.match(TUTOR_SESSION_SUMMARY_SYSTEM_PROMPT, /"profileUpdate"/);
  assert.match(TUTOR_SESSION_SUMMARY_SYSTEM_PROMPT, /"vocabularyLevel":""/);
  assert.match(TUTOR_SESSION_SUMMARY_SYSTEM_PROMPT, /"confidence" must be between 0 and 1/);
  assert.match(TUTOR_LESSON_PLAN_SYSTEM_PROMPT, /vocabulary baseline as a hard ceiling/);
  assert.match(TUTOR_TURN_FEEDBACK_SYSTEM_PROMPT, /provided vocabulary baseline/);
});

test('realtime tutor instructions enforce adaptive Japanese speaking practice', () => {
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /Japanese speaking tutor who may use brief English explanations/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /Adapt to the learner's current speaking level/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /Gently identify important speaking mistakes/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /Start the session in Japanese/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /Japanese is the only speaking-practice language/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /English is explanation-only/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /Never ask the learner to speak, repeat, translate into, or practice English/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /1 to 2 sentences/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /Do not monologue/);
  assert.match(TUTOR_REALTIME_SESSION_INSTRUCTIONS, /JLPT vocabulary baseline as a hard ceiling/);
});
