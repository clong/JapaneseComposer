export const PROBE_CONTRACT_VERSION = 1;
const clean = value => String(value || '').replace(/<\|[^>]*(?:>|$)/g, '').trim();
export const cleanTutorCaption = clean;
const canonical = value => clean(value).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
export const FACT_KEYS = ['name', 'home', 'food', 'drink', 'place', 'time', 'companion'];

// Exact prompts keep the tested skill and listening answer key under server control.
const templates = {
  interaction: [
    [['お名前は何ですか？', 'name'], ['どこに住んでいますか？', 'home'], ['好きな食べ物は何ですか？', 'food']],
    [['私の住んでいる場所について、一つ質問してください。', 'ask_home'], ['私の好きな食べ物について、一つ質問してください。', 'ask_food']],
    [['お店が休みです。別のお店と家での食事、どちらにしますか？', 'alternative'], ['友達が遅れます。先に注文しますか、待ちますか？', 'waiting']],
    [['別のお店は遠いです。近くで食べたい友達に、別の案を出してください。', 'constraint'], ['友達は肉を食べません。二人で何を注文するか、提案してください。', 'negotiate']]
  ],
  vocabulary: [
    [['好きな食べ物は何ですか？', 'food'], ['好きな飲み物は何ですか？', 'drink'], ['よく行く場所はどこですか？', 'place']],
    [['{food}はどんな味ですか？', 'food_taste'], ['{drink}はどんな味ですか？', 'drink_taste']],
    [['甘い{drink}と、甘くない{drink}は、どう違いますか？', 'taste_difference'], ['大きいお店と小さいお店は、どう違いますか？', 'place_difference']],
    [['{food}の名前を使わないで、どんな食べ物か説明してください。', 'describe_food'], ['{drink}の名前を使わないで、どんな飲み物か説明してください。', 'describe_drink']]
  ],
  production: [
    [['いつ{food}を食べますか？', 'time'], ['どこで{food}を食べますか？', 'place']],
    [['昨日は何を食べましたか？', 'past_food'], ['先週は何を飲みましたか？', 'past_drink']],
    [['どうして{food}が好きですか？', 'food_reason'], ['どうして{drink}が好きですか？', 'drink_reason']],
    [['{food}を食べたくないのは、どんなときですか？', 'food_exception'], ['外で食べるより、家で食べたいのは、どんなときですか？', 'place_exception']]
  ],
  listening: [
    [['私は日曜日に{food}を食べます。いつ食べますか？', 'listen_day', '日曜日'], ['私は家で{drink}を飲みます。どこで飲みますか？', 'listen_place', '家']],
    [['私は土曜日に家で{food}を食べます。何曜日に食べますか？', 'listen_two_day', '土曜日'], ['私は月曜日に友達と{drink}を飲みます。誰と飲みますか？', 'listen_two_person', '友達']],
    [['今日は寒いので、温かい{drink}を飲みます。どうして温かいものを飲みますか？', 'listen_reason', '寒い'], ['お店が休みなので、家で{food}を食べます。どうして家で食べますか？', 'listen_closed', 'お店が休み']],
    [['{food}も食べたいですが、今日はパンにします。今日は何を食べますか？', 'listen_contrast_food', 'パン'], ['お茶にしようと思いましたが、やはり水にします。何を飲みますか？', 'listen_contrast_drink', '水']]
  ]
};

export function createProbeContract(state, domain, band) {
  const candidates = templates[domain][band];
  const used = new Set((state.exchanges || []).filter(e => e.validity === 'valid').map(e => e.templateId));
  const known = new Set((state.facts || []).map(f => f.key));
  const eligible = candidates.filter(t => !FACT_KEYS.includes(t[1]) || !known.has(t[1]));
  const pool = eligible.length ? eligible : candidates;
  const fresh = eligible.find(t => !used.has(t[1]));
  const answered = (state.exchanges || []).filter(e => e.validity === 'valid' && e.intent === 'answer');
  const delayed = candidates.find(t => {
    const index = answered.findLastIndex(e => e.templateId === t[1]);
    return index >= 0 && answered.length - index > 2;
  });
  const template = fresh || delayed || pool[0];
  const slots = { food: 'ご飯', drink: 'お茶' };
  for (const fact of state.facts || []) if (['food', 'drink'].includes(fact.key)
    && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,16}$/u.test(fact.valueJa)) slots[fact.key] = fact.valueJa;
  const promptJa = template[0].replace(/\{(food|drink)\}/g, (_, key) => slots[key]);
  return { version: PROBE_CONTRACT_VERSION, templateId: template[1], promptJa,
    exhausted: !fresh && !delayed,
    hintJa: template[1] === 'ask_home' ? '「どこ」で質問を始めてください。'
      : template[1] === 'ask_food' ? '「何」で質問を始めてください。'
        : template[1] === 'past_food' ? '「〜を食べました」で答えられます。'
          : template[1] === 'past_drink' ? '「〜を飲みました」で答えられます。'
            : domain === 'production' ? '一つの短い文で大丈夫です。' : '一言で答えても大丈夫です。',
    tutorAnswerJa: template[1] === 'ask_home' ? '私は東京に住んでいます。'
      : template[1] === 'ask_food' ? '私はおすしが好きです。' : '',
    responseType: domain === 'listening' ? 'retrieve_supplied_fact' : domain === 'interaction' && band > 0 ? 'perform_task' : 'personal_answer',
    facts: domain === 'listening' ? [promptJa.split('。')[0]] : [], expectedAnswer: template[2] || '',
    factKey: FACT_KEYS.includes(template[1]) ? template[1] : '', retrieval: !fresh && Boolean(delayed) };
}

export function validateSpokenProbe(question, spoken, exchanges = []) {
  const contract = question?.contract;
  if (!contract) return { validity: 'uncertain', reason: 'No recorded probe contract.' };
  const actual = canonical(spoken);
  if (!actual) return { validity: 'uncertain', reason: 'The spoken question was not captured.' };
  if (!actual.includes(canonical(contract.promptJa))) return { validity: 'invalid', reason: 'The spoken question changed or omitted the contracted task.' };
  if (contract.responseType === 'retrieve_supplied_fact' && (!contract.expectedAnswer || !contract.facts.length)) {
    return { validity: 'invalid', reason: 'Listening information or its answer key is missing.' };
  }
  if (!contract.retrieval && exchanges.some(e => e.questionId !== question.id && e.validity === 'valid'
    && e.intent === 'answer' && canonical(e.prompt) === canonical(contract.promptJa))) {
    return { validity: 'invalid', reason: 'The question was already answered.' };
  }
  return { validity: 'valid', reason: '' };
}

export function captureSpokenProbe(question, transcript, rowId) {
  if (!question) return false;
  const approvedReplacement = validateSpokenProbe(question, transcript).validity === 'valid';
  if (question.spokenRowId !== rowId && question.spokenText && !approvedReplacement) return false;
  if (!question.spokenText && !/[?？]|ですか|ますか|ください|質問|どうぞ/.test(transcript)) return false;
  question.spokenText = transcript; question.spokenRowId = rowId;
  return true;
}

export function learnerIntentOverride(transcript, prompt = '') {
  const value = clean(transcript);
  if (/もう.{0,4}言いました|already (?:told|said|answered)/i.test(value)) return 'already_answered';
  if (/終わりましたか|終わりですか|あと.{0,5}(分|どのくらい)|(?:are we|is (?:the|this)).*(?:done|finished)|how much longer/i.test(value)) return 'session_status';
  if (/質問.{0,3}(?:ありません|ない)|no questions/i.test(value)
    && /質問.{0,6}ありますか|any questions/i.test(prompt)) return 'optional_decline';
  if (/意味は何|どういう意味|what does.+mean|what.+means|もう一度|ゆっくり|repeat|slower/i.test(value)) return 'clarification';
  return null;
}

export function groupLogicalTutorTurns(turns, exchanges = []) {
  const owners = new Map();
  for (const answer of exchanges) for (const rowId of answer.rowIds || []) owners.set(rowId, answer);
  const result = []; const grouped = new Map();
  for (const turn of turns) {
    const transcript = clean(turn.transcript);
    if (!transcript) continue;
    const answer = turn.role === 'user' ? owners.get(turn.turnId || turn.id) : null;
    if (!answer) { result.push({ ...turn, transcript }); continue; }
    let row = grouped.get(answer.turnId);
    if (!row) {
      row = { ...turn, id: answer.turnId, turnId: answer.turnId, transcript: clean(answer.answer),
        sourceTurnIds: [], audioClipIds: [] };
      grouped.set(answer.turnId, row); result.push(row);
    }
    row.sourceTurnIds.push(turn.turnId || turn.id);
    row.audioClipIds.push(...(turn.audioClipIds || []));
    row.endedAt = Math.max(row.endedAt || 0, turn.endedAt || 0);
  }
  return result;
}
