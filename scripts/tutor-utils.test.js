import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonObject,
  isLikelyTutorPlaybackEcho,
  isTutorTranscriptLanguageAllowed,
  normalizeTutorProfile,
  normalizeTutorRealtimeEvents,
  normalizeTutorSessions,
  normalizeTutorSpeechRate,
  normalizeTutorTranscriptDelta,
  normalizeTutorTranscriptText,
  normalizeTutorTranscriptionLanguage,
  normalizeTutorVoice,
  normalizeTutorVocabularyLevel,
  pruneTutorStorage,
  resolveTutorAssistantTurnId
} from '../src/tutor-utils.js';

test('assistant item IDs keep multiple spoken messages in one response distinct', () => {
  assert.equal(resolveTutorAssistantTurnId({
    itemId: 'item_first',
    responseId: 'response_shared'
  }), 'item_first');
  assert.equal(resolveTutorAssistantTurnId({
    itemId: 'item_second',
    responseId: 'response_shared'
  }), 'item_second');
  assert.equal(resolveTutorAssistantTurnId({ responseId: 'response_only' }), 'response_only');
});

test('normalizes tutor profile and sessions', () => {
  const profile = normalizeTutorProfile({
    estimatedLevel: 'N4',
    confidence: 2,
    strengths: ['particles', '', 'listening'],
    recurringMistakes: ['tense'],
    updatedAt: 123.9
  });

  assert.equal(profile.estimatedLevel, 'N4');
  assert.equal(profile.vocabularyLevel, 'N5');
  assert.equal(profile.confidence, 1);
  assert.deepEqual(profile.strengths, ['particles', 'listening']);
  assert.equal(profile.updatedAt, 123);

  const sessions = normalizeTutorSessions([
    {
      id: 's1',
      topic: 'shopping',
      vocabularyLevel: 'n3',
      status: 'active',
      turns: [
        {
          id: 't1',
          role: 'user',
          transcript: '今日は買い物に行きました。',
          status: 'completed',
          audioClipIds: ['a1'],
          feedback: { summary: 'Good sentence.', severity: 'note' }
        }
      ],
      debugEvents: [
        {
          type: 'response.done',
          responseId: 'resp_1',
          status: 'incomplete',
          statusDetails: { reason: 'max_output_tokens' },
          createdAt: 11
        }
      ],
      updatedAt: 10
    },
    { id: '', topic: 'invalid' }
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].vocabularyLevel, 'N3');
  assert.equal(sessions[0].turns[0].status, 'completed');
  assert.equal(sessions[0].debugEvents[0].status, 'incomplete');
  assert.equal(sessions[0].turns[0].feedback.summary, 'Good sentence.');
});

test('prunes tutor sessions and audio by retention limits', () => {
  const sessions = Array.from({ length: 4 }, (_, index) => ({
    id: `s${index}`,
    status: 'completed',
    updatedAt: 100 - index,
    turns: [
      {
        id: `t${index}`,
        role: 'user',
        transcript: `turn ${index}`,
        audioClipIds: [`a${index}`]
      }
    ]
  }));
  const audioClips = Array.from({ length: 4 }, (_, index) => ({
    id: `a${index}`,
    sessionId: `s${index}`,
    turnId: `t${index}`,
    speaker: 'user',
    mimeType: 'audio/webm',
    byteLength: 10,
    durationMs: 1000,
    src: `data:audio/webm;base64,${index}`,
    createdAt: 100 - index
  }));

  const pruned = pruneTutorStorage(sessions, audioClips, {
    maxSessions: 3,
    maxAudioSessions: 2,
    maxAudioBytes: 15,
    maxAudioDurationMsPerSession: 2000
  });

  assert.deepEqual(pruned.sessions.map((session) => session.id), ['s0', 's1', 's2']);
  assert.deepEqual(pruned.audioClips.map((clip) => clip.id), ['a0']);
  assert.deepEqual(pruned.sessions[0].turns[0].audioClipIds, ['a0']);
  assert.deepEqual(pruned.sessions[1].turns[0].audioClipIds, []);
});

test('extracts JSON objects from plain and fenced model output', () => {
  assert.deepEqual(extractJsonObject('{"ok":true}'), { ok: true });
  assert.deepEqual(extractJsonObject('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(extractJsonObject('prefix {"ok":true} suffix'), { ok: true });
  assert.equal(extractJsonObject('not json'), null);
});

test('normalizes tutor speech rate to supported bounds and steps', () => {
  assert.equal(normalizeTutorSpeechRate('bad'), 1);
  assert.equal(normalizeTutorSpeechRate(null), 1);
  assert.equal(normalizeTutorSpeechRate(''), 1);
  assert.equal(normalizeTutorSpeechRate(0.1), 0.25);
  assert.equal(normalizeTutorSpeechRate(2), 1.5);
  assert.equal(normalizeTutorSpeechRate(0.76), 0.75);
});

test('normalizes tutor vocabulary baseline to supported JLPT levels', () => {
  assert.equal(normalizeTutorVocabularyLevel('n5'), 'N5');
  assert.equal(normalizeTutorVocabularyLevel('N3'), 'N3');
  assert.equal(normalizeTutorVocabularyLevel('n0'), 'N5');
  assert.equal(normalizeTutorVocabularyLevel(null), 'N5');
});

test('normalizes tutor transcription language to supported hints', () => {
  assert.equal(normalizeTutorTranscriptionLanguage('ja'), 'ja');
  assert.equal(normalizeTutorTranscriptionLanguage('EN'), 'en');
  assert.equal(normalizeTutorTranscriptionLanguage('ko'), 'ja');
  assert.equal(normalizeTutorTranscriptionLanguage(null), 'ja');
});

test('normalizes tutor voice to supported realtime voices', () => {
  assert.equal(normalizeTutorVoice('marin'), 'marin');
  assert.equal(normalizeTutorVoice('CEDAR'), 'cedar');
  assert.equal(normalizeTutorVoice('shimmer'), 'shimmer');
  assert.equal(normalizeTutorVoice('unknown'), 'marin');
  assert.equal(normalizeTutorVoice(null), 'marin');
});

test('allows tutor transcription text only for English and Japanese scripts', () => {
  assert.equal(isTutorTranscriptLanguageAllowed('Hello, can you repeat that?'), true);
  assert.equal(isTutorTranscriptLanguageAllowed('もう一度お願いします。'), true);
  assert.equal(isTutorTranscriptLanguageAllowed('今日は sunny です。'), true);
  assert.equal(isTutorTranscriptLanguageAllowed('ネコは3匹です。'), true);
  assert.equal(isTutorTranscriptLanguageAllowed('네'), false);
  assert.equal(isTutorTranscriptLanguageAllowed('Привет'), false);
  assert.equal(isTutorTranscriptLanguageAllowed('مرحبا'), false);
  assert.equal(isTutorTranscriptLanguageAllowed('...'), false);
  assert.equal(normalizeTutorTranscriptText('  Hello\nthere  '), 'Hello there');
  assert.equal(normalizeTutorTranscriptText('네'), '');
  assert.equal(normalizeTutorTranscriptDelta(' world'), ' world');
  assert.equal(normalizeTutorTranscriptDelta('네'), '');
});

test('suppresses only short speech that began during tutor playback', () => {
  assert.equal(isLikelyTutorPlaybackEcho({
    transcript: '一緒に',
    speechStartedDuringTutorAudio: true,
    durationMs: 691
  }), true);
  assert.equal(isLikelyTutorPlaybackEcho({
    transcript: '日本語で話したいです。',
    speechStartedDuringTutorAudio: true,
    durationMs: 2200
  }), false);
  assert.equal(isLikelyTutorPlaybackEcho({
    transcript: 'はい',
    speechStartedDuringTutorAudio: false,
    durationMs: 500
  }), false);
});

test('normalizes bounded realtime debug events', () => {
  const events = normalizeTutorRealtimeEvents(Array.from({ length: 205 }, (_, index) => ({
    type: index === 204 ? 'response.done' : 'output_audio_buffer.started',
    response_id: `resp_${index}`,
    item_id: `item_${index}`,
    status: index === 204 ? 'incomplete' : '',
    status_details: { index },
    createdAt: index
  })));

  assert.equal(events.length, 200);
  assert.equal(events[0].responseId, 'resp_5');
  assert.equal(events[199].type, 'response.done');
  assert.match(events[199].statusDetails, /204/);
});
