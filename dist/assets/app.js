const PROXY_DICT_ENDPOINT = '/api/lookup?keyword=';
const VOCAB_API_ENDPOINT = '/api/vocab';
const VOCAB_RESOLVE_ENDPOINT = '/api/vocab-resolve';
const SHARE_USER_API_ENDPOINT = '/api/share-user';
const WORKFLOW_TRANSITION_API_ENDPOINT = '/api/workflow-transition';
const AUTH_SESSION_ENDPOINT = '/api/auth/session';
const AUTH_GOOGLE_START_ENDPOINT = '/api/auth/google/start';
const AUTH_LOGOUT_ENDPOINT = '/api/auth/logout';
const WORKSPACE_ENDPOINT = '/api/workspace';
const SYNTHETIC_DOCUMENT_ENDPOINT = '/api/synthetic-document';
const vocabApiEnabled = typeof window !== 'undefined'
  && window.location
  && window.location.protocol !== 'file:';
let vocabApiAvailable = vocabApiEnabled;
const STORAGE_KEYS = {
  entry: 'jc_entry',
  vocab: 'jc_vocab_list',
  questions: 'jc_questions',
  documents: 'jc_documents',
  activeDocument: 'jc_active_document',
  deletedDocuments: 'jc_deleted_documents'
};
const MAX_IMAGES_PER_DOCUMENT = 8;
const MAX_DOCUMENT_IMAGE_SOURCE_LENGTH = 500000;
const IMAGE_PROCESSING_STEPS = [
  { maxEdge: 1400, quality: 0.82 },
  { maxEdge: 1200, quality: 0.76 },
  { maxEdge: 960, quality: 0.72 }
];

const kanjiRegex = /[\u3400-\u9fff]/;
const japaneseCharRange =
  '\u3005\u3006\u3007\u303b\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d';
const japaneseCharRegex = new RegExp(`[${japaneseCharRange}]`);
const japaneseEdgeRegex = new RegExp(`^[^${japaneseCharRange}]+|[^${japaneseCharRange}]+$`, 'g');
const japaneseRunRegex = new RegExp(`[${japaneseCharRange}]+`, 'g');
const kanaRegex = /[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]/;
const japanesePunctuationRegex = /^[\u3001\u3002\u30fb\u300c\u300d]+$/;
const smallKanaRegex = /[ゃゅょぁぃぅぇぉャュョァィゥェォ]/;
const smallTsuRegex = /[っッ]/;
const monthTokenRegex = /^[0-9\uFF10-\uFF19]+月$/;
const tokenizableCharRange = `${japaneseCharRange}0-9\uFF10-\uFF19`;
const tokenizableRunRegex = new RegExp(`[${tokenizableCharRange}]+`, 'g');
const WORKFLOW_ROLES = new Set(['student', 'teacher']);
const WORKFLOW_STATUSES = new Set(['draft', 'submitted', 'reviewed', 'revision_requested', 'final']);
const WORKFLOW_TRANSITION_ACTIONS = new Set(['submit', 'return_review', 'mark_final']);
const WORKFLOW_EVENT_ACTIONS = new Set(['share_start', 'share_update', 'submit', 'return_review', 'mark_final']);
const WORKSPACE_POLL_INTERVAL_MS = 1200;
function getDefaultDocumentTitle() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return `${month}\u6708${day}\u65e5`;
}
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('ja', { granularity: 'word' })
  : null;
const correctionSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
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

const i18n = {
  en: {
    appTitle: 'Japanese Composer',
    appSubtitle: 'Journal workspace with furigana and vocab support',
    editorTitle: 'Composer',
  editorSubtitle: 'Write in English or Japanese — switch to Reading Mode for furigana and kanji details.',
    vocabularyTitle: 'Vocabulary',
    vocabularySubtitle: 'Saved words from all your posts.',
    pageCompose: 'Compose',
    pageVocabulary: 'Vocabulary',
    vocabPostTitle: 'Source post',
    allVocabEmpty: 'No vocabulary found in saved posts.',
    syntheticTitle: 'Synthetic document',
    syntheticDifficultyLabel: 'Reading difficulty',
    syntheticCategoryLabel: 'Text category',
    reviewModeLabel: 'Review mode',
    reviewModeSynthetic: 'Synthetic document',
    reviewModeFlashcard: 'Flashcard review',
    syntheticSelectLabel: 'Select',
    syntheticGenerate: 'Generate',
    syntheticGenerating: 'Generating synthetic document…',
    syntheticNoSelection: 'Select at least one vocab item to generate.',
    syntheticSelectCount: 'Selected',
    flashcardReviewTitle: 'Flashcard review',
    flashcardReviewSubtitle: 'Type the kana or kanji for this meaning.',
    flashcardStart: 'Start review',
    flashcardExitLabel: 'Exit',
    flashcardDeckLabel: 'Deck Review',
    flashcardMeaningLabel: 'Meaning',
    flashcardAnswerLabel: 'Type kana or kanji',
    flashcardSubmit: 'Check',
    flashcardCorrect: 'Correct!',
    flashcardIncorrect: 'Incorrect.',
    flashcardIncorrectRetry: 'Incorrect. This word will appear again once.',
    flashcardProgressLabel: 'Review progress',
    flashcardCompleted: 'Review complete',
    flashcardCompletedTitle: 'Review complete',
    flashcardCorrectLabel: 'Correct',
    flashcardMissedLabel: 'Missed',
    flashcardScoreLabel: 'Score',
    syntheticResultTitle: 'Generated text',
    syntheticResultEmpty: 'Select vocab items and click Generate to create a synthetic document.',
    syntheticRequestError: 'Failed to generate synthetic document.',
    syntheticInvalidResponse: 'AI returned no synthetic text.',
    syntheticCategoryNews: 'News Article',
    syntheticCategoryFiction: 'Fiction Novel',
    syntheticCategoryTechnical: 'Technical Writing',
    syntheticCategoryPoetry: 'Poetry',
    syntheticCategoryEssay: 'Essay',
    syntheticCategoryDiary: 'Diary',
    editorPlaceholder: 'Write your journal entry here...',
    documentTitleLabel: 'Document title',
    documentTitlePlaceholder: 'Give this entry a title...',
    documentDrawerTitle: 'Saved documents',
    documentDrawerSubtitle: 'Open a saved document',
    documentOwnedSectionTitle: 'Your documents',
    documentSharedSectionTitle: 'Shared with you',
    documentListEmpty: 'No documents yet.',
    documentSharedEmpty: 'No shared documents.',
    documentCreatedLabel: 'Created:',
    documentNew: 'New',
    documentSave: 'Save',
    documentSaved: 'Saved',
    documentDelete: 'Delete',
    documentDeleteConfirm: 'Delete this document? This cannot be undone.',
    documentUntitled: 'Untitled entry',
    imageGalleryTitle: 'Pictures',
    imageGallerySubtitle: 'Drop photos into this document and open them at full size when needed.',
    imageGalleryBrowse: 'Browse',
    imageGalleryDropHint: 'Drop images here or click to browse.',
    imageGalleryDropActive: 'Release to add these images.',
    imageGalleryEmpty: 'No pictures yet for this document.',
    imageGalleryProcessing: 'Preparing {count} image(s)…',
    imageGalleryAdded: 'Added {count} image(s).',
    imageGallerySkipped: 'Skipped {count} file(s).',
    imageGalleryLimitReached: 'You can add up to {count} images per document.',
    imageGalleryUnsupported: 'Only image files can be added here.',
    imageGalleryProcessError: 'One or more images could not be processed.',
    imageGalleryRemove: 'Remove image',
    imageGalleryZoom: 'Open image',
    imageGalleryUntitled: 'Untitled image',
    imageLightboxClose: 'Close',
    previewEmpty: 'Switch to edit mode to enable editing',
    vocabTitle: 'Vocabulary',
    vocabSubtitle: 'Saved words from your journal entry.',
    vocabEmpty: 'No vocabulary yet. Hover a kanji and add it here.',
    vocabMeaning: 'Meaning',
    vocabKana: 'Kana',
    vocabKanji: 'Kanji',
    vocabAdd: 'Add',
    vocabDelete: 'Delete',
    vocabEdit: 'Edit',
    vocabSave: 'Save',
    selectionTitle: 'Selection',
    selectionTranslate: 'Translate',
    selectionCopy: 'Copy',
    selectionAsk: 'Ask',
    selectionAskLabel: 'Ask about selected text',
    selectionAskPlaceholder: 'Ask a question about this text...',
    selectionAskSubmit: 'Send',
    selectionAddToVocab: 'Add to vocab',
    selectionAddToVocabLoading: 'Adding to vocab…',
    selectionAddToVocabSuccess: 'Added to vocab.',
    selectionAddToVocabDuplicate: 'Already in vocab.',
    selectionAddToVocabMissing: 'No matching kanji entry found.',
    selectionAddToVocabError: 'Failed to add.',
    selectionCopied: 'Copied',
    selectionLoading: 'Translating…',
    selectionError: 'Translation failed.',
    selectionRomaji: 'Romaji',
    furiganaOn: 'Furigana: On',
    furiganaOff: 'Furigana: Off',
    vocabOn: 'Vocab: On',
    vocabOff: 'Vocab: Off',
    languageToggle: '日本語 UI',
    modeEdit: 'Mode: Edit',
    modeRead: 'Mode: Reading',
    modeCorrections: 'Mode: Corrections',
    addToVocab: 'Add to vocab',
    clear: 'Clear',
    collapse: 'Collapse',
    expand: 'Expand',
    loading: 'Looking up…',
    missingExact: 'No exact dictionary match found.',
    dictionaryFormLabel: 'Dictionary form',
    proofreadTitle: 'AI Proofreader',
    proofreadSubtitle: 'Send the full entry to OpenAI for JLPT feedback and corrections.',
    proofreadButton: 'Proofread',
    proofreadEmpty: 'No feedback yet. Click Proofread to analyze your entry.',
    proofreadLoading: 'Proofreading…',
    proofreadError: 'Proofreading failed.',
    proofreadMissing: 'Enter some text to proofread.',
    proofreadUpdated: 'Last updated',
    selectionAskLoading: 'Asking…',
    selectionAskError: 'Question failed.',
    selectionAskMissing: 'Enter a question to ask.',
    questionsTitle: 'Questions',
    questionsSubtitle: 'Your Q&A about selected text.',
    questionsEmpty: 'No questions yet. Select text and ask a question.',
    questionsSelectedLabel: 'Selected text',
    questionsQuestionLabel: 'Question',
    questionsAnswerLabel: 'Answer',
    shareTitle: 'Share with Google User',
    shareSubtitle: 'Send this entry to another signed-in user by email.',
    shareUserLabel: 'Google account email',
    shareUserPlaceholder: 'friend@gmail.com',
    shareSend: 'Start shared review',
    shareRequiresAuth: 'Sign in to share with another user.',
    shareMissingEmail: 'Enter a recipient email.',
    shareMissingText: 'Enter some text or add pictures to share.',
    shareSuccess: 'Shared review started.',
    shareError: 'Sharing failed.',
    workflowPanelTitle: 'Shared Review Workflow',
    workflowPanelSubtitle: 'Submit and return this entry without creating renamed copies.',
    workflowRoleLabel: 'Your role',
    workflowPartnerLabel: 'Partner',
    workflowStatusLabel: 'Status',
    workflowUpdatedLabel: 'Last transition',
    workflowHistoryTitle: 'History',
    workflowRoleStudent: 'Student',
    workflowRoleTeacher: 'Teacher',
    workflowStatusDraft: 'Draft',
    workflowStatusSubmitted: 'Submitted',
    workflowStatusReviewed: 'Reviewed',
    workflowStatusRevisionRequested: 'Revision requested',
    workflowStatusFinal: 'Final',
    workflowActionSubmit: 'Submit for review',
    workflowActionReturnReview: 'Return to student',
    workflowActionMarkFinal: 'Mark final',
    workflowNoHistory: 'No transitions yet.',
    workflowHintSubmittedStudent: 'Waiting for the teacher to return feedback.',
    workflowHintSubmittedTeacher: 'Review in Corrections mode, then return to student.',
    workflowHintRevisionStudent: 'Teacher requested another revision.',
    workflowHintReviewedStudent: 'Teacher returned edits. Revise and submit again or mark final.',
    workflowHintReviewedTeacher: 'Returned to student.',
    workflowHintFinal: 'Review workflow complete.',
    workflowStartError: 'Start shared review first.',
    workflowTransitionError: 'Workflow update failed.',
    workflowTransitionSuccess: 'Workflow updated.',
    workflowEventShared: 'Shared and submitted',
    workflowEventSubmit: 'Submitted for review',
    workflowEventReturnReview: 'Returned review',
    workflowEventMarkFinal: 'Marked final',
    workflowEventTo: 'to',
    workflowActorUnknown: 'User',
    correctionsTitle: 'Tracked Changes',
    correctionsSubtitle: 'Tracked edits from the original text.',
    correctionsEmpty: 'No tracked edits yet.',
    correctionsResetConfirm: 'Making an edit to your post after corrections have been added will clear all tracked corrections. Do you want to continue?',
    authSignIn: 'Sign in with Google',
    authSignOut: 'Sign out',
    authDisabled: 'Google sign-in unavailable.',
    authUserFallback: 'Signed in',
    authSyncLocal: 'Local-only mode.',
    authSyncReady: 'Account sync ready.',
    authSyncing: 'Account sync: Syncing…',
    authSynced: 'Account sync',
    authSyncError: 'Account sync failed.',
    authGateEyebrow: 'Private workspace',
    authGateTitle: 'Sign in with Google to continue',
    authGateMessage: 'Only approved Google accounts can access this application.',
    authGateLoading: 'Checking your session…',
    authGateSessionUnavailable: 'Unable to verify access. Reload and try again.',
    authGateFailed: 'Sign-in failed. Try again.',
    authGateDenied: 'This Google account is not allowed to access the app.',
    authGateUnavailable: 'Google sign-in is not configured on this server.'
  },
  ja: {
    appTitle: '日本語コンポーザー',
    appSubtitle: 'ふりがな・語彙リスト付きの作文ワークスペース',
    editorTitle: '作文',
    editorSubtitle: '英語でも日本語でも入力できます。読むモードでふりがなと漢字情報を表示。',
    vocabularyTitle: '語彙',
    vocabularySubtitle: '全投稿の保存済み語彙を表示します。',
    pageCompose: '作文',
    pageVocabulary: '語彙',
    vocabPostTitle: '投稿元',
    allVocabEmpty: '保存済み投稿に語彙がありません。',
    syntheticTitle: '合成作文',
    syntheticDifficultyLabel: '難易度',
    syntheticCategoryLabel: 'カテゴリ',
    reviewModeLabel: '復習モード',
    reviewModeSynthetic: '合成作文',
    reviewModeFlashcard: 'フラッシュカード復習',
    syntheticSelectLabel: '選択',
    syntheticGenerate: '生成',
    syntheticGenerating: '合成作文を生成中…',
    syntheticNoSelection: '語彙を1つ以上選択してください。',
    syntheticSelectCount: '選択数',
    flashcardReviewTitle: 'フラッシュカード復習',
    flashcardReviewSubtitle: '英語の意味を読んで、かなまたは漢字を入力してください。',
    flashcardStart: '復習開始',
    flashcardExitLabel: '終了',
    flashcardDeckLabel: 'デッキ復習',
    flashcardMeaningLabel: '意味',
    flashcardAnswerLabel: 'かな/漢字を入力',
    flashcardSubmit: 'チェック',
    flashcardCorrect: '正解！',
    flashcardIncorrect: '不正解。',
    flashcardIncorrectRetry: '不正解です。あとで再出題します。',
    flashcardProgressLabel: '進捗',
    flashcardCompleted: '復習完了',
    flashcardCompletedTitle: '復習結果',
    flashcardCorrectLabel: '正解',
    flashcardMissedLabel: '未クリア',
    flashcardScoreLabel: 'スコア',
    syntheticResultTitle: '生成結果',
    syntheticResultEmpty: '語彙を選択して生成を押すと結果が表示されます。',
    syntheticRequestError: '合成作文の生成に失敗しました。',
    syntheticInvalidResponse: 'AIから本文を受け取れませんでした。',
    syntheticCategoryNews: 'ニュース記事',
    syntheticCategoryFiction: '小説',
    syntheticCategoryTechnical: '解説記事',
    syntheticCategoryPoetry: '詩',
    syntheticCategoryEssay: '小論文',
    syntheticCategoryDiary: '日記',
    editorPlaceholder: 'ここに日記を書いてください…',
    documentTitleLabel: 'タイトル',
    documentTitlePlaceholder: 'この作文のタイトルを入力…',
    documentDrawerTitle: '保存した作文',
    documentDrawerSubtitle: '保存した作文を開く',
    documentOwnedSectionTitle: '自分の作文',
    documentSharedSectionTitle: '共有された作文',
    documentListEmpty: 'まだ作文がありません。',
    documentSharedEmpty: '共有された作文はありません。',
    documentCreatedLabel: '作成日:',
    documentNew: '新規',
    documentSave: '保存',
    documentSaved: '保存済み',
    documentDelete: '削除',
    documentDeleteConfirm: 'この作文を削除しますか？元に戻せません。',
    documentUntitled: '無題',
    imageGalleryTitle: '画像',
    imageGallerySubtitle: 'この作文に画像を追加して、必要なときに拡大表示できます。',
    imageGalleryBrowse: '参照',
    imageGalleryDropHint: 'ここに画像をドロップ、またはクリックして追加します。',
    imageGalleryDropActive: 'ドロップして画像を追加します。',
    imageGalleryEmpty: 'この作文にはまだ画像がありません。',
    imageGalleryProcessing: '{count}件の画像を準備中…',
    imageGalleryAdded: '{count}件の画像を追加しました。',
    imageGallerySkipped: '{count}件のファイルをスキップしました。',
    imageGalleryLimitReached: '1つの作文に追加できる画像は{count}件までです。',
    imageGalleryUnsupported: '画像ファイルのみ追加できます。',
    imageGalleryProcessError: '一部の画像を処理できませんでした。',
    imageGalleryRemove: '画像を削除',
    imageGalleryZoom: '画像を開く',
    imageGalleryUntitled: '無題の画像',
    imageLightboxClose: '閉じる',
    previewEmpty: '入力するとここに表示されます。',
    vocabTitle: '語彙リスト',
    vocabSubtitle: '日記から保存した単語を表示します。',
    vocabEmpty: 'まだ語彙がありません。漢字から追加しましょう。',
    vocabMeaning: '意味',
    vocabKana: 'かな',
    vocabKanji: '漢字',
    vocabAdd: '追加',
    vocabDelete: '削除',
    vocabEdit: '編集',
    vocabSave: '保存',
    selectionTitle: '選択',
    selectionTranslate: '翻訳',
    selectionCopy: 'コピー',
    selectionAsk: '質問',
    selectionAskLabel: '選択テキストについて質問',
    selectionAskPlaceholder: '選択したテキストについて質問…',
    selectionAskSubmit: '送信',
    selectionAddToVocab: '語彙に追加',
    selectionAddToVocabLoading: '語彙に追加中…',
    selectionAddToVocabSuccess: '語彙に追加しました。',
    selectionAddToVocabDuplicate: '既に語彙に追加済みです。',
    selectionAddToVocabMissing: '該当する漢字語が見つかりません。',
    selectionAddToVocabError: '追加に失敗しました。',
    selectionCopied: 'コピーしました',
    selectionLoading: '翻訳中…',
    selectionError: '翻訳に失敗しました。',
    selectionRomaji: 'ローマ字',
    furiganaOn: 'ふりがな: あり',
    furiganaOff: 'ふりがな: なし',
    vocabOn: '語彙: 表示',
    vocabOff: '語彙: 非表示',
    languageToggle: 'English UI',
    modeEdit: 'モード: 編集',
    modeRead: 'モード: 閲覧',
    modeCorrections: 'モード: 添削',
    addToVocab: '語彙に追加',
    clear: 'クリア',
    collapse: '折りたたむ',
    expand: '展開',
    loading: '検索中…',
    missingExact: '一致する辞書項目が見つかりません。',
    dictionaryFormLabel: '辞書形',
    proofreadTitle: '添削フィードバック',
    proofreadSubtitle: '全文をOpenAIに送ってJLPT判定と添削を受けます。',
    proofreadButton: '添削する',
    proofreadEmpty: 'まだフィードバックがありません。添削するをクリックしてください。',
    proofreadLoading: '添削中…',
    proofreadError: '添削に失敗しました。',
    proofreadMissing: 'まずテキストを入力してください。',
    proofreadUpdated: '更新',
    selectionAskLoading: '質問中…',
    selectionAskError: '質問に失敗しました。',
    selectionAskMissing: '質問を入力してください。',
    questionsTitle: '質問',
    questionsSubtitle: '選択テキストに関するQ&A。',
    questionsEmpty: 'まだ質問がありません。テキストを選択して質問してください。',
    questionsSelectedLabel: '選択テキスト',
    questionsQuestionLabel: '質問',
    questionsAnswerLabel: '回答',
    shareTitle: 'Googleユーザー共有',
    shareSubtitle: 'ログイン済みのユーザーにメールでこの作文を共有します。',
    shareUserLabel: 'Googleアカウントのメール',
    shareUserPlaceholder: 'friend@gmail.com',
    shareSend: '添削ワークフロー開始',
    shareRequiresAuth: '共有するにはログインしてください。',
    shareMissingEmail: '共有先メールを入力してください。',
    shareMissingText: '共有するテキストを入力するか、画像を追加してください。',
    shareSuccess: 'ワークフローを開始しました。',
    shareError: '共有に失敗しました。',
    workflowPanelTitle: '共有添削ワークフロー',
    workflowPanelSubtitle: '名前を変えたコピーを作らずに提出と返却を行います。',
    workflowRoleLabel: 'あなたの役割',
    workflowPartnerLabel: '相手',
    workflowStatusLabel: 'ステータス',
    workflowUpdatedLabel: '最終遷移',
    workflowHistoryTitle: '履歴',
    workflowRoleStudent: '学習者',
    workflowRoleTeacher: '先生',
    workflowStatusDraft: '下書き',
    workflowStatusSubmitted: '提出済み',
    workflowStatusReviewed: '返却済み',
    workflowStatusRevisionRequested: '再提出依頼',
    workflowStatusFinal: '完了',
    workflowActionSubmit: '添削を依頼',
    workflowActionReturnReview: '学習者へ返却',
    workflowActionMarkFinal: '完了にする',
    workflowNoHistory: 'まだ遷移履歴がありません。',
    workflowHintSubmittedStudent: '先生の返却を待っています。',
    workflowHintSubmittedTeacher: '添削モードで編集して返却してください。',
    workflowHintRevisionStudent: '先生から再提出依頼があります。',
    workflowHintReviewedStudent: '先生が返却しました。修正して再提出するか完了にしてください。',
    workflowHintReviewedTeacher: '学習者へ返却済みです。',
    workflowHintFinal: 'ワークフローは完了しました。',
    workflowStartError: '先に共有ワークフローを開始してください。',
    workflowTransitionError: 'ワークフロー更新に失敗しました。',
    workflowTransitionSuccess: 'ワークフローを更新しました。',
    workflowEventShared: '共有して提出',
    workflowEventSubmit: '添削依頼',
    workflowEventReturnReview: '返却',
    workflowEventMarkFinal: '完了',
    workflowEventTo: 'へ',
    workflowActorUnknown: 'ユーザー',
    correctionsTitle: '添削履歴',
    correctionsSubtitle: '元の文章からの変更点を表示します。',
    correctionsEmpty: 'まだ変更はありません。',
    correctionsResetConfirm: '添削履歴がある状態で投稿を編集すると、履歴はすべて消去されます。続けますか？',
    authSignIn: 'Googleでログイン',
    authSignOut: 'ログアウト',
    authDisabled: 'Googleログインは利用できません。',
    authUserFallback: 'ログイン中',
    authSyncLocal: 'ローカル保存モードです。',
    authSyncReady: 'アカウント同期の準備完了。',
    authSyncing: 'アカウント同期中…',
    authSynced: 'アカウント同期',
    authSyncError: 'アカウント同期に失敗しました。',
    authGateEyebrow: '限定ワークスペース',
    authGateTitle: '続行するにはGoogleでログインしてください',
    authGateMessage: '許可されたGoogleアカウントのみこのアプリを利用できます。',
    authGateLoading: 'セッションを確認中…',
    authGateSessionUnavailable: 'アクセス確認に失敗しました。再読み込みしてもう一度お試しください。',
    authGateFailed: 'ログインに失敗しました。もう一度お試しください。',
    authGateDenied: 'このGoogleアカウントにはアクセス権がありません。',
    authGateUnavailable: 'このサーバーではGoogleログインが設定されていません。'
  }
};

const state = {
  documentId: '',
  title: '',
  documents: [],
  text: '',
  images: [],
  showFurigana: true,
  showVocab: true,
  activePage: 'compose',
  language: 'en',
  mode: 'edit',
  vocab: [],
  questions: [],
  correctionsBaseText: '',
  workflow: null
};

const SYNTHETIC_DIFFICULTIES = ['N5', 'N4', 'N3', 'N2', 'N1'];
const SYNTHETIC_CATEGORIES = [
  { value: 'News Article', copyKey: 'syntheticCategoryNews' },
  { value: 'Fiction Novel', copyKey: 'syntheticCategoryFiction' },
  { value: 'Technical Writing', copyKey: 'syntheticCategoryTechnical' },
  { value: 'Poetry', copyKey: 'syntheticCategoryPoetry' },
  { value: 'Essay', copyKey: 'syntheticCategoryEssay' },
  { value: 'Diary', copyKey: 'syntheticCategoryDiary' }
];
const FLASHCARD_MODES = {
  synthetic: 'synthetic',
  flashcard: 'flashcard'
};

const syntheticDocumentState = {
  difficulty: SYNTHETIC_DIFFICULTIES[0],
  category: SYNTHETIC_CATEGORIES[0].value,
  selectedVocabularyIds: new Set(),
  status: 'idle',
  text: '',
  error: ''
};

const flashcardReviewState = {
  mode: FLASHCARD_MODES.synthetic,
  phase: 'idle',
  selectedCount: 0,
  deck: [],
  currentCard: null,
  correct: [],
  missed: [],
  feedbackMessage: '',
  feedbackType: '',
  inputLocked: false
};

const proofreadState = {
  status: 'idle',
  content: '',
  error: '',
  updatedAt: null
};

const shareState = {
  sending: false,
  message: '',
  error: '',
  lastSharedAt: null
};

const imageGalleryState = {
  dragActive: false,
  status: 'idle',
  message: '',
  activeImageId: ''
};

const authState = {
  enabled: false,
  required: false,
  loading: true,
  authenticated: false,
  user: null,
  syncing: false,
  syncError: '',
  lastSyncedAt: null,
  notice: ''
};

const lookupCache = new Map();
const pendingLookups = new Map();
let pendingRender = false;
let pendingCorrectionsRender = false;
let pendingCorrectionResetOnInput = false;
let vocabSaveQueue = Promise.resolve();
let editingVocabIndex = null;
let workspaceSyncTimer = null;
let workspaceSyncPending = null;
let workspaceSyncInFlight = false;
let workspaceRefreshTimer = null;
let workspaceRefreshInFlight = false;
let workspaceHydrating = false;
let localStateLoaded = false;
let workspaceDeletedDocumentIds = new Set();
let flashcardAdvanceTimer = null;

function enqueueVocabApiTask(task) {
  vocabSaveQueue = vocabSaveQueue
    .then(() => task())
    .catch(() => {});
}
let kuromojiTokenizer = null;
let kuromojiInitPromise = null;

const app = document.querySelector('#app');
const composerInput = document.querySelector('#composer-input');
const documentTitleInput = document.querySelector('#document-title');
const documentTitleLabel = document.querySelector('#document-title-label');
const documentsDrawer = document.querySelector('#documents-drawer');
const documentsDrawerBody = document.querySelector('#documents-drawer-body');
const documentsDrawerTitle = document.querySelector('#documents-drawer-title');
const documentsDrawerSubtitle = document.querySelector('#documents-drawer-subtitle');
const documentsDrawerToggle = document.querySelector('#documents-drawer-toggle');
const documentsList = document.querySelector('#document-list');
const documentSave = document.querySelector('#document-save');
const documentNew = document.querySelector('#document-new');
const preview = document.querySelector('#preview');
const imageGalleryTitle = document.querySelector('#image-gallery-title');
const imageGallerySubtitle = document.querySelector('#image-gallery-subtitle');
const imageGalleryBrowse = document.querySelector('#image-gallery-browse');
const imageGalleryInput = document.querySelector('#image-gallery-input');
const imageDropzone = document.querySelector('#image-dropzone');
const imageDropzoneCopy = document.querySelector('#image-dropzone-copy');
const imageDropzoneStatus = document.querySelector('#image-dropzone-status');
const imageGalleryGrid = document.querySelector('#image-gallery-grid');
const correctionsPanel = document.querySelector('#corrections-panel');
const correctionsTitle = document.querySelector('#corrections-title');
const correctionsSubtitle = document.querySelector('#corrections-subtitle');
const correctionsList = document.querySelector('#corrections-list');
const vocabPanel = document.querySelector('#vocab-panel');
const vocabBody = document.querySelector('#vocab-body');
const vocabCollapse = document.querySelector('#vocab-collapse');
const vocabList = document.querySelector('#vocab-list');
const questionsPanel = document.querySelector('#questions-panel');
const questionsBody = document.querySelector('#questions-body');
const questionsCollapse = document.querySelector('#questions-collapse');
const questionsTitle = document.querySelector('#questions-title');
const questionsSubtitle = document.querySelector('#questions-subtitle');
const questionsList = document.querySelector('#questions-list');
const sharePanel = document.querySelector('#share-panel');
const shareBody = document.querySelector('#share-body');
const shareCollapse = document.querySelector('#share-collapse');
const shareTitle = document.querySelector('#share-title');
const shareSubtitle = document.querySelector('#share-subtitle');
const shareForm = document.querySelector('#share-form');
const shareUserLabel = document.querySelector('#share-user-label');
const shareUserEmailInput = document.querySelector('#share-user-email');
const shareSend = document.querySelector('#share-send');
const workflowCard = document.querySelector('#workflow-card');
const workflowRoleLabel = document.querySelector('#workflow-role-label');
const workflowRoleValue = document.querySelector('#workflow-role-value');
const workflowPartnerLabel = document.querySelector('#workflow-partner-label');
const workflowPartnerValue = document.querySelector('#workflow-partner-value');
const workflowStatusLabel = document.querySelector('#workflow-status-label');
const workflowStatusValue = document.querySelector('#workflow-status-value');
const workflowUpdatedLabel = document.querySelector('#workflow-updated-label');
const workflowUpdatedValue = document.querySelector('#workflow-updated-value');
const workflowActions = document.querySelector('#workflow-actions');
const workflowHistoryTitle = document.querySelector('#workflow-history-title');
const workflowHistoryList = document.querySelector('#workflow-history-list');
const shareStatus = document.querySelector('#share-status');
const languageToggle = document.querySelector('#language-toggle');
const modeToggle = document.querySelector('#mode-toggle');
const furiganaToggle = document.querySelector('#furigana-toggle');
const vocabToggle = document.querySelector('#vocab-toggle');
const clearVocab = document.querySelector('#clear-vocab');
const authGoogle = document.querySelector('#auth-google');
const authLogout = document.querySelector('#auth-logout');
const authUser = document.querySelector('#auth-user');
const authAvatar = document.querySelector('#auth-avatar');
const authName = document.querySelector('#auth-name');
const authSyncStatus = document.querySelector('#auth-sync-status');
const authGate = document.querySelector('#auth-gate');
const authGateEyebrow = document.querySelector('#auth-gate-eyebrow');
const authGateTitle = document.querySelector('#auth-gate-title');
const authGateMessage = document.querySelector('#auth-gate-message');
const authGateGoogle = document.querySelector('#auth-gate-google');
const authGateStatus = document.querySelector('#auth-gate-status');
const proofreadTitle = document.querySelector('#proofread-title');
const proofreadSubtitle = document.querySelector('#proofread-subtitle');
const proofreadButton = document.querySelector('#proofread-button');
const proofreadMeta = document.querySelector('#proofread-meta');
const proofreadResult = document.querySelector('#proofread-result');
const composePage = document.querySelector('#compose-page');
const vocabularyPage = document.querySelector('#vocabulary-page');
const pageNavCompose = document.querySelector('#page-nav-compose');
const pageNavVocabulary = document.querySelector('#page-nav-vocabulary');
const allVocabList = document.querySelector('#all-vocab-list');
const allVocabTitle = document.querySelector('#vocabulary-page-title');
const allVocabSubtitle = document.querySelector('#vocabulary-page-subtitle');
const syntheticDifficultySelect = document.querySelector('#synthetic-difficulty');
const syntheticCategorySelect = document.querySelector('#synthetic-category');
const vocabReviewModeSelect = document.querySelector('#vocab-review-mode');
const vocabReviewModeLabel = document.querySelector('#vocab-review-mode-label');
const syntheticDifficultyField = document.querySelector('#synthetic-difficulty-field');
const syntheticCategoryField = document.querySelector('#synthetic-category-field');
const syntheticDifficultyLabel = document.querySelector('#synthetic-difficulty-label');
const syntheticCategoryLabel = document.querySelector('#synthetic-category-label');
const syntheticGenerateButton = document.querySelector('#synthetic-generate');
const syntheticStatus = document.querySelector('#synthetic-status');
const syntheticResultTitle = document.querySelector('#synthetic-result-title');
const syntheticResult = document.querySelector('#synthetic-result');
const flashcardReview = document.querySelector('#flashcard-review');
const flashcardReviewTitle = document.querySelector('#flashcard-review-title');
const flashcardReviewSubtitle = document.querySelector('#flashcard-review-subtitle');
const flashcardExit = document.querySelector('#flashcard-exit');
const flashcardStart = document.querySelector('#flashcard-start');
const flashcardCard = document.querySelector('#flashcard-card');
const flashcardProgress = document.querySelector('#flashcard-progress');
const flashcardDeckChip = document.querySelector('#flashcard-chip');
const flashcardPromptLabel = document.querySelector('#flashcard-prompt-label');
const flashcardPrompt = document.querySelector('#flashcard-prompt');
const flashcardAnswerForm = document.querySelector('#flashcard-answer-form');
const flashcardAnswerLabel = document.querySelector('#flashcard-answer-label');
const flashcardAnswer = document.querySelector('#flashcard-answer');
const flashcardCheck = document.querySelector('#flashcard-check');
const flashcardFeedback = document.querySelector('#flashcard-feedback');
const flashcardSummary = document.querySelector('#flashcard-summary');
const imageLightbox = document.querySelector('#image-lightbox');
const imageLightboxBackdrop = document.querySelector('#image-lightbox-backdrop');
const imageLightboxClose = document.querySelector('#image-lightbox-close');
const imageLightboxImage = document.querySelector('#image-lightbox-image');
const imageLightboxCaption = document.querySelector('#image-lightbox-caption');

function normalizeFlashcardInput(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function clearFlashcardAdvanceTimer() {
  if (flashcardAdvanceTimer) {
    clearTimeout(flashcardAdvanceTimer);
    flashcardAdvanceTimer = null;
  }
}

function shuffleDeck(items) {
  const deck = Array.isArray(items) ? items.slice() : [];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }
  return deck;
}

function buildFlashcardDeck(entries) {
  return shuffleDeck(entries.map((entry, index) => ({
    ...entry,
    reviewId: entry.syntheticId || `${entry.word}|${entry.reading}|${entry.meaning}|${index}`,
    attempts: 0
  })));
}

function resetFlashcardReviewState() {
  clearFlashcardAdvanceTimer();
  flashcardReviewState.phase = 'idle';
  flashcardReviewState.deck = [];
  flashcardReviewState.currentCard = null;
  flashcardReviewState.correct = [];
  flashcardReviewState.missed = [];
  flashcardReviewState.feedbackMessage = '';
  flashcardReviewState.feedbackType = '';
  flashcardReviewState.inputLocked = false;
}

function markRemainingCardsAsMissed() {
  const missed = [];
  if (flashcardReviewState.currentCard) {
    missed.push(flashcardReviewState.currentCard);
  }
  if (Array.isArray(flashcardReviewState.deck) && flashcardReviewState.deck.length) {
    missed.push(...flashcardReviewState.deck);
  }
  if (!missed.length) {
    return;
  }

  const existingMissed = new Set(flashcardReviewState.missed.map((card) => card.reviewId));
  missed.forEach((card) => {
    const reviewId = card.reviewId || `${card.word}|${card.reading || ''}|${card.meaning || ''}`;
    if (existingMissed.has(reviewId)) {
      return;
    }
    flashcardReviewState.missed.push(card);
    existingMissed.add(reviewId);
  });
}

function finalizeFlashcardReview() {
  if (flashcardReviewState.phase !== 'running') {
    return;
  }

  clearFlashcardAdvanceTimer();
  markRemainingCardsAsMissed();
  flashcardReviewState.currentCard = null;
  flashcardReviewState.deck = [];
  flashcardReviewState.feedbackMessage = '';
  flashcardReviewState.feedbackType = '';
  flashcardReviewState.inputLocked = false;
  flashcardReviewState.phase = 'complete';
  if (flashcardAnswer) {
    flashcardAnswer.value = '';
    flashcardAnswer.disabled = true;
  }
  if (flashcardCheck) {
    flashcardCheck.disabled = true;
  }
  if (flashcardCard) {
    flashcardCard.classList.remove('flashcard-card-correct', 'flashcard-card-incorrect');
  }
  renderSyntheticGeneratorPanel();
}

function setFlashcardMode(nextMode) {
  const safeMode = nextMode === FLASHCARD_MODES.flashcard ? FLASHCARD_MODES.flashcard : FLASHCARD_MODES.synthetic;
  flashcardReviewState.mode = safeMode;
  flashcardReviewState.selectedCount = 0;
  resetFlashcardReviewState();
  renderSyntheticGeneratorPanel();
}

function getFlashcardDisplayCards(entries) {
  return entries.map((entry) => ({
    ...entry,
    attempts: 0,
    reviewId: entry.syntheticId || `${entry.word}|${entry.reading}|${entry.meaning}`
  }));
}

function isFlashcardAnswerCorrect(card, answer) {
  const normalizedAnswer = normalizeFlashcardInput(answer);
  if (!normalizedAnswer) {
    return false;
  }
  const accepted = [];
  if (card.word) {
    accepted.push(card.word);
  }
  if (card.reading && card.reading !== card.word) {
    accepted.push(card.reading);
  }
  if (!accepted.length) {
    return false;
  }
  return accepted
    .map((value) => normalizeFlashcardInput(value))
    .some((value) => value === normalizedAnswer);
}

function requeueFlashcardForRetry(card) {
  const deck = flashcardReviewState.deck;
  if (!Array.isArray(deck) || !deck.length) {
    deck.push(card);
    return;
  }
  const nextIndex = deck.length === 1 ? 1 : Math.floor(Math.random() * (deck.length - 1)) + 1;
  deck.splice(nextIndex, 0, card);
}

function renderFlashcardSummaryList(title, cards, copy) {
  const block = document.createElement('div');
  block.className = 'flashcard-summary-block';

  const heading = document.createElement('h4');
  heading.className = 'flashcard-summary-title';
  heading.textContent = title;
  block.appendChild(heading);

  if (!cards.length) {
    const empty = document.createElement('p');
    empty.className = 'flashcard-summary-empty';
    empty.textContent = copy.vocabEmpty;
    block.appendChild(empty);
    return block;
  }

  const list = document.createElement('ul');
  list.className = 'flashcard-summary-list';
  cards.forEach((card) => {
    const item = document.createElement('li');
    const wordText = card.word ? `${card.word}` : '';
    const readingText = card.reading ? ` (${card.reading})` : '';
    const meaningText = card.meaning ? ` — ${card.meaning}` : '';
    item.textContent = `${wordText}${readingText}${meaningText}` || copy.vocabEmpty;
    list.appendChild(item);
  });
  block.appendChild(list);
  return block;
}

function moveToNextFlashcard() {
  if (flashcardReviewState.phase !== 'running') {
    return;
  }
  clearFlashcardAdvanceTimer();

  if (!flashcardReviewState.deck.length) {
    finalizeFlashcardReview();
    return;
  }

  flashcardReviewState.currentCard = flashcardReviewState.deck.shift();
  flashcardReviewState.feedbackMessage = '';
  flashcardReviewState.feedbackType = '';
  flashcardReviewState.inputLocked = false;
  if (flashcardAnswer) {
    flashcardAnswer.value = '';
    flashcardAnswer.disabled = false;
    requestAnimationFrame(() => {
      flashcardAnswer.focus();
    });
  }
  renderSyntheticGeneratorPanel();
}

function startFlashcardReview() {
  const copy = i18n[state.language];
  const selectedEntries = getSelectedSyntheticEntries();
  if (!selectedEntries.length) {
    flashcardReviewState.feedbackMessage = copy.syntheticNoSelection;
    flashcardReviewState.feedbackType = 'error';
    flashcardReviewState.phase = 'idle';
    flashcardReviewState.currentCard = null;
    renderSyntheticGeneratorPanel();
    return;
  }

  flashcardReviewState.mode = FLASHCARD_MODES.flashcard;
  flashcardReviewState.selectedCount = selectedEntries.length;
  flashcardReviewState.deck = buildFlashcardDeck(getFlashcardDisplayCards(selectedEntries));
  flashcardReviewState.correct = [];
  flashcardReviewState.missed = [];
  flashcardReviewState.feedbackMessage = '';
  flashcardReviewState.feedbackType = '';
  flashcardReviewState.phase = 'running';
  if (flashcardSummary) {
    flashcardSummary.hidden = true;
  }
  moveToNextFlashcard();
}

function handleFlashcardAnswerSubmission(rawAnswer) {
  if (flashcardReviewState.phase !== 'running' || flashcardReviewState.inputLocked) {
    return;
  }
  const card = flashcardReviewState.currentCard;
  if (!card) {
    return;
  }
  const copy = i18n[state.language];
  const isCorrect = isFlashcardAnswerCorrect(card, rawAnswer);
  flashcardReviewState.inputLocked = true;
  if (flashcardAnswer) {
    flashcardAnswer.disabled = true;
  }
  if (flashcardCheck) {
    flashcardCheck.disabled = true;
  }

  if (isCorrect) {
    flashcardReviewState.correct.push(card);
    flashcardReviewState.feedbackMessage = copy.flashcardCorrect;
    flashcardReviewState.feedbackType = 'correct';
    if (flashcardCard) {
      flashcardCard.classList.remove('flashcard-card-incorrect');
      flashcardCard.classList.add('flashcard-card-correct');
    }
  } else {
    card.attempts += 1;
    if (card.attempts >= 2) {
      flashcardReviewState.missed.push(card);
      flashcardReviewState.feedbackMessage = copy.flashcardIncorrect;
      flashcardReviewState.feedbackType = 'incorrect';
      if (flashcardCard) {
        flashcardCard.classList.remove('flashcard-card-correct');
        flashcardCard.classList.add('flashcard-card-incorrect');
      }
    } else {
      requeueFlashcardForRetry(card);
      flashcardReviewState.feedbackMessage = copy.flashcardIncorrectRetry;
      flashcardReviewState.feedbackType = 'incorrect';
      if (flashcardCard) {
        flashcardCard.classList.remove('flashcard-card-correct');
        flashcardCard.classList.add('flashcard-card-incorrect');
      }
    }
  }

  flashcardReviewState.currentCard = null;
  clearFlashcardAdvanceTimer();
  flashcardAdvanceTimer = setTimeout(() => {
    flashcardAdvanceTimer = null;
    if (flashcardReviewState.phase !== 'running') {
      return;
    }
    if (flashcardCard) {
      flashcardCard.classList.remove('flashcard-card-correct', 'flashcard-card-incorrect');
    }
    moveToNextFlashcard();
  }, 700);
  renderSyntheticGeneratorPanel();
}

function renderFlashcardReview() {
  if (!flashcardReview) {
    return;
  }
  const copy = i18n[state.language];
  const selectedCount = getSelectedSyntheticEntries().length;
  const isFlashcardMode = flashcardReviewState.mode === FLASHCARD_MODES.flashcard;
  const isRunning = flashcardReviewState.phase === 'running';
  const isCompleted = flashcardReviewState.phase === 'complete';
  const total = isCompleted ? flashcardReviewState.selectedCount : flashcardReviewState.selectedCount || selectedCount;
  const remaining = flashcardReviewState.deck.length + (isRunning && flashcardReviewState.currentCard ? 1 : 0);
  const progressCount = Math.max(0, total - remaining);

  flashcardReview.hidden = !isFlashcardMode;

  if (!isFlashcardMode) {
    if (flashcardSummary) {
      flashcardSummary.hidden = true;
    }
    if (flashcardCard) {
      flashcardCard.hidden = true;
    }
    return;
  }

  if (flashcardReviewTitle) {
    flashcardReviewTitle.textContent = copy.flashcardReviewTitle;
  }
  if (flashcardReviewSubtitle) {
    flashcardReviewSubtitle.textContent = copy.flashcardReviewSubtitle;
  }
  if (flashcardExit) {
    flashcardExit.hidden = !isFlashcardMode;
    flashcardExit.setAttribute('aria-label', copy.flashcardExitLabel || 'Exit');
    flashcardExit.title = copy.flashcardExitLabel || 'Exit';
  }
  if (flashcardStart) {
    setElementText(flashcardStart, copy.flashcardStart);
    flashcardStart.hidden = isRunning;
    flashcardStart.disabled = isRunning || !selectedCount;
  }
  if (flashcardDeckChip) {
    flashcardDeckChip.textContent = copy.flashcardDeckLabel || 'Deck';
  }
  if (flashcardProgress) {
    flashcardProgress.textContent = `${copy.flashcardProgressLabel}: ${progressCount}/${total || 0}`;
  }
  if (flashcardPromptLabel) {
    flashcardPromptLabel.textContent = copy.flashcardMeaningLabel;
  }
  if (flashcardPrompt) {
    flashcardPrompt.textContent = flashcardReviewState.currentCard?.meaning || '';
  }
  if (flashcardAnswerLabel) {
    flashcardAnswerLabel.textContent = copy.flashcardAnswerLabel;
  }
  if (flashcardAnswer) {
    flashcardAnswer.disabled = !isRunning || !flashcardReviewState.currentCard;
    flashcardAnswer.setAttribute('aria-label', copy.flashcardAnswerLabel);
  }
  if (flashcardCheck) {
    flashcardCheck.disabled = !isRunning || !flashcardReviewState.currentCard;
  }
  if (flashcardCard) {
    flashcardCard.hidden = !isRunning || !flashcardReviewState.currentCard;
  }
  if (flashcardAnswerForm) {
    flashcardAnswerForm.hidden = isRunning ? false : true;
  }

  if (flashcardFeedback) {
    flashcardFeedback.textContent = flashcardReviewState.feedbackMessage || '';
    flashcardFeedback.classList.remove('flashcard-feedback-correct', 'flashcard-feedback-incorrect');
    if (flashcardReviewState.feedbackType === 'correct') {
      flashcardFeedback.classList.add('flashcard-feedback-correct');
    } else if (flashcardReviewState.feedbackType === 'incorrect') {
      flashcardFeedback.classList.add('flashcard-feedback-incorrect');
    }
  }

  if (flashcardSummary) {
    flashcardSummary.hidden = !isCompleted;
    if (!isCompleted) {
      flashcardSummary.replaceChildren();
      return;
    }
    flashcardSummary.replaceChildren();
    const score = document.createElement('div');
    score.className = 'flashcard-summary-score';
    score.textContent = `${copy.flashcardScoreLabel}: ${flashcardReviewState.correct.length}/${total || 0}`;
    const title = document.createElement('div');
    title.className = 'flashcard-summary-title';
    title.textContent = copy.flashcardCompletedTitle;

    flashcardSummary.appendChild(title);
    flashcardSummary.appendChild(score);
    flashcardSummary.appendChild(
      renderFlashcardSummaryList(copy.flashcardCorrectLabel, flashcardReviewState.correct, copy)
    );
    flashcardSummary.appendChild(
      renderFlashcardSummaryList(copy.flashcardMissedLabel, flashcardReviewState.missed, copy)
    );
    flashcardStart.hidden = false;
    flashcardStart.disabled = false;
  }
}

const tooltip = document.querySelector('#tooltip');
const tooltipWord = document.querySelector('#tooltip-word');
const tooltipReading = document.querySelector('#tooltip-reading');
const tooltipMeaning = document.querySelector('#tooltip-meaning');
const tooltipAdd = document.querySelector('#tooltip-add');
const selectionTooltip = document.querySelector('#selection-tooltip');
const selectionTitle = document.querySelector('#selection-title');
const selectionTranslate = document.querySelector('#selection-translate');
const selectionAddToVocab = document.querySelector('#selection-add-vocab');
const selectionCopy = document.querySelector('#selection-copy');
const selectionAsk = document.querySelector('#selection-ask');
const selectionAskForm = document.querySelector('#selection-ask-form');
const selectionAskLabel = document.querySelector('#selection-ask-label');
const selectionAskInput = document.querySelector('#selection-ask-input');
const selectionAskSubmit = document.querySelector('#selection-ask-submit');
const selectionResult = document.querySelector('#selection-result');

function getLabeledTextTarget(element) {
  if (!(element instanceof Element)) {
    return null;
  }
  return element.querySelector('[data-label]');
}

function setElementText(element, text) {
  if (!element) {
    return;
  }
  const labelTarget = getLabeledTextTarget(element);
  if (labelTarget) {
    labelTarget.textContent = text;
    return;
  }
  element.textContent = text;
}

function getElementText(element) {
  if (!element) {
    return '';
  }
  const labelTarget = getLabeledTextTarget(element);
  return labelTarget?.textContent || element.textContent || '';
}
let activeHoverBase = null;
let lastSelectionPoint = null;

const defaultText = `今日はカフェで日本語の日記を書きました。\n天気は少し寒かったですが、コーヒーがとてもおいしかったです。\nI want to practice writing more natural sentences.`;

function hasKanji(text) {
  return kanjiRegex.test(text);
}

function isKanji(char) {
  return kanjiRegex.test(char);
}

function hasJapaneseChars(text) {
  return japaneseCharRegex.test(text);
}

function hasKana(text) {
  return kanaRegex.test(text);
}

function normalizeLookupWord(token) {
  if (!token) {
    return '';
  }
  const trimmed = token.replace(japaneseEdgeRegex, '');
  if (trimmed) {
    return trimmed;
  }
  const runs = token.match(japaneseRunRegex);
  if (!runs || !runs.length) {
    return token;
  }
  const runWithKanji = runs.find((run) => hasKanji(run));
  return runWithKanji || runs[0];
}

function getPreferredLookupWord(surfaceText, basicForm = '') {
  const normalizedBasicForm = normalizeLookupWord(basicForm);
  if (normalizedBasicForm && hasJapaneseChars(normalizedBasicForm)) {
    return normalizedBasicForm;
  }
  return normalizeLookupWord(surfaceText);
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
      const immediateKana = hasKana(parts[i + 1]) ? parts[i + 1] : '';
      const hoverKey = part + okuriganaPrefix(immediateKana);
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
        reading: readingPart,
        hoverKey
      });
      continue;
    }

    segments.push({ type: 'plain', text: part });
  }

  return segments;
}

function decodeHtml(text) {
  if (!text) {
    return '';
  }
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  const codeSegments = [];
  let output = escaped.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = codeSegments.length;
    codeSegments.push(code);
    return `{{CODE_${idx}}}`;
  });

  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  output = output.replace(/\{\{CODE_(\d+)\}\}/g, (_match, idx) => {
    const code = codeSegments[Number(idx)] ?? '';
    return `<code>${code}</code>`;
  });

  return output;
}

function renderMarkdown(container, text) {
  container.replaceChildren();
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    const p = document.createElement('p');
    p.innerHTML = renderInlineMarkdown(paragraph.join(' ').trim());
    container.appendChild(p);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (line.trim().startsWith('```')) {
      flushParagraph();
      const codeLines = [];
      for (i += 1; i < lines.length; i += 1) {
        if (lines[i].trim().startsWith('```')) {
          break;
        }
        codeLines.push(lines[i]);
      }
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
      const heading = document.createElement(tag);
      heading.innerHTML = renderInlineMarkdown(headingMatch[2].trim());
      container.appendChild(heading);
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const list = document.createElement(orderedMatch ? 'ol' : 'ul');
      for (; i < lines.length; i += 1) {
        const current = lines[i];
        const currentUnordered = current.match(/^\s*[-*•]\s+(.+)$/);
        const currentOrdered = current.match(/^\s*\d+\.\s+(.+)$/);
        if (orderedMatch && !currentOrdered) {
          break;
        }
        if (unorderedMatch && !currentUnordered) {
          break;
        }
        const itemText = (orderedMatch ? currentOrdered[1] : currentUnordered[1]).trim();
        const li = document.createElement('li');
        li.innerHTML = renderInlineMarkdown(itemText);
        list.appendChild(li);
      }
      i -= 1;
      container.appendChild(list);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
}

function initKuromoji() {
  if (kuromojiInitPromise) {
    return kuromojiInitPromise;
  }
  const api = typeof window !== 'undefined' ? window.kuromoji : null;
  if (!api) {
    kuromojiInitPromise = Promise.resolve(null);
    return kuromojiInitPromise;
  }
  const basePath = new URL('./', window.location.href).pathname;
  const dicPath = `${basePath}assets/kuromoji-dict/`;
  kuromojiInitPromise = new Promise((resolve) => {
    api.builder({ dicPath }).build((error, tokenizer) => {
      if (error) {
        console.warn('Kuromoji init failed', error, dicPath);
        resolve(null);
        return;
      }
      kuromojiTokenizer = tokenizer;
      resolve(tokenizer);
    });
  });
  return kuromojiInitPromise;
}

async function resolveReadingForToken(token) {
  const lookupKey = normalizeLookupWord(token);
  if (!lookupKey || !hasKanji(lookupKey)) {
    return '';
  }
  if (lookupCache.has(lookupKey)) {
    return lookupCache.get(lookupKey)?.reading || '';
  }
  const result = await lookupWord(lookupKey);
  lookupCache.set(lookupKey, result);
  return result?.reading || '';
}

async function buildRomajiForText(text) {
  const lines = text.split('\n');
  const outputLines = [];

  for (const line of lines) {
    const segments = getLineTokens(line);
    let output = '';
    let lastWasJapaneseWord = false;

    for (const segment of segments) {
      const raw = segment?.text ?? '';
      if (!raw) {
        continue;
      }
      if (/^\s+$/.test(raw)) {
        output += raw;
        lastWasJapaneseWord = false;
        continue;
      }

      const isPunctuation = japanesePunctuationRegex.test(raw);
      const isJapanese = hasJapaneseChars(raw);
      let converted = raw;

      if (segment.reading) {
        converted = kanaToRomaji(segment.reading);
      } else if (hasKanji(raw)) {
        const reading = await resolveReadingForToken(raw);
        converted = reading ? kanaToRomaji(reading) : raw;
      } else if (hasKana(raw)) {
        converted = kanaToRomaji(raw);
      }

      if (lastWasJapaneseWord && isJapanese && !isPunctuation) {
        output += ' ';
      }

      output += converted;
      lastWasJapaneseWord = isJapanese && !isPunctuation;
    }

    outputLines.push(output.trim());
  }

  return outputLines.join('\n');
}

function toHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0x60);
  });
}

function okuriganaPrefix(text) {
  if (!text) {
    return '';
  }
  const chars = Array.from(text);
  if (chars.length >= 2 && smallTsuRegex.test(chars[0])) {
    return chars[0] + chars[1];
  }
  if (chars.length >= 2 && smallKanaRegex.test(chars[1])) {
    return chars[0] + chars[1];
  }
  return chars[0];
}

const kanaDigraphMap = {
  きゃ: 'kya',
  きゅ: 'kyu',
  きょ: 'kyo',
  ぎゃ: 'gya',
  ぎゅ: 'gyu',
  ぎょ: 'gyo',
  しゃ: 'sha',
  しゅ: 'shu',
  しょ: 'sho',
  じゃ: 'ja',
  じゅ: 'ju',
  じょ: 'jo',
  ちゃ: 'cha',
  ちゅ: 'chu',
  ちょ: 'cho',
  にゃ: 'nya',
  にゅ: 'nyu',
  にょ: 'nyo',
  ひゃ: 'hya',
  ひゅ: 'hyu',
  ひょ: 'hyo',
  びゃ: 'bya',
  びゅ: 'byu',
  びょ: 'byo',
  ぴゃ: 'pya',
  ぴゅ: 'pyu',
  ぴょ: 'pyo',
  みゃ: 'mya',
  みゅ: 'myu',
  みょ: 'myo',
  りゃ: 'rya',
  りゅ: 'ryu',
  りょ: 'ryo',
  ふぁ: 'fa',
  ふぃ: 'fi',
  ふぇ: 'fe',
  ふぉ: 'fo',
  てぃ: 'ti',
  でぃ: 'di',
  つぁ: 'tsa',
  つぃ: 'tsi',
  つぇ: 'tse',
  つぉ: 'tso',
  うぁ: 'wa',
  うぃ: 'wi',
  うぇ: 'we',
  うぉ: 'wo',
  しぇ: 'she',
  ちぇ: 'che',
  じぇ: 'je'
};

const kanaMap = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo',
  ゔ: 'vu',
  ー: '-',
  '、': ',',
  '。': '.'
};

function kanaToRomaji(text) {
  if (!text) {
    return '';
  }
  const hira = toHiragana(text);
  let result = '';
  for (let i = 0; i < hira.length; i += 1) {
    const char = hira[i];
    const pair = hira.slice(i, i + 2);

    if (char === 'っ') {
      const nextPair = hira.slice(i + 1, i + 3);
      const nextChar = hira[i + 1];
      const nextRomaji = kanaDigraphMap[nextPair] || kanaMap[nextChar] || '';
      if (nextRomaji) {
        result += nextRomaji[0];
      }
      continue;
    }

    if (char === 'ー') {
      const lastVowel = result.match(/[aeiou]$/)?.[0];
      if (lastVowel) {
        result += lastVowel;
      }
      continue;
    }

    if (kanaDigraphMap[pair]) {
      result += kanaDigraphMap[pair];
      i += 1;
      continue;
    }

    if (char === 'ん') {
      const nextChar = hira[i + 1];
      const nextPair = hira.slice(i + 1, i + 3);
      const nextRomaji = kanaDigraphMap[nextPair] || kanaMap[nextChar] || '';
      if (nextRomaji && /^[aeiouy]/.test(nextRomaji)) {
        result += "n'";
      } else {
        result += 'n';
      }
      continue;
    }

    result += kanaMap[char] || char;
  }
  return result;
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

function tokenizeLineWithKuromoji(line) {
  if (!kuromojiTokenizer) {
    return null;
  }
  const tokens = [];
  const segments = splitTokenizableRuns(line);
  segments.forEach((segment) => {
    if (segment.type === 'plain') {
      tokens.push({
        text: segment.text,
        reading: '',
        lookup: normalizeLookupWord(segment.text)
      });
      return;
    }
    const kuromojiTokens = kuromojiTokenizer.tokenize(segment.text);
    kuromojiTokens.forEach((token) => {
      const surfaceText = token.surface_form || '';
      const reading = token.reading && token.reading !== '*' ? token.reading : '';
      const basicForm = token.basic_form && token.basic_form !== '*' ? token.basic_form : '';
      tokens.push({
        text: surfaceText,
        reading,
        lookup: getPreferredLookupWord(surfaceText, basicForm)
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
        merged.push({
          text: combinedText,
          reading: combinedReading,
          lookup: normalizeLookupWord(combinedText)
        });
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

function getLineTokens(line) {
  const kuromojiTokens = tokenizeLineWithKuromoji(line);
  if (kuromojiTokens) {
    return applyReadingOverrides(kuromojiTokens);
  }
  const segments = segmentLine(line).map((segment) => ({
    text: segment,
    reading: '',
    lookup: normalizeLookupWord(segment)
  }));
  return applyReadingOverrides(segments);
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Ignore storage errors.
  }
}

function generateDocumentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateAssetId(prefix = 'asset') {
  const safePrefix = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : 'asset';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${safePrefix}_${crypto.randomUUID()}`;
  }
  return `${safePrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatCopy(template, replacements = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_match, key) => {
    const value = replacements[key];
    return value == null ? '' : String(value);
  });
}

function isSupportedImageSource(value) {
  return /^data:image\//i.test(String(value || '').trim());
}

function normalizeDocumentImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }
  const now = Date.now();
  const seenIds = new Set();
  return images
    .slice(0, MAX_IMAGES_PER_DOCUMENT)
    .map((image) => {
      if (!image || typeof image !== 'object') {
        return null;
      }
      let id = typeof image.id === 'string' && image.id.trim()
        ? image.id.trim().slice(0, 160)
        : generateAssetId('img');
      if (seenIds.has(id)) {
        id = generateAssetId('img');
      }
      seenIds.add(id);
      const src = typeof image.src === 'string'
        ? image.src.trim()
        : (typeof image.dataUrl === 'string' ? image.dataUrl.trim() : '');
      if (!isSupportedImageSource(src) || src.length > MAX_DOCUMENT_IMAGE_SOURCE_LENGTH) {
        return null;
      }
      const name = typeof image.name === 'string' ? image.name.trim().slice(0, 180) : '';
      const width = Number.isFinite(image.width) ? Math.max(1, Math.trunc(image.width)) : null;
      const height = Number.isFinite(image.height) ? Math.max(1, Math.trunc(image.height)) : null;
      const addedAt = Number.isFinite(image.addedAt) ? Math.trunc(image.addedAt) : now;
      return {
        id,
        name,
        src,
        width,
        height,
        addedAt
      };
    })
    .filter(Boolean);
}

function hasDocumentContent(text = state.text, images = state.images) {
  return Boolean(
    (typeof text === 'string' && text.trim())
      || (Array.isArray(images) && images.length)
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromSource(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image.'));
    image.src = src;
  });
}

function getScaledDimensions(width, height, maxEdge) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const safeMaxEdge = Math.max(1, Number(maxEdge) || 1);
  const longestSide = Math.max(safeWidth, safeHeight);
  if (longestSide <= safeMaxEdge) {
    return { width: safeWidth, height: safeHeight };
  }
  const scale = safeMaxEdge / longestSide;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
}

function canvasToCompressedDataUrl(canvas, quality) {
  let output = canvas.toDataURL('image/webp', quality);
  if (!output.startsWith('data:image/webp')) {
    output = canvas.toDataURL('image/jpeg', quality);
  }
  return output;
}

async function processDocumentImageFile(file) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  if (!isSupportedImageSource(sourceDataUrl)) {
    throw new Error('Unsupported image file.');
  }
  const image = await loadImageFromSource(sourceDataUrl);
  const naturalWidth = image.naturalWidth || image.width || 1;
  const naturalHeight = image.naturalHeight || image.height || 1;
  let processedSource = '';
  let processedWidth = naturalWidth;
  let processedHeight = naturalHeight;

  for (const step of IMAGE_PROCESSING_STEPS) {
    const dimensions = getScaledDimensions(naturalWidth, naturalHeight, step.maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) {
      continue;
    }
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    const candidateSource = canvasToCompressedDataUrl(canvas, step.quality);
    if (!isSupportedImageSource(candidateSource)) {
      continue;
    }
    processedSource = candidateSource;
    processedWidth = dimensions.width;
    processedHeight = dimensions.height;
    if (candidateSource.length <= MAX_DOCUMENT_IMAGE_SOURCE_LENGTH) {
      break;
    }
  }

  if (!processedSource || processedSource.length > MAX_DOCUMENT_IMAGE_SOURCE_LENGTH) {
    throw new Error('Image is too large to store.');
  }

  const normalized = normalizeDocumentImages([{
    id: generateAssetId('img'),
    name: file?.name || '',
    src: processedSource,
    width: processedWidth,
    height: processedHeight,
    addedAt: Date.now()
  }]);

  if (!normalized[0]) {
    throw new Error('Processed image is invalid.');
  }

  return normalized[0];
}

function normalizeVocabEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const word = typeof entry.word === 'string' ? entry.word : '';
      const reading = typeof entry.reading === 'string' ? entry.reading : '';
      const meaning = typeof entry.meaning === 'string' ? entry.meaning : '';
      const addedAt = Number.isFinite(entry.addedAt) ? Math.trunc(entry.addedAt) : now;
      if (!word && !reading && !meaning) {
        return null;
      }
      return {
        word,
        reading,
        meaning,
        addedAt
      };
    })
    .filter(Boolean);
}

function normalizeQuestionEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const selectedText = typeof entry.selectedText === 'string' ? entry.selectedText : '';
      const question = typeof entry.question === 'string' ? entry.question : '';
      const answer = typeof entry.answer === 'string' ? entry.answer : '';
      const createdAt = Number.isFinite(entry.createdAt) ? Math.trunc(entry.createdAt) : now;
      if (!selectedText && !question && !answer) {
        return null;
      }
      return {
        selectedText,
        question,
        answer,
        createdAt
      };
    })
    .filter(Boolean);
}

function normalizeEmailValue(email) {
  return typeof email === 'string'
    ? email.trim().toLowerCase()
    : '';
}

function normalizeWorkflowRole(role, fallback = '') {
  if (typeof role !== 'string') {
    return fallback;
  }
  const normalized = role.trim();
  if (WORKFLOW_ROLES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeWorkflowStatus(status, fallback = 'draft') {
  if (typeof status !== 'string') {
    return fallback;
  }
  const normalized = status.trim();
  if (WORKFLOW_STATUSES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeWorkflowEventAction(action, fallback = '') {
  if (typeof action !== 'string') {
    return fallback;
  }
  const normalized = action.trim();
  if (WORKFLOW_EVENT_ACTIONS.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeWorkflowEvents(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  return entries
    .slice(-80)
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const action = normalizeWorkflowEventAction(entry.action);
      if (!action) {
        return null;
      }
      const createdAt = Number.isFinite(entry.createdAt)
        ? Math.trunc(entry.createdAt)
        : now;
      return {
        id: typeof entry.id === 'string' && entry.id.trim()
          ? entry.id.trim().slice(0, 80)
          : `event_${createdAt}_${index}`,
        action,
        status: normalizeWorkflowStatus(entry.status, 'draft'),
        actorUserId: typeof entry.actorUserId === 'string'
          ? entry.actorUserId.trim().slice(0, 200)
          : '',
        actorEmail: normalizeEmailValue(entry.actorEmail).slice(0, 320),
        actorName: typeof entry.actorName === 'string'
          ? entry.actorName.trim().slice(0, 160)
          : '',
        actorRole: normalizeWorkflowRole(entry.actorRole, ''),
        createdAt
      };
    })
    .filter(Boolean);
}

function normalizeDocumentWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object') {
    return null;
  }
  const id = typeof workflow.id === 'string'
    ? workflow.id.trim().slice(0, 120)
    : '';
  if (!id) {
    return null;
  }
  const lastTransitionAt = Number.isFinite(workflow.lastTransitionAt)
    ? Math.trunc(workflow.lastTransitionAt)
    : null;
  const version = Number.isFinite(workflow.version)
    ? Math.max(1, Math.trunc(workflow.version))
    : 1;
  return {
    id,
    role: normalizeWorkflowRole(workflow.role, ''),
    status: normalizeWorkflowStatus(workflow.status, 'draft'),
    ownerUserId: typeof workflow.ownerUserId === 'string'
      ? workflow.ownerUserId.trim().slice(0, 200)
      : '',
    ownerEmail: normalizeEmailValue(workflow.ownerEmail).slice(0, 320),
    ownerName: typeof workflow.ownerName === 'string'
      ? workflow.ownerName.trim().slice(0, 160)
      : '',
    partnerUserId: typeof workflow.partnerUserId === 'string'
      ? workflow.partnerUserId.trim().slice(0, 200)
      : '',
    partnerEmail: normalizeEmailValue(workflow.partnerEmail).slice(0, 320),
    partnerName: typeof workflow.partnerName === 'string'
      ? workflow.partnerName.trim().slice(0, 160)
      : '',
    lastTransitionAt,
    lastActorUserId: typeof workflow.lastActorUserId === 'string'
      ? workflow.lastActorUserId.trim().slice(0, 200)
      : '',
    lastActorEmail: normalizeEmailValue(workflow.lastActorEmail).slice(0, 320),
    lastActorName: typeof workflow.lastActorName === 'string'
      ? workflow.lastActorName.trim().slice(0, 160)
      : '',
    lastActorRole: normalizeWorkflowRole(workflow.lastActorRole, ''),
    version,
    events: normalizeWorkflowEvents(workflow.events)
  };
}

function normalizeCorrectionsBaseText(value, fallback = '') {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof fallback === 'string') {
    return fallback;
  }
  return '';
}

function normalizeDocumentEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  const seenIds = new Set();
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : generateDocumentId();
      if (seenIds.has(id)) {
        id = generateDocumentId();
      }
      seenIds.add(id);
      const title = typeof entry.title === 'string' ? entry.title : '';
      const text = typeof entry.text === 'string' ? entry.text : '';
      const images = normalizeDocumentImages(entry.images);
      const vocab = normalizeVocabEntries(entry.vocab);
      const questions = normalizeQuestionEntries(entry.questions);
      const correctionsBaseText = normalizeCorrectionsBaseText(entry.correctionsBaseText, text);
      const proofreadContent = typeof entry.proofreadContent === 'string' ? entry.proofreadContent : '';
      const proofreadUpdatedAt = Number.isFinite(entry.proofreadUpdatedAt)
        ? Math.trunc(entry.proofreadUpdatedAt)
        : null;
      const workflow = normalizeDocumentWorkflow(entry.workflow);
      const createdAt = Number.isFinite(entry.createdAt) ? Math.trunc(entry.createdAt) : now;
      const updatedAt = Number.isFinite(entry.updatedAt) ? Math.trunc(entry.updatedAt) : createdAt;
      const isSaved = entry.isSaved !== false;
      return {
        id,
        title,
        text,
        images,
        vocab,
        questions,
        correctionsBaseText,
        proofreadContent,
        proofreadUpdatedAt,
        workflow,
        isSaved,
        createdAt,
        updatedAt
      };
    })
    .filter(Boolean);
}

function loadVocabFromStorage() {
  const storedVocab = safeStorageGet(STORAGE_KEYS.vocab);
  if (!storedVocab) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedVocab);
    return normalizeVocabEntries(parsed);
  } catch (error) {
    return [];
  }
}

function loadQuestionsFromStorage() {
  const storedQuestions = safeStorageGet(STORAGE_KEYS.questions);
  if (!storedQuestions) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedQuestions);
    return normalizeQuestionEntries(parsed);
  } catch (error) {
    return [];
  }
}

function loadDocumentsFromStorage() {
  const storedDocuments = safeStorageGet(STORAGE_KEYS.documents);
  if (!storedDocuments) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedDocuments);
    return normalizeDocumentEntries(parsed);
  } catch (error) {
    return [];
  }
}

function normalizeDeletedDocumentIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);
}

function loadWorkspaceDeletedDocumentIds() {
  const storedDeleted = safeStorageGet(STORAGE_KEYS.deletedDocuments);
  if (!storedDeleted) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(storedDeleted);
    const normalized = normalizeDeletedDocumentIds(parsed);
    return new Set(normalized);
  } catch (error) {
    return new Set();
  }
}

function saveWorkspaceDeletedDocumentIds() {
  if (!workspaceDeletedDocumentIds.size) {
    safeStorageSet(STORAGE_KEYS.deletedDocuments, JSON.stringify([]));
    return;
  }
  safeStorageSet(
    STORAGE_KEYS.deletedDocuments,
    JSON.stringify(Array.from(workspaceDeletedDocumentIds))
  );
}

function markWorkspaceDocumentDeleted(documentId) {
  if (typeof documentId !== 'string') {
    return;
  }
  const normalized = documentId.trim();
  if (!normalized) {
    return;
  }
  workspaceDeletedDocumentIds.add(normalized);
  saveWorkspaceDeletedDocumentIds();
}

function getWorkspaceFilteredDocuments(documents) {
  const normalized = normalizeDocumentEntries(documents);
  if (!workspaceDeletedDocumentIds.size) {
    return normalized.sort((a, b) => {
      const left = Number.isFinite(a?.createdAt) ? a.createdAt : 0;
      const right = Number.isFinite(b?.createdAt) ? b.createdAt : 0;
      return right - left;
    });
  }
  return normalized
    .filter((doc) => !workspaceDeletedDocumentIds.has(doc.id))
    .sort((a, b) => {
      const left = Number.isFinite(a?.createdAt) ? a.createdAt : 0;
      const right = Number.isFinite(b?.createdAt) ? b.createdAt : 0;
      return right - left;
    });
}

function clearWorkspaceDocumentDeletionMarkers(syncWorkspace) {
  if (!workspaceDeletedDocumentIds.size) {
    return;
  }
  if (!syncWorkspace || !Array.isArray(syncWorkspace.documents)) {
    workspaceDeletedDocumentIds.clear();
    saveWorkspaceDeletedDocumentIds();
    return;
  }
  const syncedDocumentIds = new Set(
    normalizeDocumentEntries(syncWorkspace?.documents).map((doc) => doc.id)
  );
  const nextDeletedIds = Array.from(workspaceDeletedDocumentIds).filter(
    (id) => syncedDocumentIds.has(id)
  );
  if (nextDeletedIds.length === workspaceDeletedDocumentIds.size) {
    return;
  }
  workspaceDeletedDocumentIds = new Set(nextDeletedIds);
  saveWorkspaceDeletedDocumentIds();
}

function saveDocumentsToStorage({ syncServer = true } = {}) {
  safeStorageSet(STORAGE_KEYS.documents, JSON.stringify(state.documents));
  if (syncServer) {
    scheduleWorkspaceSync();
  }
}

function normalizeAuthUser(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }
  const id = typeof user.id === 'string' ? user.id : '';
  const email = typeof user.email === 'string' ? user.email : '';
  const name = typeof user.name === 'string' ? user.name : '';
  const picture = typeof user.picture === 'string' ? user.picture : '';
  if (!id) {
    return null;
  }
  return {
    id,
    email,
    name,
    picture
  };
}

function buildWorkspacePayload() {
  return {
    documents: normalizeDocumentEntries(state.documents),
    activeDocumentId: state.documentId || '',
    updatedAt: Date.now()
  };
}

function buildWorkspaceSnapshot(workspace) {
  if (!workspace || typeof workspace !== 'object') {
    return '';
  }
  const documents = normalizeDocumentEntries(workspace.documents);
  const activeDocumentId = typeof workspace.activeDocumentId === 'string'
    ? workspace.activeDocumentId
    : '';
  return JSON.stringify({ documents, activeDocumentId });
}

function mergeWorkspaceDocuments(localDocuments, remoteDocuments) {
  const merged = new Map();
  normalizeDocumentEntries(remoteDocuments).forEach((doc) => {
    merged.set(doc.id, doc);
  });
  normalizeDocumentEntries(localDocuments).forEach((doc) => {
    const existing = merged.get(doc.id);
    if (!existing) {
      merged.set(doc.id, doc);
      return;
    }
    const localIsSaved = doc.isSaved !== false;
    const remoteIsSaved = existing.isSaved !== false;
    if (!localIsSaved && remoteIsSaved) {
      merged.set(doc.id, doc);
      return;
    }

    const localUpdatedAt = Number.isFinite(doc.updatedAt) ? doc.updatedAt : 0;
    const remoteUpdatedAt = Number.isFinite(existing.updatedAt) ? existing.updatedAt : 0;
    if (localUpdatedAt >= remoteUpdatedAt) {
      merged.set(doc.id, doc);
    }
  });
  return Array.from(merged.values()).sort((a, b) => {
    const left = Number.isFinite(a?.createdAt) ? a.createdAt : 0;
    const right = Number.isFinite(b?.createdAt) ? b.createdAt : 0;
    return right - left;
  });
}

function isBootstrapDocument(doc) {
  if (!doc || typeof doc !== 'object') {
    return false;
  }
  const title = typeof doc.title === 'string' ? doc.title.trim() : '';
  const text = typeof doc.text === 'string' ? doc.text : '';
  const images = Array.isArray(doc.images) ? doc.images : [];
  const vocab = Array.isArray(doc.vocab) ? doc.vocab : [];
  const questions = Array.isArray(doc.questions) ? doc.questions : [];
  const proofreadContent = typeof doc.proofreadContent === 'string' ? doc.proofreadContent.trim() : '';
  const workflowId = typeof doc.workflow?.id === 'string' ? doc.workflow.id.trim() : '';
  return !title
    && text === defaultText
    && !images.length
    && !vocab.length
    && !questions.length
    && !proofreadContent
    && !workflowId;
}

function shouldIgnoreLocalBootstrapWorkspace(localDocuments, remoteDocuments) {
  const normalizedLocal = normalizeDocumentEntries(localDocuments);
  const normalizedRemote = normalizeDocumentEntries(remoteDocuments);
  return normalizedRemote.length > 0
    && normalizedLocal.length === 1
    && isBootstrapDocument(normalizedLocal[0]);
}

function resolveWorkspaceActiveDocumentId({ preferredActiveId, fallbackActiveId, documents }) {
  if (!Array.isArray(documents) || !documents.length) {
    return '';
  }
  const currentActiveId = state?.documentId;
  if (currentActiveId && documents.some((doc) => doc.id === currentActiveId)) {
    return currentActiveId;
  }
  if (preferredActiveId && documents.some((doc) => doc.id === preferredActiveId)) {
    return preferredActiveId;
  }
  if (fallbackActiveId && documents.some((doc) => doc.id === fallbackActiveId)) {
    return fallbackActiveId;
  }
  return documents[0].id;
}

function applyWorkspaceState(workspace) {
  const nextDocuments = getWorkspaceFilteredDocuments(workspace?.documents);
  workspaceHydrating = true;
  try {
    state.documents = nextDocuments.length
      ? nextDocuments
      : [createDocument({ text: defaultText })];
    saveDocumentsToStorage({ syncServer: false });

    const nextActiveId = resolveWorkspaceActiveDocumentId({
      preferredActiveId: typeof workspace?.activeDocumentId === 'string' ? workspace.activeDocumentId : '',
      fallbackActiveId: state.documentId,
      documents: state.documents
    });
    const nextActiveDocument = state.documents.find((doc) => doc.id === nextActiveId) || state.documents[0];
    setActiveDocument(nextActiveDocument, { resetProofread: false });
  } finally {
    workspaceHydrating = false;
  }
}

function getMergedWorkspaceStateFromRemote(remoteWorkspace) {
  const remoteDocuments = getWorkspaceFilteredDocuments(remoteWorkspace?.documents);
  const localWorkspace = buildWorkspacePayload();
  const localDocumentsForMerge = shouldIgnoreLocalBootstrapWorkspace(localWorkspace.documents, remoteDocuments)
    ? []
    : localWorkspace.documents;
  const mergedDocuments = mergeWorkspaceDocuments(localDocumentsForMerge, remoteDocuments);
  const mergedWorkspace = {
    documents: mergedDocuments,
    activeDocumentId: resolveWorkspaceActiveDocumentId({
      preferredActiveId: localWorkspace.activeDocumentId
        || (typeof remoteWorkspace?.activeDocumentId === 'string' ? remoteWorkspace.activeDocumentId : ''),
      fallbackActiveId: localWorkspace.activeDocumentId,
      documents: mergedDocuments
    })
  };
  return {
    localWorkspace,
    mergedWorkspace,
    remoteDocuments,
    localSnapshot: buildWorkspaceSnapshot(localWorkspace),
    mergedSnapshot: buildWorkspaceSnapshot(mergedWorkspace),
    remoteSnapshot: buildWorkspaceSnapshot({
      documents: remoteDocuments,
      activeDocumentId: typeof remoteWorkspace?.activeDocumentId === 'string'
        ? remoteWorkspace.activeDocumentId
        : ''
    })
  };
}

async function refreshWorkspaceFromServer() {
  if (!authState.authenticated || workspaceHydrating) {
    return null;
  }
  const remoteWorkspace = await requestWorkspace();
  const merged = getMergedWorkspaceStateFromRemote(remoteWorkspace || {});
  if (merged.mergedSnapshot && merged.mergedSnapshot !== merged.localSnapshot) {
    applyWorkspaceState(merged.mergedWorkspace);
  }
  if (Number.isFinite(remoteWorkspace?.updatedAt)) {
    authState.lastSyncedAt = new Date(Math.trunc(remoteWorkspace.updatedAt));
  }
  return merged;
}

function stopWorkspaceRefreshLoop() {
  if (workspaceRefreshTimer) {
    clearTimeout(workspaceRefreshTimer);
    workspaceRefreshTimer = null;
  }
  workspaceRefreshInFlight = false;
}

function runWorkspaceRefreshLoop() {
  if (!authState.authenticated) {
    return;
  }
  stopWorkspaceRefreshLoop();
  workspaceRefreshTimer = setTimeout(() => {
    workspaceRefreshTimer = null;
    void (async () => {
      if (workspaceHydrating || workspaceRefreshInFlight || !authState.authenticated) {
        return;
      }
      workspaceRefreshInFlight = true;
      try {
        await refreshWorkspaceFromServer();
      } catch (error) {
        // Polling failures should not interrupt editing or display state.
      } finally {
        workspaceRefreshInFlight = false;
        if (authState.authenticated) {
          runWorkspaceRefreshLoop();
        }
      }
    })();
  }, WORKSPACE_POLL_INTERVAL_MS);
}

function clearWorkspaceSyncQueue() {
  if (workspaceSyncTimer) {
    clearTimeout(workspaceSyncTimer);
    workspaceSyncTimer = null;
  }
  workspaceSyncPending = null;
  workspaceSyncInFlight = false;
}

function consumeAuthResultFromUrl() {
  if (typeof window === 'undefined' || !window.location) {
    return '';
  }
  let url;
  try {
    url = new URL(window.location.href);
  } catch (error) {
    return '';
  }
  const auth = url.searchParams.get('auth') || '';
  const reason = url.searchParams.get('reason') || '';
  if (!auth && !reason) {
    return '';
  }
  url.searchParams.delete('auth');
  url.searchParams.delete('reason');
  if (window.history && typeof window.history.replaceState === 'function') {
    const nextSearch = url.searchParams.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
  }
  if (auth === 'success') {
    return '';
  }
  if (auth === 'failed') {
    return reason || 'failed';
  }
  return auth || reason;
}

function getAuthGateStatus(copy) {
  if (authState.loading) {
    return copy.authGateLoading;
  }
  if (authState.notice === 'session_unavailable') {
    return copy.authGateSessionUnavailable;
  }
  if (authState.notice === 'not_allowed') {
    return copy.authGateDenied;
  }
  if (
    authState.notice === 'state_mismatch'
    || authState.notice === 'invalid_grant'
    || authState.notice === 'redirect_uri_mismatch'
    || authState.notice === 'token_exchange_failed'
    || authState.notice === 'profile_fetch_failed'
    || authState.notice === 'profile_missing'
    || authState.notice === 'failed'
  ) {
    return copy.authGateFailed;
  }
  if (authState.notice === 'db_unavailable' || authState.notice === 'db_error') {
    return copy.authSyncError;
  }
  if (authState.notice === 'disabled' || !authState.enabled) {
    return copy.authGateUnavailable;
  }
  if (authState.syncError && authState.required && !authState.authenticated) {
    return authState.syncError;
  }
  return '';
}

function renderAuthGate() {
  const copy = i18n[state.language];
  const isVisible = authState.required && !authState.authenticated;
  const isLoading = authState.loading;
  if (app) {
    app.classList.toggle('auth-loading', isLoading);
    app.classList.toggle('auth-gated', isVisible);
  }
  if (!authGate) {
    return;
  }
  authGate.hidden = !(isLoading || isVisible);
  if (!isLoading && !isVisible) {
    return;
  }
  if (authGateEyebrow) {
    authGateEyebrow.textContent = copy.authGateEyebrow;
  }
  if (authGateTitle) {
    authGateTitle.textContent = copy.authGateTitle;
  }
  if (authGateMessage) {
    authGateMessage.textContent = copy.authGateMessage;
  }
  if (authGateGoogle) {
    setElementText(authGateGoogle, copy.authSignIn);
    authGateGoogle.disabled = authState.loading || !authState.enabled;
  }
  if (authGateStatus) {
    authGateStatus.textContent = getAuthGateStatus(copy);
  }
}

function syncAppAccessLock() {
  const isLocked = authState.required && !authState.authenticated;
  const isTeacherWorkflow = isTeacherWorkflowWorkflow(state.workflow);
  if (composePage) {
    composePage.toggleAttribute('inert', isLocked);
    composePage.setAttribute('aria-hidden', String(isLocked));
  }
  if (vocabularyPage) {
    vocabularyPage.toggleAttribute('inert', isLocked);
    vocabularyPage.setAttribute('aria-hidden', String(isLocked));
  }
  if (composerInput) {
    composerInput.readOnly = isLocked || state.mode === 'read' || (isTeacherWorkflow && state.mode === 'edit');
  }
}

function renderAuthControls() {
  const copy = i18n[state.language];
  const gateVisible = authState.required && !authState.authenticated;
  if (authGoogle) {
    setElementText(authGoogle, copy.authSignIn);
    authGoogle.disabled = authState.loading || !authState.enabled || authState.authenticated;
    authGoogle.hidden = gateVisible || Boolean(authState.authenticated) || !authState.enabled;
  }
  if (authLogout) {
    setElementText(authLogout, copy.authSignOut);
    authLogout.hidden = !authState.authenticated;
    authLogout.disabled = authState.loading;
  }
  if (authUser) {
    const isVisible = authState.authenticated && Boolean(authState.user);
    authUser.hidden = !isVisible;
    if (isVisible && authName) {
      const user = authState.user || {};
      authName.textContent = user.name || user.email || copy.authUserFallback;
      authName.title = user.email || user.name || '';
    }
    if (authAvatar) {
      const picture = authState.user?.picture || '';
      if (picture) {
        authAvatar.src = picture;
        authAvatar.alt = authState.user?.name || authState.user?.email || copy.authUserFallback;
        authAvatar.hidden = false;
      } else {
        authAvatar.removeAttribute('src');
        authAvatar.alt = '';
        authAvatar.hidden = true;
      }
    }
  }
  if (authSyncStatus) {
    let statusText = '';
    if (authState.loading) {
      statusText = '';
    } else if (!authState.enabled) {
      statusText = copy.authDisabled;
    } else if (!authState.authenticated) {
      statusText = authState.required ? '' : copy.authSyncLocal;
    } else if (authState.syncing) {
      statusText = copy.authSyncing;
    } else if (authState.syncError) {
      statusText = authState.syncError;
    } else if (authState.lastSyncedAt instanceof Date) {
      const formatted = formatShareTimestamp(authState.lastSyncedAt);
      statusText = formatted ? `${copy.authSynced}: ${formatted}` : copy.authSyncReady;
    } else {
      statusText = copy.authSyncReady;
    }
    authSyncStatus.textContent = statusText;
  }
  renderAuthGate();
  syncAppAccessLock();
}

function scheduleWorkspaceSync({ immediate = false } = {}) {
  if (!authState.authenticated || workspaceHydrating) {
    return;
  }
  workspaceSyncPending = buildWorkspacePayload();
  if (immediate) {
    if (workspaceSyncTimer) {
      clearTimeout(workspaceSyncTimer);
      workspaceSyncTimer = null;
    }
    void flushWorkspaceSync();
    return;
  }
  if (workspaceSyncTimer) {
    return;
  }
  workspaceSyncTimer = setTimeout(() => {
    workspaceSyncTimer = null;
    void flushWorkspaceSync();
  }, 1200);
}

async function flushWorkspaceSync() {
  if (workspaceSyncInFlight || !workspaceSyncPending || !authState.authenticated) {
    return;
  }
  const payload = workspaceSyncPending;
  workspaceSyncPending = null;
  workspaceSyncInFlight = true;
  authState.syncing = true;
  authState.syncError = '';
  renderAuthControls();
  try {
    const result = await requestWorkspaceUpdate(payload);
    clearWorkspaceDocumentDeletionMarkers(result?.workspace || null);
    const updatedAt = Number.isFinite(result?.updatedAt) ? Math.trunc(result.updatedAt) : Date.now();
    authState.lastSyncedAt = new Date(updatedAt);
    authState.syncError = '';
  } catch (error) {
    authState.syncError = error?.message || i18n[state.language].authSyncError;
  } finally {
    authState.syncing = false;
    workspaceSyncInFlight = false;
    renderAuthControls();
    if (workspaceSyncPending) {
      scheduleWorkspaceSync({ immediate: true });
    }
  }
}

async function requestAuthSession() {
  const response = await fetch(AUTH_SESSION_ENDPOINT, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store'
  });
  if (!response.ok) {
    throw new Error('Auth session failed');
  }
  const data = await safeParseJson(response);
  return data && typeof data === 'object' ? data : {};
}

async function requestWorkspace() {
  const response = await fetch(WORKSPACE_ENDPOINT, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store'
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    throw new Error(data?.error || i18n[state.language].authSyncError);
  }
  if (!data || typeof data.workspace !== 'object' || !data.workspace) {
    return null;
  }
  return data.workspace;
}

async function requestWorkspaceUpdate(workspace) {
  const response = await fetch(WORKSPACE_ENDPOINT, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace })
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    throw new Error(data?.error || i18n[state.language].authSyncError);
  }
  return data;
}

async function requestAuthLogout() {
  const response = await fetch(AUTH_LOGOUT_ENDPOINT, {
    method: 'POST',
    credentials: 'include'
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    throw new Error(data?.error || 'Logout failed');
  }
  return data;
}

async function hydrateAuthAndWorkspace() {
  authState.loading = true;
  authState.syncError = '';
  authState.lastSyncedAt = null;
  renderAuthControls();

  let session = null;
  try {
    session = await requestAuthSession();
  } catch (error) {
    authState.required = true;
    authState.enabled = false;
    authState.user = null;
    authState.authenticated = false;
    authState.notice = authState.notice || 'session_unavailable';
    authState.loading = false;
    renderAuthControls();
    clearWorkspaceSyncQueue();
    stopWorkspaceRefreshLoop();
    return false;
  }

  authState.required = Boolean(session?.required);
  authState.enabled = Boolean(session?.enabled);
  authState.user = normalizeAuthUser(session?.user);
  authState.authenticated = Boolean(session?.authenticated && authState.user);
  if (authState.authenticated) {
    authState.notice = '';
  }
  authState.loading = false;
  renderAuthControls();

  if (!authState.authenticated) {
    clearWorkspaceSyncQueue();
    stopWorkspaceRefreshLoop();
    if (authState.required) {
      return false;
    }
    ensureLocalStateLoaded();
    return true;
  }

  ensureLocalStateLoaded();

  try {
    const remoteWorkspace = await requestWorkspace();
    const merged = getMergedWorkspaceStateFromRemote(remoteWorkspace || {});
    if (merged.mergedSnapshot && merged.mergedSnapshot !== merged.localSnapshot) {
      applyWorkspaceState(merged.mergedWorkspace);
    }

    const remoteUpdatedAt = Number.isFinite(remoteWorkspace?.updatedAt)
      ? Math.trunc(remoteWorkspace.updatedAt)
      : Date.now();
    authState.lastSyncedAt = new Date(remoteUpdatedAt);
    authState.syncError = '';
    renderAuthControls();
    runWorkspaceRefreshLoop();

    if (!merged.remoteDocuments.length || (merged.mergedSnapshot && merged.mergedSnapshot !== merged.remoteSnapshot)) {
      scheduleWorkspaceSync({ immediate: true });
    }
  } catch (error) {
    authState.syncError = error?.message || i18n[state.language].authSyncError;
    renderAuthControls();
  }
  return true;
}

async function fetchVocabFromApi() {
  if (!vocabApiAvailable) {
    return null;
  }
  try {
    const response = await fetch(VOCAB_API_ENDPOINT, { method: 'GET' });
    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        vocabApiAvailable = false;
      }
      return null;
    }
    const data = await response.json();
    if (!Array.isArray(data?.items)) {
      return null;
    }
    return normalizeVocabEntries(data.items);
  } catch (error) {
    vocabApiAvailable = false;
    return null;
  }
}

async function hydrateVocabFromApi() {
  if (authState.authenticated || authState.required) {
    return;
  }
  if (state.documents.length > 1 || state.vocab.length) {
    return;
  }
  const items = await fetchVocabFromApi();
  if (items === null) {
    return;
  }
  state.vocab = items;
  persistActiveDocument();
  renderVocab();
}

async function persistVocabToApi(items) {
  if (authState.authenticated || authState.required) {
    return;
  }
  if (!vocabApiAvailable) {
    return;
  }
  try {
    const response = await fetch(VOCAB_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items })
    });
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      vocabApiAvailable = false;
    }
  } catch (error) {
    vocabApiAvailable = false;
  }
}

async function deleteVocabEntryFromApi(entry) {
  if (authState.authenticated || authState.required) {
    return;
  }
  if (!vocabApiAvailable) {
    return;
  }
  try {
    const response = await fetch(VOCAB_API_ENDPOINT, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ entry })
    });
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      vocabApiAvailable = false;
    }
  } catch (error) {
    vocabApiAvailable = false;
  }
}

function enqueueVocabDelete(entry) {
  const normalized = normalizeVocabEntries([entry])[0];
  if (!normalized) {
    return;
  }
  enqueueVocabApiTask(() => deleteVocabEntryFromApi(normalized));
}

function createDocument({
  title = getDefaultDocumentTitle(),
  text = '',
  images = [],
  vocab = [],
  questions = [],
  correctionsBaseText = text,
  proofreadContent = '',
  proofreadUpdatedAt = null,
  workflow = null,
  isSaved = false,
  createdAt = null,
  updatedAt = null
} = {}) {
  const now = Date.now();
  const normalizedProofreadUpdatedAt = Number.isFinite(proofreadUpdatedAt)
    ? Math.trunc(proofreadUpdatedAt)
    : null;
  const normalizedCreatedAt = Number.isFinite(createdAt) ? Math.trunc(createdAt) : now;
  const normalizedUpdatedAt = Number.isFinite(updatedAt) ? Math.trunc(updatedAt) : normalizedCreatedAt;
  return {
    id: generateDocumentId(),
    title,
    text,
    images: normalizeDocumentImages(images),
    vocab: normalizeVocabEntries(vocab),
    questions: normalizeQuestionEntries(questions),
    correctionsBaseText: normalizeCorrectionsBaseText(correctionsBaseText, text),
    proofreadContent: typeof proofreadContent === 'string' ? proofreadContent : '',
    proofreadUpdatedAt: normalizedProofreadUpdatedAt,
    workflow: normalizeDocumentWorkflow(workflow),
    isSaved,
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt
  };
}

function applyDocumentToState(doc) {
  state.documentId = doc.id;
  state.title = doc.title || '';
  state.text = doc.text || '';
  state.images = normalizeDocumentImages(doc.images);
  state.vocab = normalizeVocabEntries(doc.vocab);
  state.questions = normalizeQuestionEntries(doc.questions);
  state.correctionsBaseText = normalizeCorrectionsBaseText(doc.correctionsBaseText, state.text);
  state.workflow = normalizeDocumentWorkflow(doc?.workflow);
  enforceWorkflowModeRules();
}

function hydrateProofreadFromDocument(doc, { reset = false } = {}) {
  if (reset) {
    setProofreadState({
      status: 'idle',
      content: '',
      error: '',
      updatedAt: null
    });
    return;
  }
  const content = typeof doc.proofreadContent === 'string' ? doc.proofreadContent : '';
  const updatedAt = Number.isFinite(doc.proofreadUpdatedAt)
    ? new Date(doc.proofreadUpdatedAt)
    : null;
  if (content) {
    setProofreadState({
      status: 'success',
      content,
      error: '',
      updatedAt
    });
  } else {
    setProofreadState({
      status: 'idle',
      content: '',
      error: '',
      updatedAt: null
    });
  }
}

function getActiveDocumentFromState() {
  return state.documents.find((entry) => entry.id === state.documentId) || null;
}

function isActiveDocumentSavedState() {
  return getActiveDocumentFromState()?.isSaved !== false;
}

function setActiveDocumentSavedState(isSaved) {
  const activeDocument = getActiveDocumentFromState();
  if (!activeDocument) {
    return;
  }
  activeDocument.isSaved = Boolean(isSaved);
}

function updateDocumentSaveControls() {
  if (!documentSave) {
    return;
  }
  const isSaved = isActiveDocumentSavedState();
  const copy = i18n[state.language];
  setElementText(documentSave, isSaved ? copy.documentSaved : copy.documentSave);
  documentSave.disabled = isSaved;
  if (documentTitleInput) {
    documentTitleInput.readOnly = isSaved;
    documentTitleInput.classList.toggle('is-read-only', isSaved);
  }
}

function hydrateShareFromDocument(doc) {
  shareState.sending = false;
  shareState.error = '';
  shareState.message = '';
  shareState.lastSharedAt = null;
  if (shareUserEmailInput) {
    shareUserEmailInput.value = '';
  }
  renderSharePanel();
}

function persistActiveDocument({
  updateList = false,
  normalize = false,
  markSaved = false
} = {}) {
  if (!state.documentId) {
    return;
  }
  const now = Date.now();
  const normalizedImages = normalizeDocumentImages(state.images);
  const normalizedVocab = normalize ? normalizeVocabEntries(state.vocab) : state.vocab;
  const normalizedQuestions = normalize ? normalizeQuestionEntries(state.questions) : state.questions;
  const normalizedWorkflow = normalizeDocumentWorkflow(state.workflow);
  state.images = normalizedImages;
  if (normalize) {
    state.vocab = normalizedVocab;
    state.questions = normalizedQuestions;
    state.workflow = normalizedWorkflow;
  }

  const index = state.documents.findIndex((doc) => doc.id === state.documentId);
  const hasProofread = proofreadState.status === 'success' && Boolean(proofreadState.content);
  const proofreadContent = hasProofread ? proofreadState.content : null;
  const proofreadUpdatedAt = hasProofread
    ? (proofreadState.updatedAt instanceof Date ? proofreadState.updatedAt.getTime() : now)
    : null;
  if (index === -1) {
    state.documents.unshift({
      id: state.documentId,
      title: state.title,
      text: state.text,
      images: normalizedImages,
      vocab: normalizedVocab,
      questions: normalizedQuestions,
      correctionsBaseText: normalizeCorrectionsBaseText(state.correctionsBaseText, state.text),
      proofreadContent: proofreadContent || '',
      proofreadUpdatedAt,
      workflow: normalizedWorkflow,
      isSaved: markSaved,
      createdAt: now,
      updatedAt: now
    });
  } else {
    const doc = state.documents[index];
    doc.title = state.title;
    doc.text = state.text;
    doc.images = normalizedImages;
    doc.vocab = normalizedVocab;
    doc.questions = normalizedQuestions;
    doc.correctionsBaseText = normalizeCorrectionsBaseText(state.correctionsBaseText, state.text);
    doc.workflow = normalizedWorkflow;
    if (hasProofread) {
      doc.proofreadContent = proofreadContent || '';
      doc.proofreadUpdatedAt = proofreadUpdatedAt;
    }
    if (markSaved) {
      doc.isSaved = true;
    }
    doc.updatedAt = now;
  }

  saveDocumentsToStorage();
  safeStorageSet(STORAGE_KEYS.activeDocument, state.documentId);

  if (updateList) {
    renderDocumentList();
    updateDocumentSaveControls();
    renderVocabularyPage();
  }
}

function setActiveDocument(doc, { resetProofread = false } = {}) {
  editingVocabIndex = null;
  applyDocumentToState(doc);
  safeStorageSet(STORAGE_KEYS.activeDocument, state.documentId);
  if (documentTitleInput && documentTitleInput.value !== state.title) {
    documentTitleInput.value = state.title;
  }
  composerInput.value = state.text;
  imageGalleryState.dragActive = false;
  imageGalleryState.status = 'idle';
  imageGalleryState.message = '';
  renderPreview();
  renderImageGallery();
  renderCorrections();
  renderVocab();
  renderQuestions();
  hydrateProofreadFromDocument(doc, { reset: resetProofread });
  hydrateShareFromDocument(doc);
  renderUI();
  clearActiveHover();
  hideTooltip();
  hideSelectionTooltip();
}

function buildLegacyDocument() {
  const storedEntry = safeStorageGet(STORAGE_KEYS.entry);
  const legacyVocab = loadVocabFromStorage();
  const legacyQuestions = loadQuestionsFromStorage();
  if (!storedEntry && !legacyVocab.length && !legacyQuestions.length) {
    return null;
  }
  return {
    id: generateDocumentId(),
    title: '',
    text: storedEntry || defaultText,
    images: [],
    correctionsBaseText: storedEntry || defaultText,
    vocab: legacyVocab,
    questions: legacyQuestions,
    proofreadContent: '',
    proofreadUpdatedAt: null,
    isSaved: true,
    workflow: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function loadState() {
  workspaceDeletedDocumentIds = loadWorkspaceDeletedDocumentIds();
  const storedDocuments = getWorkspaceFilteredDocuments(loadDocumentsFromStorage());
  if (storedDocuments.length) {
    state.documents = storedDocuments;
  } else {
    const legacyDocument = buildLegacyDocument();
    state.documents = legacyDocument ? [legacyDocument] : [createDocument({ text: defaultText })];
    saveDocumentsToStorage();
  }

  const storedActiveId = safeStorageGet(STORAGE_KEYS.activeDocument);
  const activeDocument = storedActiveId
    ? state.documents.find((doc) => doc.id === storedActiveId)
    : null;
  setActiveDocument(activeDocument || state.documents[0], { resetProofread: false });
}

function ensureLocalStateLoaded() {
  if (localStateLoaded) {
    return;
  }
  loadState();
  localStateLoaded = true;
}

function saveEntry() {
  persistActiveDocument();
}

function saveVocab({ persist = true } = {}) {
  const normalized = normalizeVocabEntries(state.vocab);
  state.vocab = normalized;
  setActiveDocumentSavedState(false);
  updateDocumentSaveControls();
  persistActiveDocument();
  renderVocabularyPage();
  if (!persist) {
    return;
  }
  enqueueVocabApiTask(() => persistVocabToApi(normalized));
}

function saveQuestions() {
  const normalized = normalizeQuestionEntries(state.questions);
  state.questions = normalized;
  setActiveDocumentSavedState(false);
  updateDocumentSaveControls();
  persistActiveDocument();
}

function buildImageGalleryStatusMessage(copy, { addedCount = 0, skippedCount = 0, failedCount = 0 } = {}) {
  const parts = [];
  if (addedCount > 0) {
    parts.push(formatCopy(copy.imageGalleryAdded, { count: addedCount }));
  }
  if (skippedCount > 0) {
    parts.push(formatCopy(copy.imageGallerySkipped, { count: skippedCount }));
  }
  if (failedCount > 0) {
    parts.push(copy.imageGalleryProcessError);
  }
  return parts.join(' ').trim();
}

async function addImagesToActiveDocument(fileList) {
  const copy = i18n[state.language];
  const rawFiles = Array.from(fileList || []);
  if (!rawFiles.length) {
    if (imageGalleryInput) {
      imageGalleryInput.value = '';
    }
    return;
  }

  const imageFiles = rawFiles.filter((file) => String(file?.type || '').startsWith('image/'));
  const unsupportedCount = rawFiles.length - imageFiles.length;
  if (!imageFiles.length) {
    if (imageGalleryInput) {
      imageGalleryInput.value = '';
    }
    setImageGalleryStatus('error', copy.imageGalleryUnsupported);
    return;
  }

  const availableSlots = Math.max(0, MAX_IMAGES_PER_DOCUMENT - state.images.length);
  if (!availableSlots) {
    if (imageGalleryInput) {
      imageGalleryInput.value = '';
    }
    setImageGalleryStatus('error', formatCopy(copy.imageGalleryLimitReached, { count: MAX_IMAGES_PER_DOCUMENT }));
    return;
  }

  const queuedFiles = imageFiles.slice(0, availableSlots);
  const limitSkippedCount = Math.max(0, imageFiles.length - queuedFiles.length);
  setImageGalleryStatus('loading', formatCopy(copy.imageGalleryProcessing, { count: queuedFiles.length }));

  const nextImages = [];
  let failedCount = 0;
  for (const file of queuedFiles) {
    try {
      const processedImage = await processDocumentImageFile(file);
      if (processedImage) {
        nextImages.push(processedImage);
      } else {
        failedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
    }
  }

  imageGalleryState.dragActive = false;
  const skippedCount = unsupportedCount + limitSkippedCount;
  if (nextImages.length) {
    state.images = normalizeDocumentImages([...state.images, ...nextImages]);
    setActiveDocumentSavedState(false);
    updateDocumentSaveControls();
    persistActiveDocument();
  }

  const statusMessage = buildImageGalleryStatusMessage(copy, {
    addedCount: nextImages.length,
    skippedCount,
    failedCount
  });
  if (nextImages.length) {
    setImageGalleryStatus('success', statusMessage);
  } else if (failedCount > 0) {
    setImageGalleryStatus('error', statusMessage || copy.imageGalleryProcessError);
  } else if (skippedCount > 0) {
    setImageGalleryStatus('error', statusMessage || formatCopy(copy.imageGalleryLimitReached, { count: MAX_IMAGES_PER_DOCUMENT }));
  } else {
    setImageGalleryStatus('error', copy.imageGalleryUnsupported);
  }

  if (imageGalleryInput) {
    imageGalleryInput.value = '';
  }
}

function removeImageFromActiveDocument(imageId) {
  if (!imageId) {
    return;
  }
  const nextImages = state.images.filter((image) => image.id !== imageId);
  if (nextImages.length === state.images.length) {
    return;
  }
  state.images = nextImages;
  setActiveDocumentSavedState(false);
  updateDocumentSaveControls();
  persistActiveDocument();
  if (imageGalleryState.activeImageId === imageId) {
    closeImageLightbox();
  }
  setImageGalleryStatus('idle', '');
}

function deleteDocumentById(targetDocumentId = state.documentId) {
  if (!targetDocumentId || !state.documents.length) {
    return;
  }
  const index = state.documents.findIndex((doc) => doc.id === targetDocumentId);
  if (index === -1) {
    return;
  }
  const isActive = state.documentId === targetDocumentId;
  markWorkspaceDocumentDeleted(targetDocumentId);
  state.documents.splice(index, 1);
  if (!state.documents.length) {
    state.documents = [createDocument()];
  }
  saveDocumentsToStorage();
  scheduleWorkspaceSync({ immediate: true });
  if (!isActive) {
    renderDocumentList();
    return;
  }
  const nextIndex = Math.min(index, state.documents.length - 1);
  setActiveDocument(state.documents[nextIndex]);
}

function deleteActiveDocument() {
  deleteDocumentById(state.documentId);
}

function buildDictionaryMeaning(entry) {
  return entry.senses?.[0]?.english_definitions?.slice(0, 3).join('; ') || '';
}

async function fetchDictionaryEntries(word) {
  const normalized = normalizeLookupWord(word);
  if (!normalized) {
    return [];
  }
  const proxyUrl = `${PROXY_DICT_ENDPOINT}${encodeURIComponent(normalized)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const data = await fetchJson(proxyUrl, controller.signal);
    return Array.isArray(data?.data) ? data.data : [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function lookupWord(word) {
  if (!hasKanji(word)) {
    return null;
  }
  const lookupEntries = await fetchDictionaryEntries(word);
  if (!lookupEntries.length) {
    return null;
  }
  const selection = selectBestEntry(lookupEntries, word);
  if (!selection) {
    return null;
  }
  const { entry, form } = selection;
  if (!entry || !form) {
    return null;
  }
  const reading = form.reading || '';
  const resolvedWord = form.word || word;

  return {
    word: resolvedWord,
    reading,
    meaning: buildDictionaryMeaning(entry)
  };
}

function pickBestFormForKana(entry, query) {
  const kanaQuery = toHiragana(query);
  if (!kanaQuery) {
    return null;
  }
  const forms = Array.isArray(entry?.japanese) ? entry.japanese : [];
  let best = null;
  let bestScore = -1;

  for (let i = 0; i < forms.length; i += 1) {
    const form = forms[i];
    if (!form || typeof form !== 'object') {
      continue;
    }
    const word = typeof form.word === 'string' ? form.word : '';
    const reading = typeof form.reading === 'string' ? form.reading : '';
    const fallbackReading = !hasKanji(word) && hasKana(word) ? word : '';
    const readingKana = toHiragana(reading || fallbackReading);
    let score = -1;
    if (word === query) {
      score = hasKanji(word) ? 240 : 220;
    }
    if (readingKana && readingKana === kanaQuery) {
      score = Math.max(score, hasKanji(word) ? 250 : 225);
    }
    if (score < 0) {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = {
        word: word || reading || query,
        reading: reading || fallbackReading,
        score
      };
    }
  }
  return best;
}

async function lookupKanaWord(word) {
  const normalized = normalizeLookupWord(word);
  if (!normalized || !hasKana(normalized)) {
    return null;
  }
  const lookupEntries = await fetchDictionaryEntries(normalized);
  if (!lookupEntries.length) {
    return null;
  }
  const kanaQuery = toHiragana(normalized);
  let best = null;
  let bestScore = -1;

  for (let i = 0; i < lookupEntries.length; i += 1) {
    const entry = lookupEntries[i];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const matched = pickBestFormForKana(entry, normalized);
    if (!matched) {
      continue;
    }
    const meaning = buildDictionaryMeaning(entry);
    const score = matched.score + (meaning ? 3 : 0);
    if (score > bestScore) {
      best = { ...matched, meaning };
      bestScore = score;
      if (toHiragana(matched.reading) === kanaQuery) {
        break;
      }
    }
  }

  return best;
}

function selectBestEntry(entries, query) {
  if (!Array.isArray(entries) || !entries.length) {
    return null;
  }
  let best = null;
  let bestScore = -1;
  const normalizedQuery = normalizeLookupWord(query);
  if (!normalizedQuery) {
    return null;
  }

  entries.forEach((entry) => {
    (entry.japanese || []).forEach((form) => {
      const wordForm = normalizeLookupWord(form.word || '');
      const reading = typeof form.reading === 'string' ? form.reading : '';
      let score = -1;

      if (wordForm && wordForm === normalizedQuery) {
        score = 200;
      } else if (!wordForm && reading === normalizedQuery) {
        score = 150;
      }
      if (score < 0) {
        return;
      }
      if (reading) score += 5;
      if (buildDictionaryMeaning(entry)) score += 3;

      if (score > bestScore) {
        bestScore = score;
        best = { entry, form };
      }
    });
  });

  if (!best) {
    return null;
  }
  return best;
}

async function fetchJson(url, signal) {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function lookupDictionaryEntry(word) {
  const normalized = normalizeLookupWord(word);
  if (!normalized) {
    return null;
  }
  if (hasKanji(normalized)) {
    return lookupWord(normalized);
  }
  if (hasKana(normalized)) {
    return lookupKanaWord(normalized);
  }
  return null;
}

function ensureLookup(word) {
  const normalized = normalizeLookupWord(word);
  if (!normalized || (!hasKanji(normalized) && !hasKana(normalized))) {
    return;
  }

  if (lookupCache.has(normalized) || pendingLookups.has(normalized)) {
    return;
  }

  const lookupPromise = lookupDictionaryEntry(normalized).then((result) => {
    lookupCache.set(normalized, result);
    pendingLookups.delete(normalized);
    schedulePreviewRender();
  });

  pendingLookups.set(normalized, lookupPromise);
}

function buildTokenElement(token, info, lookupWord) {
  const resolvedLookup = lookupWord || token;
  const base = document.createElement('span');
  base.className = 'token-base';

  const reading = info?.reading ? toHiragana(info.reading) : '';
  const segments = hasKanji(token) && reading
    ? splitTokenForFurigana(token, reading)
    : [{ type: 'plain', text: token }];

  segments.forEach((segment) => {
    if (segment.type === 'kanji' && segment.reading) {
      const ruby = document.createElement('ruby');
      const rb = document.createElement('span');
      rb.className = 'ruby-base';
      for (const char of segment.text) {
        const span = document.createElement('span');
        span.className = isKanji(char) ? 'kanji char' : 'char';
        if (isKanji(char)) {
          span.dataset.word = resolvedLookup;
          span.dataset.surface = token;
          span.dataset.reading = segment.reading;
        }
        span.textContent = char;
        rb.appendChild(span);
      }
      const rt = document.createElement('rt');
      rt.textContent = segment.reading;
      ruby.appendChild(rb);
      ruby.appendChild(rt);
      base.appendChild(ruby);
      return;
    }

    for (const char of segment.text) {
      const span = document.createElement('span');
      span.className = isKanji(char) ? 'kanji char' : 'char';
      if (isKanji(char)) {
        span.dataset.word = resolvedLookup;
        span.dataset.surface = token;
        span.dataset.reading = reading;
      }
      span.textContent = char;
      base.appendChild(span);
    }
  });

  return base;
}

function renderPreview() {
  preview.replaceChildren();

  if (!state.text.trim()) {
    const placeholder = document.createElement('div');
    placeholder.className = 'vocab-empty';
    placeholder.textContent = i18n[state.language].previewEmpty;
    preview.appendChild(placeholder);
    return;
  }

  const lines = state.text.split('\n');
  lines.forEach((line, index) => {
    const segments = getLineTokens(line);
    segments.forEach((segment) => {
      const raw = segment?.text ?? '';
      if (!raw) {
        return;
      }

      if (hasKanji(raw)) {
        const lookupWord = segment.lookup || normalizeLookupWord(raw);
        ensureLookup(lookupWord);
        const info = lookupCache.get(lookupWord);
        const readingInfo = segment.reading ? { ...(info || {}), reading: segment.reading } : info;
        preview.appendChild(buildTokenElement(raw, readingInfo, lookupWord));
      } else {
        preview.appendChild(document.createTextNode(raw));
      }
    });

    if (index < lines.length - 1) {
      preview.appendChild(document.createElement('br'));
    }
  });
}

function getActiveGalleryImage() {
  const activeImageId = imageGalleryState.activeImageId;
  if (!activeImageId) {
    return null;
  }
  return state.images.find((image) => image.id === activeImageId) || null;
}

function formatImageMeta(image) {
  const parts = [];
  if (Number.isFinite(image?.width) && Number.isFinite(image?.height)) {
    parts.push(`${image.width} × ${image.height}`);
  }
  return parts.join(' · ');
}

function setImageGalleryStatus(status = 'idle', message = '') {
  imageGalleryState.status = status;
  imageGalleryState.message = message;
  renderImageGallery();
}

function openImageLightbox(imageId) {
  if (!imageId || !state.images.some((image) => image.id === imageId)) {
    return;
  }
  imageGalleryState.activeImageId = imageId;
  renderImageLightbox();
  requestAnimationFrame(() => {
    imageLightboxClose?.focus();
  });
}

function closeImageLightbox() {
  if (!imageGalleryState.activeImageId) {
    return;
  }
  imageGalleryState.activeImageId = '';
  renderImageLightbox();
}

function renderImageLightbox() {
  if (!imageLightbox || !imageLightboxImage || !imageLightboxCaption || !imageLightboxClose) {
    return;
  }
  const copy = i18n[state.language];
  const activeImage = getActiveGalleryImage();
  const isOpen = Boolean(activeImage);
  imageLightbox.hidden = !isOpen;
  imageLightbox.setAttribute('aria-hidden', String(!isOpen));
  document.body.classList.toggle('image-lightbox-open', isOpen);
  setElementText(imageLightboxClose, copy.imageLightboxClose);
  imageLightboxClose.setAttribute('aria-label', copy.imageLightboxClose);

  if (!isOpen) {
    imageLightboxImage.src = '';
    imageLightboxImage.alt = '';
    imageLightboxCaption.textContent = '';
    return;
  }

  const imageName = activeImage.name || copy.imageGalleryUntitled;
  const imageMeta = formatImageMeta(activeImage);
  imageLightboxImage.src = activeImage.src;
  imageLightboxImage.alt = imageName;
  imageLightboxCaption.textContent = imageMeta ? `${imageName} · ${imageMeta}` : imageName;
}

function renderImageGallery() {
  if (!imageGalleryGrid || !imageDropzone || !imageDropzoneCopy || !imageDropzoneStatus) {
    renderImageLightbox();
    return;
  }
  const copy = i18n[state.language];
  const activeImage = getActiveGalleryImage();
  if (!activeImage && imageGalleryState.activeImageId) {
    imageGalleryState.activeImageId = '';
  }

  if (imageGalleryTitle) {
    imageGalleryTitle.textContent = copy.imageGalleryTitle;
  }
  if (imageGallerySubtitle) {
    imageGallerySubtitle.textContent = copy.imageGallerySubtitle;
  }
  if (imageGalleryBrowse) {
    setElementText(imageGalleryBrowse, copy.imageGalleryBrowse);
    imageGalleryBrowse.disabled = imageGalleryState.status === 'loading';
  }
  imageDropzone.classList.toggle('is-dragging', imageGalleryState.dragActive);
  imageDropzone.disabled = imageGalleryState.status === 'loading';
  imageDropzoneCopy.textContent = imageGalleryState.dragActive
    ? copy.imageGalleryDropActive
    : copy.imageGalleryDropHint;

  imageDropzoneStatus.textContent = imageGalleryState.message || '';
  imageDropzoneStatus.className = 'image-dropzone-status';
  if (imageGalleryState.status === 'loading') {
    imageDropzoneStatus.classList.add('is-loading');
  } else if (imageGalleryState.status === 'success') {
    imageDropzoneStatus.classList.add('is-success');
  } else if (imageGalleryState.status === 'error') {
    imageDropzoneStatus.classList.add('is-error');
  }

  imageGalleryGrid.replaceChildren();
  if (!state.images.length) {
    const empty = document.createElement('p');
    empty.className = 'image-gallery-empty';
    empty.textContent = copy.imageGalleryEmpty;
    imageGalleryGrid.appendChild(empty);
    renderImageLightbox();
    return;
  }

  state.images.forEach((image) => {
    const card = document.createElement('article');
    card.className = 'image-card';

    const removeButton = document.createElement('button');
    removeButton.className = 'image-thumb-remove';
    removeButton.type = 'button';
    removeButton.dataset.imageId = image.id;
    removeButton.setAttribute('aria-label', `${copy.imageGalleryRemove}: ${image.name || copy.imageGalleryUntitled}`);
    removeButton.title = copy.imageGalleryRemove;
    removeButton.textContent = '×';
    card.appendChild(removeButton);

    const thumbButton = document.createElement('button');
    thumbButton.className = 'image-thumb';
    thumbButton.type = 'button';
    thumbButton.dataset.imageId = image.id;
    thumbButton.setAttribute('aria-label', `${copy.imageGalleryZoom}: ${image.name || copy.imageGalleryUntitled}`);

    const previewShell = document.createElement('div');
    previewShell.className = 'image-thumb-preview';
    const previewImage = document.createElement('img');
    previewImage.src = image.src;
    previewImage.alt = image.name || copy.imageGalleryUntitled;
    previewShell.appendChild(previewImage);
    thumbButton.appendChild(previewShell);

    const meta = document.createElement('div');
    meta.className = 'image-thumb-meta';
    const name = document.createElement('div');
    name.className = 'image-thumb-name';
    name.textContent = image.name || copy.imageGalleryUntitled;
    const size = document.createElement('div');
    size.className = 'image-thumb-size';
    size.textContent = formatImageMeta(image);
    meta.appendChild(name);
    meta.appendChild(size);
    thumbButton.appendChild(meta);

    card.appendChild(thumbButton);
    imageGalleryGrid.appendChild(card);
  });

  renderImageLightbox();
}

async function renderSyntheticResultText(text, outputContainer = syntheticResult) {
  if (!outputContainer) {
    return;
  }
  const copy = i18n[state.language];
  const normalizedText = normalizeLineBreaks(sanitizeSyntheticText(text));
  const lines = normalizedText.split('\n');
  const requestedLookups = [];

  if (!normalizedText.trim()) {
    const placeholder = document.createElement('div');
    placeholder.className = 'synthetic-result-empty';
    placeholder.textContent = copy.syntheticResultEmpty;
    outputContainer.appendChild(placeholder);
    return;
  }

  lines.forEach((line, lineIndex) => {
    const segments = getLineTokens(line);
    if (!segments.length) {
      if (lineIndex < lines.length - 1) {
        outputContainer.appendChild(document.createElement('br'));
      }
      return;
    }

    segments.forEach((segment) => {
      const raw = segment?.text ?? '';
      if (!raw) {
        return;
      }

      if (hasKanji(raw)) {
        const lookupWord = segment.lookup || normalizeLookupWord(raw);
        const info = segment.reading
          ? { ...((lookupWord ? lookupCache.get(lookupWord) : null) || {}), reading: segment.reading }
          : lookupWord ? lookupCache.get(lookupWord) : null;
        if (!segment.reading && lookupWord && !lookupCache.has(lookupWord) && !pendingLookups.has(lookupWord)) {
          ensureLookup(lookupWord);
          const pending = pendingLookups.get(lookupWord);
          if (pending) {
            requestedLookups.push(pending);
          }
        }
        outputContainer.appendChild(buildTokenElement(raw, info, lookupWord));
      } else {
        outputContainer.appendChild(document.createTextNode(raw));
      }
    });

    if (lineIndex < lines.length - 1) {
      outputContainer.appendChild(document.createElement('br'));
    }
  });

  if (!requestedLookups.length) {
    return;
  }

  try {
    await Promise.allSettled(requestedLookups);
    if (syntheticDocumentState.text === text) {
      renderSyntheticGeneratorPanel();
    }
  } catch (error) {
    // Ignore lookup errors for synthetic output.
  }
}

function sanitizeSyntheticText(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text.replace(/([一-龯々]+)\s*[\uff08(][\u3040-\u30FFー・゛゜\u3000\s]+[\uff09)]/g, '$1');
}

function normalizeLineBreaks(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function hasTrackedCorrections() {
  return normalizeLineBreaks(state.correctionsBaseText) !== normalizeLineBreaks(state.text);
}

function tokenizeCorrectionText(text) {
  if (!text) {
    return [];
  }
  if (!correctionSegmenter) {
    return Array.from(text);
  }
  const tokens = [];
  for (const part of correctionSegmenter.segment(text)) {
    if (!part || typeof part.segment !== 'string' || !part.segment) {
      continue;
    }
    tokens.push(part.segment);
  }
  return tokens;
}

function buildFallbackTokenDiffOperations(beforeTokens, afterTokens) {
  let prefix = 0;
  while (
    prefix < beforeTokens.length
    && prefix < afterTokens.length
    && beforeTokens[prefix] === afterTokens[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeTokens.length - 1;
  let afterSuffix = afterTokens.length - 1;
  while (
    beforeSuffix >= prefix
    && afterSuffix >= prefix
    && beforeTokens[beforeSuffix] === afterTokens[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const operations = [];
  for (let i = 0; i < prefix; i += 1) {
    operations.push({ type: 'equal', text: beforeTokens[i] });
  }
  for (let i = prefix; i <= beforeSuffix; i += 1) {
    operations.push({ type: 'delete', text: beforeTokens[i] });
  }
  for (let i = prefix; i <= afterSuffix; i += 1) {
    operations.push({ type: 'insert', text: afterTokens[i] });
  }
  for (let i = beforeSuffix + 1; i < beforeTokens.length; i += 1) {
    operations.push({ type: 'equal', text: beforeTokens[i] });
  }
  return operations;
}

function mergeCorrectionOperations(operations) {
  const merged = [];
  operations.forEach((operation) => {
    if (!operation || !operation.text) {
      return;
    }
    const previous = merged[merged.length - 1];
    if (previous && previous.type === operation.type) {
      previous.text += operation.text;
      return;
    }
    merged.push({ type: operation.type, text: operation.text });
  });
  return merged;
}

function buildTokenDiffOperations(beforeTokens, afterTokens) {
  const n = beforeTokens.length;
  const m = afterTokens.length;
  const maxCells = 300000;
  if (n * m > maxCells) {
    return buildFallbackTokenDiffOperations(beforeTokens, afterTokens);
  }

  const matrix = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (beforeTokens[i] === afterTokens[j]) {
        matrix[i][j] = matrix[i + 1][j + 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeTokens[i] === afterTokens[j]) {
      operations.push({ type: 'equal', text: beforeTokens[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      operations.push({ type: 'delete', text: beforeTokens[i] });
      i += 1;
    } else {
      operations.push({ type: 'insert', text: afterTokens[j] });
      j += 1;
    }
  }
  while (i < n) {
    operations.push({ type: 'delete', text: beforeTokens[i] });
    i += 1;
  }
  while (j < m) {
    operations.push({ type: 'insert', text: afterTokens[j] });
    j += 1;
  }

  return mergeCorrectionOperations(operations);
}

function buildCorrectionOperations(baseText, currentText) {
  const before = normalizeLineBreaks(baseText);
  const after = normalizeLineBreaks(currentText);
  if (before === after) {
    return [];
  }

  const beforeTokens = tokenizeCorrectionText(before);
  const afterTokens = tokenizeCorrectionText(after);
  return buildTokenDiffOperations(beforeTokens, afterTokens);
}

function renderCorrections() {
  if (!correctionsPanel || !correctionsList || !correctionsTitle || !correctionsSubtitle) {
    return;
  }

  const copy = i18n[state.language];
  correctionsTitle.textContent = copy.correctionsTitle;
  correctionsSubtitle.textContent = copy.correctionsSubtitle;

  correctionsList.replaceChildren();
  const operations = buildCorrectionOperations(state.correctionsBaseText, state.text);
  const hasChanges = operations.some((operation) => operation.type !== 'equal');
  if (!hasChanges) {
    const empty = document.createElement('div');
    empty.className = 'corrections-empty';
    empty.textContent = copy.correctionsEmpty;
    correctionsList.appendChild(empty);
    return;
  }

  const trackedText = document.createElement('div');
  trackedText.className = 'corrections-track';

  operations.forEach((operation) => {
    if (operation.type === 'equal') {
      trackedText.appendChild(document.createTextNode(operation.text));
      return;
    }
    const span = document.createElement('span');
    span.className = operation.type === 'insert' ? 'correction-added' : 'correction-removed';
    span.textContent = operation.text;
    trackedText.appendChild(span);
  });

  correctionsList.appendChild(trackedText);
}

function renderVocab() {
  vocabList.replaceChildren();

  if (editingVocabIndex !== null && editingVocabIndex >= state.vocab.length) {
    editingVocabIndex = null;
  }

  if (!state.vocab.length) {
    const empty = document.createElement('div');
    empty.className = 'vocab-empty';
    empty.textContent = i18n[state.language].vocabEmpty;
    vocabList.appendChild(empty);
    return;
  }

  const table = document.createElement('div');
  table.className = 'vocab-table';
  const copy = i18n[state.language];

  const header = document.createElement('div');
  header.className = 'vocab-row vocab-head';
  header.appendChild(buildVocabCell(i18n[state.language].vocabMeaning));
  header.appendChild(buildVocabCell(i18n[state.language].vocabKana));
  header.appendChild(buildVocabCell(i18n[state.language].vocabKanji));
  const headerActionsCell = document.createElement('div');
  headerActionsCell.className = 'vocab-cell vocab-head-actions';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'vocab-action vocab-add';
  addButton.setAttribute('aria-label', copy.vocabAdd);
  addButton.setAttribute('title', copy.vocabAdd);
  addButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M11 4h2v16h-2V4Zm-8 6h16v2H3v-2Z"/>
    </svg>
  `;
  addButton.addEventListener('click', (event) => {
    event.stopPropagation();
    state.vocab.unshift({
      word: '',
      reading: '',
      meaning: '',
      addedAt: Date.now()
    });
    editingVocabIndex = 0;
    renderVocab();
  });
  headerActionsCell.appendChild(addButton);
  header.appendChild(headerActionsCell);
  table.appendChild(header);

  state.vocab.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'vocab-row';
    const isEditing = editingVocabIndex === index;

    const meaningText = entry.meaning || '-';
    const hasEntryKanji = hasKanji(entry.word || '');
    const kanaText = entry.reading || (hasEntryKanji ? '-' : (entry.word || '-'));
    const kanjiText = hasEntryKanji ? entry.word : '-';

    if (isEditing) {
      const meaningInput = document.createElement('input');
      meaningInput.type = 'text';
      meaningInput.className = 'vocab-input';
      meaningInput.value = entry.meaning || '';
      meaningInput.placeholder = copy.vocabMeaning;
      const meaningCell = document.createElement('div');
      meaningCell.className = 'vocab-cell';
      meaningCell.appendChild(meaningInput);

      const kanaInput = document.createElement('input');
      kanaInput.type = 'text';
      kanaInput.className = 'vocab-input';
      kanaInput.value = entry.reading || (entry.word || '');
      kanaInput.placeholder = copy.vocabKana;
      const kanaCell = document.createElement('div');
      kanaCell.className = 'vocab-cell';
      kanaCell.appendChild(kanaInput);

      const kanjiInput = document.createElement('input');
      kanjiInput.type = 'text';
      kanjiInput.className = 'vocab-input';
      kanjiInput.value = hasEntryKanji ? (entry.word || '') : '';
      kanjiInput.placeholder = copy.vocabKanji;
      const kanjiCell = document.createElement('div');
      kanjiCell.className = 'vocab-cell';
      kanjiCell.appendChild(kanjiInput);

      row.appendChild(meaningCell);
      row.appendChild(kanaCell);
      row.appendChild(kanjiCell);

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'vocab-action vocab-save';
      saveButton.setAttribute('aria-label', copy.vocabSave);
      saveButton.setAttribute('title', copy.vocabSave);
      saveButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m10 17.8-4.7-4.7 1.4-1.4 3.3 3.3 8.3-8.3 1.4 1.4z"/>
        </svg>
      `;
      saveButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (editingVocabIndex !== index || !state.vocab[index]) {
          return;
        }
        const nextWord = kanjiInput.value.trim();
        const nextReading = kanaInput.value.trim();
        const normalized = normalizeVocabEntries([{
          word: nextWord,
          reading: nextReading,
          meaning: meaningInput.value.trim()
        }])[0];
        if (!normalized) {
          const removed = state.vocab[index];
          state.vocab = state.vocab.filter((_, idx) => idx !== index);
          editingVocabIndex = null;
          saveVocab();
          if (removed) {
            enqueueVocabDelete(removed);
          }
          renderVocab();
          return;
        }

        const current = state.vocab[index];
        state.vocab[index] = {
          word: normalized.word,
          reading: normalized.reading,
          meaning: normalized.meaning,
          addedAt: Number.isFinite(current?.addedAt) ? current.addedAt : Date.now()
        };
        editingVocabIndex = null;
        saveVocab();
        renderVocab();
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'vocab-action vocab-delete';
      deleteButton.setAttribute('aria-label', copy.vocabDelete);
      deleteButton.setAttribute('title', copy.vocabDelete);
      deleteButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 3h6l1 2h4v2h-1.2l-1.1 13.2a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8L5.2 7H4V5h4l1-2zm-1.6 4 1 12.1c.1.2.2.4.5.4h6.2c.3 0 .4-.2.5-.4L16.6 7H7.4zm3 2h2v8h-2V9zm-3 0h2v8h-2V9zm8 0h2v8h-2V9z"/>
        </svg>
      `;
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const removed = state.vocab[index];
        state.vocab = state.vocab.filter((_, idx) => idx !== index);
        saveVocab();
        enqueueVocabDelete(removed);
        editingVocabIndex = null;
        renderVocab();
      });

      const actionsCell = document.createElement('div');
      actionsCell.className = 'vocab-actions';
      actionsCell.appendChild(saveButton);
      actionsCell.appendChild(deleteButton);
      row.appendChild(actionsCell);
    } else {
      row.appendChild(buildVocabCell(meaningText));
      row.appendChild(buildVocabCell(kanaText));
      row.appendChild(buildVocabCell(kanjiText));

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'vocab-action vocab-edit';
      editButton.setAttribute('aria-label', copy.vocabEdit);
      editButton.setAttribute('title', copy.vocabEdit);
      editButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m17.1 3 3.9 3.9-11.3 11.3-4.1.9.9-4.1L17.1 3Zm2.5 2.9-3.9-3.9 1.8-1.8a1.8 1.8 0 0 1 2.5 0l1.4 1.4a1.8 1.8 0 0 1 0 2.5L19.6 5.9Z"/>
        </svg>
      `;
      editButton.addEventListener('click', (event) => {
        event.stopPropagation();
        editingVocabIndex = index;
        renderVocab();
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'vocab-action vocab-delete';
      deleteButton.setAttribute('aria-label', copy.vocabDelete);
      deleteButton.setAttribute('title', copy.vocabDelete);
      deleteButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 3h6l1 2h4v2h-1.2l-1.1 13.2a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8L5.2 7H4V5h4l1-2zm-1.6 4 1 12.1c.1.2.2.4.5.4h6.2c.3 0 .4-.2.5-.4L16.6 7H7.4zm3 2h2v8h-2V9zm-3 0h2v8h-2V9zm8 0h2v8h-2V9z"/>
        </svg>
      `;
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const removed = state.vocab[index];
        state.vocab = state.vocab.filter((_, idx) => idx !== index);
        saveVocab();
        enqueueVocabDelete(removed);
        renderVocab();
      });

      const actionsCell = document.createElement('div');
      actionsCell.className = 'vocab-actions';
      actionsCell.appendChild(editButton);
      actionsCell.appendChild(deleteButton);
      row.appendChild(actionsCell);
    }

    table.appendChild(row);
  });

  vocabList.appendChild(table);
}

function getAllSavedVocabularyEntries() {
  const copy = i18n[state.language];
  const entries = (state.documents || [])
    .filter((doc) => doc && Array.isArray(doc.vocab) && doc.vocab.length > 0)
    .flatMap((doc) => {
      const postTitle = buildDocumentLabel(doc, copy);
      const entries = normalizeVocabEntries(Array.isArray(doc.vocab) ? doc.vocab : []);
      return entries.map((entry, index) => ({
        ...entry,
        postTitle,
        documentId: doc.id,
        syntheticId: buildSyntheticVocabId(doc.id, entry, index),
      }));
    });
  syncSyntheticSelectionState(entries);
  return entries;
}

function buildSyntheticVocabId(documentId, entry, index) {
  const docId = typeof documentId === 'string' ? documentId : 'doc';
  const word = typeof entry.word === 'string' ? entry.word : '';
  const reading = typeof entry.reading === 'string' ? entry.reading : '';
  const meaning = typeof entry.meaning === 'string' ? entry.meaning : '';
  const addedAt = Number.isFinite(entry?.addedAt) ? Math.trunc(entry.addedAt) : 0;
  return `${docId}|${index}|${addedAt}|${word}|${reading}|${meaning}`;
}

function syncSyntheticSelectionState(entries) {
  if (!syntheticDocumentState.selectedVocabularyIds.size) {
    return;
  }
  const validIds = new Set(entries.map((entry) => entry.syntheticId));
  const nextIds = new Set(
    Array.from(syntheticDocumentState.selectedVocabularyIds).filter((id) => validIds.has(id))
  );
  syntheticDocumentState.selectedVocabularyIds = nextIds;
}

function getSelectedSyntheticEntries() {
  const entries = getAllSavedVocabularyEntries();
  return entries.filter((entry) => syntheticDocumentState.selectedVocabularyIds.has(entry.syntheticId));
}

function toggleSyntheticSelection(syntheticId, checked) {
  if (!syntheticId) {
    return;
  }
  if (checked) {
    syntheticDocumentState.selectedVocabularyIds.add(syntheticId);
  } else {
    syntheticDocumentState.selectedVocabularyIds.delete(syntheticId);
  }
  renderSyntheticGeneratorPanel();
}

function renderVocabularyPage() {
  if (!allVocabList) {
    return;
  }
  const copy = i18n[state.language];
  allVocabList.replaceChildren();

  const entries = getAllSavedVocabularyEntries();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'vocab-empty';
    empty.textContent = copy.allVocabEmpty || copy.vocabEmpty;
    allVocabList.appendChild(empty);
    renderSyntheticGeneratorPanel();
    return;
  }

  const table = document.createElement('div');
  table.className = 'vocab-table vocabulary-table';
  const header = document.createElement('div');
  header.className = 'vocab-row vocab-head';
  header.appendChild(buildVocabCell(copy.syntheticSelectLabel || 'Select'));
  header.appendChild(buildVocabCell(copy.vocabMeaning));
  header.appendChild(buildVocabCell(copy.vocabKana));
  header.appendChild(buildVocabCell(copy.vocabKanji));
  header.appendChild(buildVocabCell(copy.vocabPostTitle || 'Post'));
  table.appendChild(header);

  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'vocab-row';
    const meaningText = entry.meaning || '-';
    const hasEntryKanji = hasKanji(entry.word || '');
    const kanaText = entry.reading || (hasEntryKanji ? '-' : (entry.word || '-'));
    const kanjiText = hasEntryKanji ? (entry.word || '') : '-';
    const postText = entry.postTitle || copy.documentUntitled;
    const isChecked = syntheticDocumentState.selectedVocabularyIds.has(entry.syntheticId);

    const checkboxCell = document.createElement('div');
    checkboxCell.className = 'vocab-cell';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'vocab-select';
    checkbox.checked = isChecked;
    checkbox.setAttribute('aria-label', `${entry.word || copy.syntheticSelectLabel || 'Vocab'} (${copy.syntheticSelectLabel || 'Select'})`);
    checkbox.addEventListener('change', () => {
      toggleSyntheticSelection(entry.syntheticId, checkbox.checked);
    });
    checkboxCell.appendChild(checkbox);

    row.appendChild(checkboxCell);
    row.appendChild(buildVocabCell(meaningText));
    row.appendChild(buildVocabCell(kanaText));
    row.appendChild(buildVocabCell(kanjiText));
    row.appendChild(buildVocabCell(postText));
    table.appendChild(row);
  });

  allVocabList.appendChild(table);
  renderSyntheticGeneratorPanel();
}

function renderSyntheticGeneratorPanel() {
  if (!syntheticDifficultySelect || !syntheticCategorySelect || !syntheticGenerateButton) {
    return;
  }
  const copy = i18n[state.language];
  const selectedEntries = getSelectedSyntheticEntries();
  const selectedCount = selectedEntries.length;
  const isLoading = syntheticDocumentState.status === 'loading';
  const hasOutput = Boolean(syntheticDocumentState.text);
  const isFlashcardMode = flashcardReviewState.mode === FLASHCARD_MODES.flashcard;
  const isFlashcardReviewRunning = isFlashcardMode && flashcardReviewState.phase === 'running';

  syntheticDifficultySelect.value = SYNTHETIC_DIFFICULTIES.includes(syntheticDocumentState.difficulty)
    ? syntheticDocumentState.difficulty
    : SYNTHETIC_DIFFICULTIES[0];
  syntheticCategorySelect.value = SYNTHETIC_CATEGORIES.some(({ value }) => value === syntheticDocumentState.category)
    ? syntheticDocumentState.category
    : SYNTHETIC_CATEGORIES[0].value;

  if (syntheticDifficultyField) {
    syntheticDifficultyField.hidden = isFlashcardReviewRunning;
  }
  if (syntheticCategoryField) {
    syntheticCategoryField.hidden = isFlashcardReviewRunning;
  }

  if (syntheticDifficultyLabel) {
    syntheticDifficultyLabel.textContent = copy.syntheticDifficultyLabel;
  }
  if (syntheticCategoryLabel) {
    syntheticCategoryLabel.textContent = copy.syntheticCategoryLabel;
  }
  setElementText(syntheticGenerateButton, isLoading ? copy.syntheticGenerating : copy.syntheticGenerate);
  syntheticGenerateButton.disabled = isLoading || !selectedCount;
  syntheticGenerateButton.setAttribute('aria-busy', String(isLoading));
  syntheticGenerateButton.hidden = isFlashcardReviewRunning;

  if (syntheticStatus) {
    syntheticStatus.classList.remove('is-error');
    if (isLoading) {
      syntheticStatus.textContent = copy.syntheticGenerating;
    } else if (syntheticDocumentState.error) {
      syntheticStatus.textContent = syntheticDocumentState.error;
      syntheticStatus.classList.add('is-error');
    } else if (hasOutput) {
      syntheticStatus.textContent = `${copy.syntheticSelectCount}: ${selectedCount}`;
      syntheticStatus.classList.remove('is-error');
    } else {
      syntheticStatus.textContent = selectedCount
        ? `${copy.syntheticSelectCount}: ${selectedCount}`
        : copy.syntheticNoSelection;
      syntheticStatus.classList.remove('is-error');
    }
  }

  if (syntheticResultTitle) {
    syntheticResultTitle.textContent = copy.syntheticResultTitle;
    syntheticResultTitle.hidden = isFlashcardReviewRunning;
  }
  if (syntheticResult) {
    syntheticResult.hidden = isFlashcardReviewRunning;
    syntheticResult.replaceChildren();
    if (!isFlashcardReviewRunning && syntheticDocumentState.text) {
      const resultText = document.createElement('div');
      resultText.className = 'synthetic-result-text';
      resultText.setAttribute('aria-live', 'polite');
      syntheticResult.appendChild(resultText);
      renderSyntheticResultText(syntheticDocumentState.text, resultText);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'synthetic-result-empty';
      placeholder.textContent = copy.syntheticResultEmpty;
      syntheticResult.appendChild(placeholder);
    }
  }

  renderFlashcardReview();
}

function buildSyntheticDocumentPayload(entries) {
  return {
    readingDifficulty: syntheticDocumentState.difficulty,
    textCategory: syntheticDocumentState.category,
    vocabulary: entries.map((entry) => ({
      word: entry.word || '',
      reading: entry.reading || '',
      meaning: entry.meaning || '',
      source: entry.postTitle || '',
      sourceDocumentId: entry.documentId || ''
    }))
  };
}

function renderPageView() {
  const activePage = state.activePage === 'vocabulary' ? 'vocabulary' : 'compose';
  const isCompose = activePage === 'compose';

  if (composePage) {
    composePage.classList.toggle('is-active', isCompose);
  }
  if (vocabularyPage) {
    vocabularyPage.classList.toggle('is-active', !isCompose);
  }

  if (pageNavCompose) {
    setElementText(pageNavCompose, copySafe(i18n[state.language].pageCompose, 'Compose'));
    pageNavCompose.setAttribute('aria-pressed', String(isCompose));
    pageNavCompose.setAttribute('aria-current', isCompose ? 'page' : 'false');
  }
  if (pageNavVocabulary) {
    setElementText(pageNavVocabulary, copySafe(i18n[state.language].pageVocabulary, 'Vocabulary'));
    pageNavVocabulary.setAttribute('aria-pressed', String(!isCompose));
    pageNavVocabulary.setAttribute('aria-current', !isCompose ? 'page' : 'false');
  }

  if (allVocabTitle) {
    allVocabTitle.textContent = copySafe(i18n[state.language].vocabularyTitle, copySafe(i18n[state.language].vocabTitle, 'Vocabulary'));
  }
  if (allVocabSubtitle) {
    allVocabSubtitle.textContent = copySafe(i18n[state.language].vocabularySubtitle, copySafe(i18n[state.language].vocabSubtitle, 'Saved words from your journal entry.'));
  }
  if (syntheticResultTitle) {
    syntheticResultTitle.textContent = copySafe(i18n[state.language].syntheticResultTitle, 'Generated text');
  }
  if (syntheticDifficultySelect) {
    syntheticDifficultySelect.setAttribute('aria-label', copySafe(i18n[state.language].syntheticDifficultyLabel, 'Reading difficulty'));
  }
  if (syntheticCategorySelect) {
    syntheticCategorySelect.setAttribute('aria-label', copySafe(i18n[state.language].syntheticCategoryLabel, 'Text category'));
  }
  if (vocabReviewModeSelect) {
    vocabReviewModeSelect.setAttribute('aria-label', copySafe(i18n[state.language].reviewModeLabel, 'Review mode'));
    const options = Array.from(vocabReviewModeSelect.options);
    if (!options.length) {
      const syntheticOption = document.createElement('option');
      syntheticOption.value = FLASHCARD_MODES.synthetic;
      syntheticOption.textContent = copySafe(i18n[state.language].reviewModeSynthetic, 'Synthetic document');
      vocabReviewModeSelect.appendChild(syntheticOption);

      const flashcardOption = document.createElement('option');
      flashcardOption.value = FLASHCARD_MODES.flashcard;
      flashcardOption.textContent = copySafe(i18n[state.language].reviewModeFlashcard, 'Flashcard review');
      vocabReviewModeSelect.appendChild(flashcardOption);
    }
    Array.from(vocabReviewModeSelect.options).forEach((option) => {
      if (option.value === FLASHCARD_MODES.synthetic) {
        option.textContent = copySafe(i18n[state.language].reviewModeSynthetic, 'Synthetic document');
      }
      if (option.value === FLASHCARD_MODES.flashcard) {
        option.textContent = copySafe(i18n[state.language].reviewModeFlashcard, 'Flashcard review');
      }
    });
    vocabReviewModeSelect.value = flashcardReviewState.mode === FLASHCARD_MODES.flashcard
      ? FLASHCARD_MODES.flashcard
      : FLASHCARD_MODES.synthetic;
  }
  if (vocabReviewModeLabel) {
    vocabReviewModeLabel.textContent = copySafe(i18n[state.language].reviewModeLabel, 'Review mode');
  }

  if (syntheticDifficultySelect) {
    const difficultyOptions = syntheticDifficultySelect.querySelectorAll('option');
    if (!difficultyOptions.length) {
      SYNTHETIC_DIFFICULTIES.forEach((difficulty) => {
        const option = document.createElement('option');
        option.value = difficulty;
        option.textContent = difficulty;
        syntheticDifficultySelect.appendChild(option);
      });
    }
  }

  if (syntheticCategorySelect) {
    const hasCategoryOptions = syntheticCategorySelect.querySelectorAll('option').length > 0;
    if (!hasCategoryOptions) {
      SYNTHETIC_CATEGORIES.forEach(({ value, copyKey }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = copySafe(i18n[state.language][copyKey], value);
        syntheticCategorySelect.appendChild(option);
      });
    }
    Array.from(syntheticCategorySelect.options).forEach((option) => {
      const item = SYNTHETIC_CATEGORIES.find((item) => item.value === option.value);
      option.textContent = item ? copySafe(i18n[state.language][item.copyKey], option.value) : option.value;
    });
  }
}

function copySafe(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return typeof fallback === 'string' ? fallback : '';
}

function setActivePage(nextPage = 'compose') {
  const next = nextPage === 'vocabulary' ? 'vocabulary' : 'compose';
  if (state.activePage === next) {
    return;
  }
  state.activePage = next;
  renderUI();
}

function renderQuestions() {
  const copy = i18n[state.language];
  questionsList.replaceChildren();

  if (!state.questions.length) {
    const empty = document.createElement('div');
    empty.className = 'questions-empty';
    empty.textContent = copy.questionsEmpty;
    questionsList.appendChild(empty);
    return;
  }

  state.questions.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'question-card';

    const selectedLabel = document.createElement('div');
    selectedLabel.className = 'question-label';
    selectedLabel.textContent = copy.questionsSelectedLabel;

    const selectedText = document.createElement('div');
    selectedText.className = 'question-text';
    selectedText.textContent = entry.selectedText || '';

    const questionLabel = document.createElement('div');
    questionLabel.className = 'question-label';
    questionLabel.textContent = copy.questionsQuestionLabel;

    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = entry.question || '';

    const answerLabel = document.createElement('div');
    answerLabel.className = 'question-label';
    answerLabel.textContent = copy.questionsAnswerLabel;

    const answerText = document.createElement('div');
    answerText.className = 'question-answer';
    answerText.textContent = entry.answer || '';

    card.appendChild(selectedLabel);
    card.appendChild(selectedText);
    card.appendChild(questionLabel);
    card.appendChild(questionText);
    card.appendChild(answerLabel);
    card.appendChild(answerText);

    questionsList.appendChild(card);
  });
}

function formatShareTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const locale = state.language === 'ja' ? 'ja-JP' : 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch (error) {
    return date.toLocaleString();
  }
}

function normalizeShareRecipientEmail(email) {
  return normalizeEmailValue(email);
}

function buildSharePayload() {
  if (!state.documentId) {
    throw new Error(i18n[state.language].workflowStartError);
  }
  const doc = state.documents.find((item) => item.id === state.documentId);
  if (!doc) {
    throw new Error(i18n[state.language].workflowStartError);
  }
  if (!hasDocumentContent(state.text, state.images)) {
    throw new Error(i18n[state.language].shareMissingText);
  }
  const hasProofread = proofreadState.status === 'success' && Boolean(proofreadState.content);
  const proofreadContent = hasProofread
    ? proofreadState.content
    : (typeof doc?.proofreadContent === 'string' ? doc.proofreadContent : '');
  const proofreadUpdatedAt = hasProofread
    ? (proofreadState.updatedAt instanceof Date ? proofreadState.updatedAt.getTime() : Date.now())
    : (Number.isFinite(doc?.proofreadUpdatedAt) ? Math.trunc(doc.proofreadUpdatedAt) : null);
  const workflow = normalizeDocumentWorkflow(doc.workflow);
  const payload = {
    id: state.documentId,
    title: state.title,
    text: state.text,
    images: normalizeDocumentImages(state.images),
    correctionsBaseText: normalizeCorrectionsBaseText(state.correctionsBaseText, state.text),
    vocab: normalizeVocabEntries(state.vocab),
    questions: normalizeQuestionEntries(state.questions),
    proofreadContent,
    proofreadUpdatedAt,
    workflow,
    updatedAt: Date.now()
  };
  if (Number.isFinite(doc?.createdAt)) {
    payload.createdAt = Math.trunc(doc.createdAt);
  }
  return payload;
}

function getWorkflowRoleLabel(copy, role) {
  if (role === 'student') {
    return copy.workflowRoleStudent;
  }
  if (role === 'teacher') {
    return copy.workflowRoleTeacher;
  }
  return '-';
}

function isTeacherWorkflowWorkflow(workflow) {
  const normalized = normalizeDocumentWorkflow(workflow);
  return normalized?.role === 'teacher';
}

function canUseCorrectionsMode() {
  return isTeacherWorkflowWorkflow(state.workflow);
}

function enforceWorkflowModeRules() {
  const workflow = normalizeDocumentWorkflow(state.workflow);
  if (!workflow) {
    if (state.mode === 'corrections') {
      state.mode = 'read';
    }
    return;
  }
  if (workflow.role === 'teacher' && state.mode === 'edit') {
    state.mode = 'read';
    return;
  }
  if (workflow.role === 'student' && state.mode === 'corrections') {
    state.mode = 'read';
  }
}

function getWorkflowStatusLabel(copy, status) {
  if (status === 'submitted') {
    return copy.workflowStatusSubmitted;
  }
  if (status === 'reviewed') {
    return copy.workflowStatusReviewed;
  }
  if (status === 'revision_requested') {
    return copy.workflowStatusRevisionRequested;
  }
  if (status === 'final') {
    return copy.workflowStatusFinal;
  }
  return copy.workflowStatusDraft;
}

function getWorkflowEventLabel(copy, action) {
  if (action === 'share_start' || action === 'share_update') {
    return copy.workflowEventShared;
  }
  if (action === 'submit') {
    return copy.workflowEventSubmit;
  }
  if (action === 'return_review') {
    return copy.workflowEventReturnReview;
  }
  if (action === 'mark_final') {
    return copy.workflowEventMarkFinal;
  }
  return copy.workflowEventShared;
}

function getWorkflowHint(copy, workflow) {
  if (!workflow) {
    return '';
  }
  if (workflow.status === 'final') {
    return copy.workflowHintFinal;
  }
  if (workflow.role === 'student') {
    if (workflow.status === 'submitted') {
      return copy.workflowHintSubmittedStudent;
    }
    if (workflow.status === 'revision_requested') {
      return copy.workflowHintRevisionStudent;
    }
    if (workflow.status === 'reviewed') {
      return copy.workflowHintReviewedStudent;
    }
    return '';
  }
  if (workflow.role === 'teacher') {
    if (workflow.status === 'submitted') {
      return copy.workflowHintSubmittedTeacher;
    }
    if (workflow.status === 'reviewed') {
      return copy.workflowHintReviewedTeacher;
    }
    return '';
  }
  return '';
}

function listWorkflowActions(workflow) {
  if (!workflow || !workflow.id) {
    return [];
  }
  if (workflow.status === 'final') {
    return [];
  }
  if (workflow.role === 'student') {
    const actions = [];
    if (workflow.status !== 'submitted') {
      actions.push({ action: 'submit', primary: true });
    }
    if (workflow.status === 'reviewed') {
      actions.push({ action: 'mark_final', primary: false });
    }
    return actions;
  }
  if (workflow.role === 'teacher') {
    return [
      { action: 'return_review', primary: true }
    ];
  }
  return [];
}

function getWorkflowActionLabel(copy, action) {
  if (action === 'submit') {
    return copy.workflowActionSubmit;
  }
  if (action === 'return_review') {
    return copy.workflowActionReturnReview;
  }
  if (action === 'mark_final') {
    return copy.workflowActionMarkFinal;
  }
  return action;
}

function getWorkflowActorLabel(copy, event) {
  const email = normalizeEmailValue(event?.actorEmail);
  if (email) {
    return email;
  }
  if (typeof event?.actorName === 'string' && event.actorName.trim()) {
    return event.actorName.trim();
  }
  return copy.workflowActorUnknown;
}

function getWorkflowEventActorDisplay(copy, event) {
  const email = normalizeEmailValue(event?.actorEmail);
  if (email) {
    return email;
  }
  return getWorkflowActorLabel(copy, event);
}

function getWorkflowEventTargetEmail(workflow, event) {
  const ownerEmail = normalizeEmailValue(workflow?.ownerEmail);
  const partnerEmail = normalizeEmailValue(workflow?.partnerEmail);
  const actorEmail = normalizeEmailValue(event?.actorEmail);
  if (!ownerEmail && !partnerEmail) {
    return '';
  }
  if (actorEmail) {
    if (ownerEmail && actorEmail === ownerEmail) {
      return partnerEmail;
    }
    if (partnerEmail && actorEmail === partnerEmail) {
      return ownerEmail;
    }
  }
  return partnerEmail || ownerEmail;
}

function getWorkflowEventTitle(copy, workflow, event) {
  const actor = getWorkflowEventActorDisplay(copy, event);
  const action = getWorkflowEventLabel(copy, event?.action);
  const status = getWorkflowStatusLabel(copy, event?.status);
  const targetEmail = getWorkflowEventTargetEmail(workflow, event);
  if (targetEmail && event?.action !== 'mark_final') {
    return `${actor} ${action} ${copy.workflowEventTo} ${targetEmail} · ${status}`;
  }
  return `${actor} ${action} · ${status}`;
}

function mergeDocumentFromServer(documentPayload) {
  const normalized = normalizeDocumentEntries([documentPayload])[0];
  if (!normalized) {
    return null;
  }
  const index = state.documents.findIndex((doc) => doc.id === normalized.id);
  if (index === -1) {
    state.documents.unshift(normalized);
  } else {
    state.documents[index] = normalized;
  }
  if (state.documents.length > 1) {
    state.documents.sort((a, b) => {
      const left = Number.isFinite(a?.createdAt) ? a.createdAt : 0;
      const right = Number.isFinite(b?.createdAt) ? b.createdAt : 0;
      return right - left;
    });
  }
  if (state.documentId === normalized.id) {
    applyDocumentToState(normalized);
    if (documentTitleInput && documentTitleInput.value !== state.title) {
      documentTitleInput.value = state.title;
    }
    composerInput.value = state.text;
    renderPreview();
    renderImageGallery();
    renderCorrections();
    renderVocab();
    renderQuestions();
    hydrateProofreadFromDocument(normalized, { reset: false });
    hydrateShareFromDocument(normalized);
    renderUI();
  }
  saveDocumentsToStorage({ syncServer: false });
  if (authState.authenticated) {
    clearWorkspaceSyncQueue();
    scheduleWorkspaceSync({ immediate: true });
  }
  renderDocumentList();
  return normalized;
}

async function handleWorkflowTransition(action) {
  const copy = i18n[state.language];
  if (!WORKFLOW_TRANSITION_ACTIONS.has(action)) {
    return;
  }
  if (!authState.authenticated) {
    shareState.error = copy.shareRequiresAuth;
    shareState.message = '';
    renderSharePanel();
    return;
  }
  const activeDocument = getActiveDocumentFromState();
  const workflow = normalizeDocumentWorkflow(activeDocument?.workflow || state.workflow);
  if (!workflow || !workflow.id) {
    shareState.error = copy.workflowStartError;
    shareState.message = '';
    renderSharePanel();
    return;
  }
  shareState.sending = true;
  shareState.error = '';
  shareState.message = '';
  renderSharePanel();
  try {
    const result = await requestWorkflowTransition(action, buildSharePayload());
    if (result?.document) {
      mergeDocumentFromServer(result.document);
    }
    await refreshWorkspaceFromServer().catch(() => {});
    shareState.message = copy.workflowTransitionSuccess;
    shareState.error = '';
    shareState.lastSharedAt = new Date();
  } catch (error) {
    shareState.error = error?.message || copy.workflowTransitionError;
    shareState.message = '';
  } finally {
    shareState.sending = false;
    renderSharePanel();
  }
}

function renderSharePanel() {
  const copy = i18n[state.language];
  const activeDocument = getActiveDocumentFromState();
  const workflow = normalizeDocumentWorkflow(activeDocument?.workflow ?? null);
  const hasWorkflow = Boolean(workflow?.id);
  const isTeacherWorkflowRole = workflow?.role === 'teacher';
  const hasSharedOrigin = Boolean(
    activeDocument?.workflow
    || activeDocument?.sharedByUserId
    || activeDocument?.sharedByEmail
    || activeDocument?.sharedSourceId
  );
  const showShareForm = !hasSharedOrigin && !isTeacherWorkflowRole;
  shareTitle.textContent = hasWorkflow ? copy.workflowPanelTitle : copy.shareTitle;
  shareSubtitle.textContent = hasWorkflow ? copy.workflowPanelSubtitle : copy.shareSubtitle;
  shareUserLabel.textContent = copy.shareUserLabel;
  setElementText(shareSend, copy.shareSend);
  shareSend.hidden = isTeacherWorkflowRole;
  shareUserEmailInput.placeholder = copy.shareUserPlaceholder;
  shareUserEmailInput.disabled = !authState.authenticated || shareState.sending || !showShareForm;
  shareSend.disabled = !authState.authenticated || shareState.sending || !showShareForm;
  if (shareForm) {
    shareForm.hidden = !showShareForm;
  }

  if (workflowCard) {
    workflowCard.hidden = !hasWorkflow;
  }
  if (workflowActions) {
    workflowActions.replaceChildren();
  }
  if (workflowHistoryList) {
    workflowHistoryList.replaceChildren();
  }
  if (hasWorkflow && workflowRoleLabel && workflowRoleValue && workflowPartnerLabel && workflowPartnerValue
    && workflowStatusLabel && workflowStatusValue && workflowUpdatedLabel && workflowUpdatedValue
    && workflowActions && workflowHistoryTitle && workflowHistoryList) {
    workflowRoleLabel.textContent = copy.workflowRoleLabel;
    workflowPartnerLabel.textContent = copy.workflowPartnerLabel;
    workflowStatusLabel.textContent = copy.workflowStatusLabel;
    workflowUpdatedLabel.textContent = copy.workflowUpdatedLabel;
    workflowHistoryTitle.textContent = copy.workflowHistoryTitle;
    workflowRoleValue.textContent = getWorkflowRoleLabel(copy, workflow.role);
    workflowPartnerValue.textContent = workflow.partnerName || workflow.partnerEmail || '-';
    workflowStatusValue.textContent = getWorkflowStatusLabel(copy, workflow.status);
    workflowUpdatedValue.textContent = Number.isFinite(workflow.lastTransitionAt)
      ? formatShareTimestamp(new Date(workflow.lastTransitionAt))
      : '-';

    listWorkflowActions(workflow).forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = entry.primary ? 'primary' : 'ghost';
      setElementText(button, getWorkflowActionLabel(copy, entry.action));
      button.disabled = !authState.authenticated || shareState.sending;
      button.addEventListener('click', () => {
        void handleWorkflowTransition(entry.action);
      });
      workflowActions.appendChild(button);
    });

    const entries = Array.isArray(workflow.events) ? workflow.events.slice(-6).reverse() : [];
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'workflow-history-empty';
      empty.textContent = copy.workflowNoHistory;
      workflowHistoryList.appendChild(empty);
    } else {
      entries.forEach((entry) => {
        const card = document.createElement('div');
        card.className = 'workflow-event';
        const title = document.createElement('div');
        title.className = 'workflow-event-title';
        title.textContent = getWorkflowEventTitle(copy, workflow, entry);
        const meta = document.createElement('div');
        meta.className = 'workflow-event-meta';
        const actor = getWorkflowActorLabel(copy, entry);
        const timestamp = Number.isFinite(entry.createdAt)
          ? formatShareTimestamp(new Date(entry.createdAt))
          : '';
        meta.textContent = timestamp ? `${actor} · ${timestamp}` : actor;
        card.appendChild(title);
        card.appendChild(meta);
        workflowHistoryList.appendChild(card);
      });
    }
  } else if (workflowRoleValue && workflowPartnerValue && workflowStatusValue && workflowUpdatedValue) {
    workflowRoleValue.textContent = '-';
    workflowPartnerValue.textContent = '-';
    workflowStatusValue.textContent = '-';
    workflowUpdatedValue.textContent = '-';
  }

  let statusText = shareState.error || shareState.message || '';
  if (!statusText && !authState.authenticated) {
    statusText = copy.shareRequiresAuth;
  }
  if (!statusText && hasWorkflow) {
    statusText = getWorkflowHint(copy, workflow);
  }
  if (!hasWorkflow && workflowHistoryList && !workflowHistoryList.children.length) {
    const empty = document.createElement('div');
    empty.className = 'workflow-history-empty';
    empty.textContent = copy.workflowNoHistory;
    workflowHistoryList.appendChild(empty);
  }
  if (!statusText && shareState.lastSharedAt instanceof Date) {
    const formatted = formatShareTimestamp(shareState.lastSharedAt);
    statusText = formatted ? `${copy.shareSuccess} ${formatted}` : copy.shareSuccess;
  }
  shareStatus.textContent = statusText;
}

async function requestShareWithGoogleUser(recipientEmail, documentPayload) {
  const body = {
    recipientEmail,
    sourceDocumentId: documentPayload?.id || state.documentId || '',
    document: documentPayload
  };
  const response = await fetch(SHARE_USER_API_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    let message = i18n[state.language].shareError;
    if (data && typeof data.error === 'string' && data.error.trim()) {
      message = data.error.trim();
    } else {
      const fallback = await response.text();
      if (fallback && fallback.trim()) {
        message = fallback.trim();
      }
    }
    throw new Error(`${message}`);
  }
  return data;
}

async function requestWorkflowTransition(action, documentPayload) {
  const response = await fetch(WORKFLOW_TRANSITION_API_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      sourceDocumentId: state.documentId,
      document: documentPayload
    })
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    throw new Error(data?.error || i18n[state.language].workflowTransitionError);
  }
  return data;
}

async function safeParseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function buildDocumentLabel(doc, copy) {
  const title = typeof doc.title === 'string' ? doc.title.trim() : '';
  return title || copy.documentUntitled;
}

function formatDocumentUpdatedAt(doc, locale) {
  const timestamp = Number.isFinite(doc.createdAt) ? doc.createdAt : null;
  if (!timestamp) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(timestamp));
  } catch (error) {
    return '';
  }
}

function buildDocumentListMeta(doc, copy, locale) {
  const workflow = normalizeDocumentWorkflow(doc.workflow);
  const workflowStatus = workflow ? getWorkflowStatusLabel(copy, workflow.status) : '';
  const createdAt = formatDocumentUpdatedAt(doc, locale);
  const parts = [];
  if (workflowStatus) {
    parts.push(workflowStatus);
  }
  if (createdAt) {
    const createdLabel = copy.documentCreatedLabel || 'Created:';
    parts.push(`${createdLabel} ${createdAt}`);
  }
  return parts.join(' · ');
}

function buildDocumentListRow(doc, copy, locale) {
  const title = buildDocumentLabel(doc, copy);
  const row = document.createElement('div');
  row.className = 'document-row';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.documentId = doc.id;
  row.setAttribute('aria-label', `${copy.documentDrawerTitle}: ${title}`);
  const isActive = doc.id === state.documentId;
  row.setAttribute('aria-current', isActive ? 'true' : 'false');
  row.classList.toggle('is-active', isActive);

  const content = document.createElement('div');
  content.className = 'document-row-content';

  const titleElement = document.createElement('div');
  titleElement.className = 'document-row-title';
  titleElement.textContent = title;
  titleElement.title = title;

  const meta = document.createElement('div');
  meta.className = 'document-row-meta';
  meta.textContent = buildDocumentListMeta(doc, copy, locale);

  content.appendChild(titleElement);
  content.appendChild(meta);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'document-row-delete';
  deleteButton.setAttribute('aria-label', `${copy.documentDelete}: ${title}`);
  deleteButton.setAttribute('title', copy.documentDelete);
  deleteButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l1 2h4v2h-1.2l-1.1 13.2a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8L5.2 7H4V5h4l1-2zm-1.6 4 1 12.1c.1.2.2.4.5.4h6.2c.3 0 .4-.2.5-.4L16.6 7H7.4zm3 2h2v8h-2V9zm-3 0h2v8h-2V9zm8 0h2v8h-2V9z"/>
    </svg>
  `;

  row.appendChild(content);
  row.appendChild(deleteButton);

  row.addEventListener('click', () => {
    if (doc.id === state.documentId) {
      return;
    }
    const nextDocument = state.documents.find((entry) => entry.id === doc.id);
    if (nextDocument) {
      setActiveDocument(nextDocument);
    }
  });

  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    row.click();
  });

  deleteButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const confirmMessage = i18n[state.language].documentDeleteConfirm;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    deleteDocumentById(doc.id);
  });

  return row;
}

function isSharedDocumentListEntry(doc) {
  const workflow = normalizeDocumentWorkflow(doc?.workflow ?? null);
  if (workflow?.role === 'teacher') {
    return true;
  }
  if (workflow?.role === 'student') {
    return false;
  }
  return Boolean(
    (typeof doc?.sharedByUserId === 'string' && doc.sharedByUserId.trim())
    || normalizeEmailValue(doc?.sharedByEmail)
  );
}

function buildDocumentListSection(title, items, emptyText, copy, locale) {
  const section = document.createElement('section');
  section.className = 'document-list-section';

  const heading = document.createElement('h3');
  heading.className = 'document-list-section-title';
  heading.textContent = title;

  const content = document.createElement('div');
  content.className = 'document-list-section-items';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'document-list-empty';
    empty.textContent = emptyText;
    content.appendChild(empty);
  } else {
    items.forEach((doc) => {
      content.appendChild(buildDocumentListRow(doc, copy, locale));
    });
  }

  section.appendChild(heading);
  section.appendChild(content);
  return section;
}

function renderDocumentList() {
  if (!documentsList) {
    return;
  }
  const copy = i18n[state.language];
  const locale = state.language === 'ja' ? 'ja-JP' : 'en-US';
  documentsList.replaceChildren();

  const authoredDocuments = [];
  const sharedDocuments = [];
  state.documents.forEach((doc) => {
    if (isSharedDocumentListEntry(doc)) {
      sharedDocuments.push(doc);
      return;
    }
    authoredDocuments.push(doc);
  });

  documentsList.appendChild(
    buildDocumentListSection(
      copy.documentOwnedSectionTitle || 'Your documents',
      authoredDocuments,
      copy.documentListEmpty,
      copy,
      locale
    )
  );
  documentsList.appendChild(
    buildDocumentListSection(
      copy.documentSharedSectionTitle || 'Shared with you',
      sharedDocuments,
      copy.documentSharedEmpty || copy.documentListEmpty,
      copy,
      locale
    )
  );
  renderVocabularyPage();
}

function renderDocumentControls() {
  const copy = i18n[state.language];
  if (documentTitleLabel) {
    documentTitleLabel.textContent = copy.documentTitleLabel;
  }
  if (documentsDrawerTitle) {
    documentsDrawerTitle.textContent = copy.documentDrawerTitle;
  }
  if (documentsDrawerSubtitle) {
    documentsDrawerSubtitle.textContent = copy.documentDrawerSubtitle;
  }
  if (documentTitleInput) {
    documentTitleInput.placeholder = copy.documentTitlePlaceholder;
    if (documentTitleInput.value !== state.title) {
      documentTitleInput.value = state.title;
    }
    documentTitleInput.readOnly = isActiveDocumentSavedState();
    documentTitleInput.classList.toggle('is-read-only', isActiveDocumentSavedState());
  }
  if (documentSave) {
    setElementText(documentSave, isActiveDocumentSavedState() ? copy.documentSaved : copy.documentSave);
    documentSave.disabled = isActiveDocumentSavedState();
  }
  if (documentNew) {
    setElementText(documentNew, copy.documentNew);
  }
  renderDocumentList();
}

function buildVocabCell(text) {
  const cell = document.createElement('div');
  cell.className = 'vocab-cell';
  cell.textContent = text;
  return cell;
}

function syncPanelToggle(panel, body, button, copy) {
  if (!panel || !body || !button) {
    return;
  }
  const isCollapsed = panel.classList.contains('is-collapsed');
  const nextLabel = isCollapsed ? copy.expand : copy.collapse;
  body.setAttribute('aria-hidden', String(isCollapsed));
  button.setAttribute('aria-expanded', String(!isCollapsed));
  button.setAttribute('aria-label', nextLabel);
  button.setAttribute('title', nextLabel);
  setElementText(button, nextLabel);
}

function setPanelCollapsed(panel, body, button, collapsed) {
  if (!panel || !body || !button) {
    return;
  }
  panel.classList.toggle('is-collapsed', collapsed);
  if (panel === documentsDrawer && app) {
    app.classList.toggle('document-drawer-collapsed', collapsed);
  }
  syncPanelToggle(panel, body, button, i18n[state.language]);
}

function renderUI() {
  const copy = i18n[state.language];
  enforceWorkflowModeRules();
  const isTeacherWorkflow = isTeacherWorkflowWorkflow(state.workflow);
  const canUseCorrections = canUseCorrectionsMode();
  const isReadingMode = state.mode === 'read';
  const isCorrectionsMode = state.mode === 'corrections' && canUseCorrections;

  document.documentElement.lang = state.language;

  app.classList.toggle('furigana-off', !state.showFurigana);
  app.classList.toggle('reading-mode', isReadingMode);
  app.classList.toggle('corrections-mode', isCorrectionsMode);

  setElementText(languageToggle, copy.languageToggle);
  languageToggle.setAttribute('aria-pressed', state.language === 'ja');

  if (state.mode === 'read') {
    setElementText(modeToggle, copy.modeRead);
  } else if (state.mode === 'corrections' && canUseCorrections) {
    setElementText(modeToggle, copy.modeCorrections);
  } else {
    setElementText(modeToggle, copy.modeEdit);
  }
  modeToggle.setAttribute('aria-pressed', String(state.mode !== 'edit'));

  setElementText(furiganaToggle, state.showFurigana ? copy.furiganaOn : copy.furiganaOff);
  furiganaToggle.setAttribute('aria-pressed', state.showFurigana);

  setElementText(vocabToggle, state.showVocab ? copy.vocabOn : copy.vocabOff);
  vocabToggle.setAttribute('aria-pressed', state.showVocab);

  vocabPanel.style.display = state.showVocab ? 'flex' : 'none';
  syncPanelToggle(vocabPanel, vocabBody, vocabCollapse, copy);
  syncPanelToggle(questionsPanel, questionsBody, questionsCollapse, copy);
  syncPanelToggle(sharePanel, shareBody, shareCollapse, copy);
  syncPanelToggle(documentsDrawer, documentsDrawerBody, documentsDrawerToggle, copy);
  setElementText(clearVocab, copy.clear);
  setElementText(tooltipAdd, copy.addToVocab);
  selectionTitle.textContent = copy.selectionTitle;
  setElementText(selectionTranslate, copy.selectionTranslate);
  if (selectionAddToVocab) {
    setElementText(selectionAddToVocab, copy.selectionAddToVocab);
  }
  setElementText(selectionCopy, copy.selectionCopy);
  setElementText(selectionAsk, copy.selectionAsk);
  setElementText(selectionAskSubmit, copy.selectionAskSubmit);
  selectionAskLabel.textContent = copy.selectionAskLabel;
  selectionAskInput.placeholder = copy.selectionAskPlaceholder;

  document.querySelector('#app-title').textContent = copy.appTitle;
  document.querySelector('#app-subtitle').textContent = copy.appSubtitle;
  document.querySelector('#editor-title').textContent = copy.editorTitle;
  document.querySelector('#editor-subtitle').textContent = copy.editorSubtitle;
  document.querySelector('#vocab-title').textContent = copy.vocabTitle;
  document.querySelector('#vocab-subtitle').textContent = copy.vocabSubtitle;
  questionsTitle.textContent = copy.questionsTitle;
  questionsSubtitle.textContent = copy.questionsSubtitle;
  composerInput.placeholder = copy.editorPlaceholder;
  composerInput.readOnly = state.mode === 'read' || (isTeacherWorkflow && state.mode === 'edit');
  if (correctionsPanel) {
    correctionsPanel.hidden = !isCorrectionsMode;
  }

  renderDocumentControls();
  renderImageGallery();
  renderCorrections();
  renderProofread();
  renderSharePanel();
  renderAuthControls();
  renderPageView();
  renderVocab();
  renderVocabularyPage();
}

function schedulePreviewRender() {
  if (pendingRender) {
    return;
  }
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    renderPreview();
  });
}

function scheduleCorrectionsRender() {
  if (pendingCorrectionsRender) {
    return;
  }
  pendingCorrectionsRender = true;
  requestAnimationFrame(() => {
    pendingCorrectionsRender = false;
    renderCorrections();
  });
}

function addToVocab(entry) {
  const exists = state.vocab.some((item) => item.word === entry.word && item.reading === entry.reading);
  if (exists) {
    return false;
  }
  state.vocab.unshift({
    word: entry.word,
    reading: entry.reading,
    meaning: entry.meaning,
    addedAt: Date.now()
  });
  saveVocab();
  renderVocab();
  return true;
}

function normalizeSelectionVocabEntry(entry, fallbackText = '') {
  const fallbackRaw = typeof fallbackText === 'string' ? fallbackText.trim() : '';
  const fallbackWord = normalizeLookupWord(fallbackRaw) || fallbackRaw;
  if (!entry || typeof entry !== 'object') {
    if (!fallbackWord) {
      return null;
    }
    return {
      word: fallbackWord,
      reading: !hasKanji(fallbackWord) && hasKana(fallbackWord) ? fallbackWord : '',
      meaning: ''
    };
  }

  const word = typeof entry.word === 'string' && entry.word.trim()
    ? entry.word.trim()
    : fallbackWord;
  let reading = typeof entry.reading === 'string' ? entry.reading.trim() : '';
  if (!reading && word && !hasKanji(word) && hasKana(word)) {
    reading = word;
  }
  const meaning = typeof entry.meaning === 'string' ? entry.meaning.trim() : '';

  if (!word && !reading && !meaning) {
    return null;
  }

  return { word, reading, meaning };
}

function isInformativeSelectionVocabEntry(entry, fallbackText = '') {
  const normalized = normalizeSelectionVocabEntry(entry, fallbackText);
  if (!normalized) {
    return false;
  }
  const fallbackRaw = typeof fallbackText === 'string' ? fallbackText.trim() : '';
  const fallbackWord = normalizeLookupWord(fallbackRaw) || fallbackRaw;
  return Boolean(
    normalized.meaning
    || (normalized.reading && normalized.reading !== fallbackWord)
    || (normalized.word && normalized.word !== fallbackWord)
  );
}

async function requestSelectionVocabularyResolution(text, lookupTarget) {
  const response = await fetch(VOCAB_RESOLVE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      lookupTarget
    })
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    throw new Error(data?.error || 'Vocab resolution failed');
  }
  return data;
}

async function resolveSelectionVocabularyEntry(text) {
  const selectionText = typeof text === 'string' ? text.trim() : '';
  if (!selectionText) {
    return null;
  }
  const normalized = normalizeLookupWord(selectionText);
  const selectionTokens = getLineTokens(normalized).filter((token) => token && token.text && !/^\s+$/.test(token.text));
  const lookupTarget = selectionTokens.length === 1
    ? (selectionTokens[0].lookup || normalized)
    : (normalized || selectionText);
  const cacheKey = normalizeLookupWord(lookupTarget) || normalized || selectionText;
  const cached = lookupCache.get(cacheKey) || lookupCache.get(normalized);
  if (cached) {
    return normalizeSelectionVocabEntry(cached, selectionText);
  }

  if (cacheKey) {
    const entry = await lookupDictionaryEntry(cacheKey);
    if (entry) {
      lookupCache.set(cacheKey, entry);
      if (normalized && cacheKey !== normalized) {
        lookupCache.set(normalized, entry);
      }
      return entry;
    }
  }

  const resolved = await requestSelectionVocabularyResolution(selectionText, cacheKey);
  const entry = normalizeSelectionVocabEntry(resolved?.entry, selectionText);
  if (!entry) {
    return null;
  }
  if (resolved?.source && resolved.source !== 'fallback' && isInformativeSelectionVocabEntry(entry, selectionText)) {
    lookupCache.set(cacheKey, entry);
    if (normalized && cacheKey !== normalized) {
      lookupCache.set(normalized, entry);
    }
  }
  return entry;
}

function showTooltip(word, target) {
  const copy = i18n[state.language];
  const lookupKey = normalizeLookupWord(word);
  if (lookupKey && !lookupCache.has(lookupKey) && !pendingLookups.has(lookupKey)) {
    ensureLookup(lookupKey);
  }
  const info = lookupCache.get(lookupKey);
  const pending = pendingLookups.has(lookupKey);
  const surfaceWord = target.dataset.surface || word;
  const sourceReading = target.dataset.reading || '';

  const readingText = pending
    ? copy.loading
    : (sourceReading || info?.reading || '---');
  let meaningText = pending
    ? copy.loading
    : (info?.meaning || copy.missingExact);

  if (!pending && info?.meaning && info?.word && surfaceWord && info.word !== surfaceWord) {
    const dictionaryReading = info.reading ? ` (${info.reading})` : '';
    meaningText = `${copy.dictionaryFormLabel}: ${info.word}${dictionaryReading} · ${info.meaning}`;
  }

  tooltip.dataset.word = info?.word || surfaceWord;
  tooltip.dataset.reading = info?.word && info.word !== surfaceWord
    ? (info?.reading || '')
    : (sourceReading || info?.reading || '');
  tooltip.dataset.meaning = info?.meaning || '';
  tooltipAdd.disabled = pending || !info?.meaning;

  tooltipWord.textContent = surfaceWord;
  tooltipReading.textContent = readingText;
  tooltipMeaning.textContent = meaningText;

  tooltip.setAttribute('aria-hidden', 'false');

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  let left = targetRect.left + scrollX + targetRect.width / 2 - tooltipRect.width / 2;
  left = Math.max(scrollX + 12, Math.min(left, scrollX + window.innerWidth - tooltipRect.width - 12));

  let top = targetRect.bottom + scrollY + 12;
  if (top + tooltipRect.height > scrollY + window.innerHeight - 12) {
    top = targetRect.top + scrollY - tooltipRect.height - 12;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.setAttribute('aria-hidden', 'true');
}

function positionFloatingTooltip(element, x, y) {
  const tooltipRect = element.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  let left = x + scrollX - tooltipRect.width / 2;
  left = Math.max(scrollX + 12, Math.min(left, scrollX + window.innerWidth - tooltipRect.width - 12));

  let top = y + scrollY + 12;
  if (top + tooltipRect.height > scrollY + window.innerHeight - 12) {
    top = y + scrollY - tooltipRect.height - 12;
  }

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function getSelectedText() {
  const start = composerInput.selectionStart ?? 0;
  const end = composerInput.selectionEnd ?? 0;
  if (start === end) {
    return '';
  }
  return composerInput.value.slice(start, end);
}

function resetSelectionAsk() {
  selectionAskInput.value = '';
  selectionAskInput.disabled = false;
  selectionAskSubmit.disabled = false;
  selectionTooltip.classList.remove('ask-open');
}

function showSelectionTooltip(text, point) {
  selectionTooltip.dataset.text = text;
  selectionResult.replaceChildren();
  selectionTooltip.classList.remove('expanded');
  resetSelectionAsk();
  selectionTooltip.setAttribute('aria-hidden', 'false');

  const rect = composerInput.getBoundingClientRect();
  const x = point?.x ?? (rect.left + rect.width / 2);
  const y = point?.y ?? rect.top;
  positionFloatingTooltip(selectionTooltip, x, y);
}

function hideSelectionTooltip() {
  selectionTooltip.setAttribute('aria-hidden', 'true');
  selectionTooltip.classList.remove('expanded');
  resetSelectionAsk();
}

function maybeUpdateSelectionTooltip(point) {
  if (state.mode === 'read') {
    hideSelectionTooltip();
    return;
  }
  const text = getSelectedText().trim();
  if (!text) {
    hideSelectionTooltip();
    return;
  }
  showSelectionTooltip(text, point);
}

async function requestTranslation(text) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    throw new Error('Translation failed');
  }
  return response.json();
}

async function requestProofread(text) {
  const response = await fetch('/api/proofread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = data?.error || 'Proofreading failed';
    throw new Error(message);
  }
  return data;
}

async function requestAsk(text, question) {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, question })
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = data?.error || 'Question failed';
    throw new Error(message);
  }
  return data;
}

async function requestSyntheticDocument(payload) {
  const response = await fetch(SYNTHETIC_DOCUMENT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = data?.error || 'Synthetic document generation failed';
    throw new Error(message);
  }
  return data;
}

function formatProofreadTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const locale = state.language === 'ja' ? 'ja-JP' : 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch (error) {
    return date.toLocaleString();
  }
}

function renderProofread() {
  const copy = i18n[state.language];

  proofreadTitle.textContent = copy.proofreadTitle;
  proofreadSubtitle.textContent = copy.proofreadSubtitle;
  setElementText(proofreadButton, copy.proofreadButton);

  const hasText = Boolean(state.text.trim());
  const isLoading = proofreadState.status === 'loading';
  proofreadButton.disabled = isLoading || !hasText;
  proofreadButton.setAttribute('aria-busy', isLoading);

  proofreadResult.classList.remove('is-empty', 'is-loading', 'is-error', 'markdown');

  if (proofreadState.status === 'loading') {
    proofreadResult.textContent = copy.proofreadLoading;
    proofreadResult.classList.add('is-loading');
  } else if (proofreadState.status === 'error') {
    proofreadResult.textContent = proofreadState.error || copy.proofreadError;
    proofreadResult.classList.add('is-error');
  } else if (proofreadState.status === 'success') {
    if (!proofreadState.content) {
      proofreadResult.textContent = copy.proofreadEmpty;
      proofreadResult.classList.add('is-empty');
    } else {
      proofreadResult.classList.add('markdown');
      renderMarkdown(proofreadResult, proofreadState.content);
    }
  } else {
    proofreadResult.textContent = copy.proofreadEmpty;
    proofreadResult.classList.add('is-empty');
  }

  if (proofreadState.status === 'success' && proofreadState.updatedAt) {
    const timestamp = formatProofreadTimestamp(proofreadState.updatedAt);
    proofreadMeta.textContent = timestamp
      ? `${copy.proofreadUpdated}: ${timestamp}`
      : '';
  } else {
    proofreadMeta.textContent = '';
  }
}

function setProofreadState(next) {
  Object.assign(proofreadState, next);
  if (proofreadState.status === 'success' && proofreadState.content) {
    persistActiveDocument();
  }
  renderProofread();
}

function setSyntheticDocumentState(next) {
  Object.assign(syntheticDocumentState, next);
  renderSyntheticGeneratorPanel();
}

async function generateSyntheticDocument() {
  const copy = i18n[state.language];
  const selectedEntries = getSelectedSyntheticEntries();
  if (!selectedEntries.length) {
    setSyntheticDocumentState({
      status: 'error',
      text: '',
      error: copy.syntheticNoSelection
    });
    return;
  }

  setSyntheticDocumentState({
    status: 'loading',
    text: '',
    error: ''
  });

  try {
    const result = await requestSyntheticDocument(buildSyntheticDocumentPayload(selectedEntries));
    const generatedText = typeof result?.output === 'string'
      ? result.output.trim()
      : (typeof result?.text === 'string' ? result.text.trim() : '');
    const sanitizedText = sanitizeSyntheticText(generatedText);
    if (!sanitizedText) {
      throw new Error(copy.syntheticInvalidResponse);
    }
    setSyntheticDocumentState({
      status: 'success',
      text: sanitizedText,
      error: ''
    });
  } catch (error) {
    setSyntheticDocumentState({
      status: 'error',
      text: '',
      error: error?.message || copy.syntheticRequestError
    });
  }
}

function setActiveHover(base) {
  if (activeHoverBase && activeHoverBase !== base) {
    activeHoverBase.classList.remove('word-hover');
  }
  activeHoverBase = base;
  if (activeHoverBase) {
    activeHoverBase.classList.add('word-hover');
  }
}

function clearActiveHover() {
  if (activeHoverBase) {
    activeHoverBase.classList.remove('word-hover');
    activeHoverBase = null;
  }
}

function startGoogleAuthFlow() {
  if (!authState.enabled) {
    return;
  }
  window.location.assign(AUTH_GOOGLE_START_ENDPOINT);
}

function bindEvents() {
  pageNavCompose?.addEventListener('click', () => {
    setActivePage('compose');
  });

  pageNavVocabulary?.addEventListener('click', () => {
    setActivePage('vocabulary');
  });

  documentTitleInput?.addEventListener('input', (event) => {
    state.title = event.target.value;
    setActiveDocumentSavedState(false);
    updateDocumentSaveControls();
    persistActiveDocument({ updateList: true });
  });

  documentSave?.addEventListener('click', () => {
    persistActiveDocument({ updateList: true, markSaved: true });
  });

  documentsDrawerToggle?.addEventListener('click', () => {
    const nextCollapsed = !documentsDrawer?.classList.contains('is-collapsed');
    setPanelCollapsed(documentsDrawer, documentsDrawerBody, documentsDrawerToggle, nextCollapsed);
  });

  documentNew?.addEventListener('click', () => {
    const newDocument = createDocument();
    state.documents.unshift(newDocument);
    saveDocumentsToStorage();
    setActiveDocument(newDocument);
    documentTitleInput?.focus();
  });

  imageGalleryBrowse?.addEventListener('click', () => {
    if (imageGalleryState.status === 'loading') {
      return;
    }
    imageGalleryInput?.click();
  });

  imageDropzone?.addEventListener('click', () => {
    if (imageGalleryState.status === 'loading') {
      return;
    }
    imageGalleryInput?.click();
  });

  imageGalleryInput?.addEventListener('change', async (event) => {
    await addImagesToActiveDocument(event.target?.files);
  });

  imageDropzone?.addEventListener('dragenter', (event) => {
    event.preventDefault();
    imageGalleryState.dragActive = true;
    renderImageGallery();
  });

  imageDropzone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!imageGalleryState.dragActive) {
      imageGalleryState.dragActive = true;
      renderImageGallery();
    }
  });

  imageDropzone?.addEventListener('dragleave', (event) => {
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && imageDropzone.contains(nextTarget)) {
      return;
    }
    imageGalleryState.dragActive = false;
    renderImageGallery();
  });

  imageDropzone?.addEventListener('drop', async (event) => {
    event.preventDefault();
    imageGalleryState.dragActive = false;
    renderImageGallery();
    await addImagesToActiveDocument(event.dataTransfer?.files);
  });

  imageGalleryGrid?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const removeButton = target.closest('.image-thumb-remove');
    if (removeButton instanceof HTMLElement) {
      removeImageFromActiveDocument(removeButton.dataset.imageId || '');
      return;
    }
    const thumbButton = target.closest('.image-thumb');
    if (thumbButton instanceof HTMLElement) {
      openImageLightbox(thumbButton.dataset.imageId || '');
    }
  });

  authGoogle?.addEventListener('click', () => {
    startGoogleAuthFlow();
  });

  authGateGoogle?.addEventListener('click', () => {
    startGoogleAuthFlow();
  });

  authLogout?.addEventListener('click', async () => {
    if (!authState.authenticated) {
      return;
    }
    authLogout.disabled = true;
    try {
      await requestAuthLogout();
      if (authState.required) {
        window.location.assign('/');
        return;
      }
      authState.authenticated = false;
      authState.user = null;
      authState.syncing = false;
      authState.syncError = '';
      authState.lastSyncedAt = null;
      clearWorkspaceSyncQueue();
      stopWorkspaceRefreshLoop();
    } catch (error) {
      authState.syncError = error?.message || i18n[state.language].authSyncError;
    } finally {
      authLogout.disabled = false;
      renderAuthControls();
    }
  });

  composerInput.addEventListener('beforeinput', (event) => {
    if (state.mode === 'corrections') {
      return;
    }
    if (pendingCorrectionResetOnInput) {
      return;
    }
    if (!(event instanceof InputEvent) || !event.cancelable) {
      return;
    }
    if (!hasTrackedCorrections()) {
      return;
    }
    const copy = i18n[state.language];
    const shouldClear = window.confirm(copy.correctionsResetConfirm);
    if (!shouldClear) {
      event.preventDefault();
      return;
    }
    pendingCorrectionResetOnInput = true;
  });

  composerInput.addEventListener('input', (event) => {
    state.text = event.target.value;
    setActiveDocumentSavedState(false);
    updateDocumentSaveControls();
    if (state.mode !== 'corrections') {
      state.correctionsBaseText = state.text;
      pendingCorrectionResetOnInput = false;
    }
    saveEntry();
    schedulePreviewRender();
    if (state.mode === 'corrections') {
      scheduleCorrectionsRender();
    }
    maybeUpdateSelectionTooltip(lastSelectionPoint);
    renderProofread();
  });

  composerInput.addEventListener('pointerdown', (event) => {
    lastSelectionPoint = { x: event.clientX, y: event.clientY };
  });

  composerInput.addEventListener('pointerup', (event) => {
    lastSelectionPoint = { x: event.clientX, y: event.clientY };
    requestAnimationFrame(() => {
      maybeUpdateSelectionTooltip(lastSelectionPoint);
    });
  });

  composerInput.addEventListener('keyup', () => {
    requestAnimationFrame(() => {
      maybeUpdateSelectionTooltip(lastSelectionPoint);
    });
  });

  languageToggle.addEventListener('click', () => {
    state.language = state.language === 'en' ? 'ja' : 'en';
    renderUI();
    renderPreview();
    renderVocab();
    renderQuestions();
  });

  modeToggle.addEventListener('click', () => {
    if (isTeacherWorkflowWorkflow(state.workflow)) {
      state.mode = state.mode === 'read' ? 'corrections' : 'read';
    } else {
      state.mode = state.mode === 'read' ? 'edit' : 'read';
    }
    enforceWorkflowModeRules();

    renderUI();
    clearActiveHover();
    hideTooltip();
    hideSelectionTooltip();
  });

  furiganaToggle.addEventListener('click', () => {
    state.showFurigana = !state.showFurigana;
    renderUI();
  });

  vocabToggle.addEventListener('click', () => {
    state.showVocab = !state.showVocab;
    renderUI();
  });

  vocabCollapse.addEventListener('click', () => {
    const nextCollapsed = !vocabPanel.classList.contains('is-collapsed');
    setPanelCollapsed(vocabPanel, vocabBody, vocabCollapse, nextCollapsed);
  });

  questionsCollapse.addEventListener('click', () => {
    const nextCollapsed = !questionsPanel.classList.contains('is-collapsed');
    setPanelCollapsed(questionsPanel, questionsBody, questionsCollapse, nextCollapsed);
  });

  shareCollapse.addEventListener('click', () => {
    const nextCollapsed = !sharePanel.classList.contains('is-collapsed');
    setPanelCollapsed(sharePanel, shareBody, shareCollapse, nextCollapsed);
  });

  shareSend.addEventListener('click', async () => {
    const copy = i18n[state.language];
    if (!authState.authenticated) {
      shareState.error = copy.shareRequiresAuth;
      shareState.message = '';
      renderSharePanel();
      return;
    }
    const recipientEmail = normalizeShareRecipientEmail(shareUserEmailInput?.value || '');
    if (!recipientEmail) {
      shareState.error = copy.shareMissingEmail;
      shareState.message = '';
      renderSharePanel();
      return;
    }
    if (!hasDocumentContent(state.text, state.images)) {
      shareState.error = copy.shareMissingText;
      shareState.message = '';
      renderSharePanel();
      return;
    }
    shareState.sending = true;
    shareState.error = '';
    shareState.message = '';
    renderSharePanel();

    try {
      const result = await requestShareWithGoogleUser(recipientEmail, buildSharePayload());
      if (result?.senderDocument) {
        mergeDocumentFromServer(result.senderDocument);
      }
      await refreshWorkspaceFromServer().catch(() => {});
      shareState.message = copy.shareSuccess;
      shareState.error = '';
      shareState.lastSharedAt = new Date();
      if (shareUserEmailInput) {
        shareUserEmailInput.value = '';
      }
    } catch (error) {
      shareState.error = error?.message || copy.shareError;
      shareState.message = '';
    } finally {
      shareState.sending = false;
      renderSharePanel();
    }
  });

  clearVocab.addEventListener('click', () => {
    if (!state.vocab.length) {
      return;
    }
    const confirmMessage = state.language === 'ja'
      ? '語彙リストを削除しますか？'
      : 'Clear the vocabulary list?';
    if (window.confirm(confirmMessage)) {
      state.vocab = [];
      saveVocab();
      renderVocab();
    }
  });

  proofreadButton.addEventListener('click', async () => {
    const copy = i18n[state.language];
    const text = composerInput.value.trim();
    if (!text) {
      setProofreadState({
        status: 'error',
        error: copy.proofreadMissing
      });
      return;
    }

    setProofreadState({
      status: 'loading',
      content: '',
      error: '',
      updatedAt: null
    });

    try {
      const result = await requestProofread(text);
      const output = typeof result?.output === 'string' ? result.output.trim() : '';
      if (!output) {
        throw new Error(copy.proofreadError);
      }
      setProofreadState({
        status: 'success',
        content: output,
        error: '',
        updatedAt: new Date()
      });
    } catch (error) {
      setProofreadState({
        status: 'error',
        error: error?.message || copy.proofreadError,
        updatedAt: null
      });
    }
  });

  syntheticDifficultySelect?.addEventListener('change', () => {
    const difficulty = syntheticDifficultySelect.value;
    if (SYNTHETIC_DIFFICULTIES.includes(difficulty)) {
      syntheticDocumentState.difficulty = difficulty;
      renderSyntheticGeneratorPanel();
    }
  });

  syntheticCategorySelect?.addEventListener('change', () => {
    const category = syntheticCategorySelect.value;
    const isValid = SYNTHETIC_CATEGORIES.some((item) => item.value === category);
    if (isValid) {
      syntheticDocumentState.category = category;
      renderSyntheticGeneratorPanel();
    }
  });

  syntheticGenerateButton?.addEventListener('click', () => {
    generateSyntheticDocument();
  });

  vocabReviewModeSelect?.addEventListener('change', () => {
    const mode = vocabReviewModeSelect.value;
    const nextMode = mode === FLASHCARD_MODES.flashcard ? FLASHCARD_MODES.flashcard : FLASHCARD_MODES.synthetic;
    setFlashcardMode(nextMode);
  });

  flashcardStart?.addEventListener('click', () => {
    startFlashcardReview();
  });

  flashcardExit?.addEventListener('click', () => {
    finalizeFlashcardReview();
  });

  flashcardAnswerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!flashcardAnswer) {
      return;
    }
    const value = flashcardAnswer.value.trim();
    handleFlashcardAnswerSubmission(value);
    flashcardAnswer.value = '';
  });

  preview.addEventListener('pointerover', (event) => {
    if (state.mode !== 'read') {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const kanjiTarget = target.classList.contains('kanji')
      ? target
      : target.closest('.kanji');
    if (!(kanjiTarget instanceof HTMLElement)) {
      return;
    }
    const word = kanjiTarget.dataset.word;
    if (!word) {
      return;
    }
    const base = kanjiTarget.closest('.token-base');
    if (base instanceof HTMLElement) {
      setActiveHover(base);
    }
    showTooltip(word, kanjiTarget);
  });

  preview.addEventListener('pointerout', (event) => {
    if (state.mode !== 'read') {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const kanjiTarget = target.classList.contains('kanji')
      ? target
      : target.closest('.kanji');
    if (!(kanjiTarget instanceof HTMLElement)) {
      return;
    }
    const base = kanjiTarget.closest('.token-base');
    const related = event.relatedTarget;
    if (related instanceof HTMLElement) {
      if (tooltip.contains(related)) {
        return;
      }
      if (base instanceof HTMLElement && base.contains(related)) {
        return;
      }
    }
    clearActiveHover();
  });

  preview.addEventListener('pointerleave', (event) => {
    const related = event.relatedTarget;
    if (related instanceof HTMLElement && tooltip.contains(related)) {
      return;
    }
    clearActiveHover();
  });

  tooltipAdd.addEventListener('click', () => {
    const word = tooltip.dataset.word;
    if (!word) {
      return;
    }
    addToVocab({
      word,
      reading: tooltip.dataset.reading || '',
      meaning: tooltip.dataset.meaning || ''
    });
  });

  if (selectionAddToVocab) {
    selectionAddToVocab.addEventListener('click', async () => {
      const copy = i18n[state.language];
      const text = selectionTooltip.dataset.text?.trim();
      if (!text) {
        return;
      }
      const originalLabel = getElementText(selectionAddToVocab);
      const status = document.createElement('div');
      status.className = 'selection-translation';
      status.textContent = copy.selectionAddToVocabLoading;
      selectionResult.replaceChildren(status);
      selectionTooltip.classList.add('expanded');
      selectionAddToVocab.disabled = true;
      setElementText(selectionAddToVocab, copy.selectionAddToVocabLoading);

      try {
        let entry = null;
        try {
          entry = await resolveSelectionVocabularyEntry(text);
        } catch (error) {
          entry = null;
        }
        const normalizedEntry = normalizeSelectionVocabEntry(entry, text);
        if (!normalizedEntry) {
          status.textContent = copy.selectionAddToVocabError;
          return;
        }
        const added = addToVocab(normalizedEntry);
        status.textContent = added ? copy.selectionAddToVocabSuccess : copy.selectionAddToVocabDuplicate;
      } catch (error) {
        status.textContent = copy.selectionAddToVocabError;
      } finally {
        selectionAddToVocab.disabled = false;
        setElementText(selectionAddToVocab, originalLabel || copy.selectionAddToVocab);
      }
    });
  }

  selectionTranslate.addEventListener('click', async () => {
    const copy = i18n[state.language];
    const text = selectionTooltip.dataset.text?.trim();
    if (!text) {
      return;
    }
  selectionResult.replaceChildren();
  const loading = document.createElement('div');
  loading.textContent = copy.selectionLoading;
  selectionResult.appendChild(loading);
  selectionTooltip.classList.add('expanded');
  try {
      const result = await requestTranslation(text);
      const translation = decodeHtml(result?.translation || '');
      selectionResult.replaceChildren();
      if (!translation) {
        selectionResult.textContent = copy.selectionError;
      } else {
        const translationLine = document.createElement('div');
        translationLine.className = 'selection-translation';
        translationLine.textContent = translation;
        selectionResult.appendChild(translationLine);

        if (result?.targetLanguage === 'ja') {
          const romaji = await buildRomajiForText(translation);
          if (romaji) {
            const romajiLine = document.createElement('div');
            romajiLine.className = 'selection-romaji';
            romajiLine.textContent = `${copy.selectionRomaji}: ${romaji}`;
            selectionResult.appendChild(romajiLine);
          }
        }
      }
  } catch (error) {
      selectionResult.textContent = copy.selectionError;
  }
  });

  selectionAsk.addEventListener('click', () => {
    const isOpen = selectionTooltip.classList.toggle('ask-open');
    if (isOpen) {
      selectionAskInput.focus();
    }
  });

  selectionAskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const copy = i18n[state.language];
    const text = selectionTooltip.dataset.text?.trim();
    const question = selectionAskInput.value.trim();
    if (!text) {
      return;
    }
    if (!question) {
      selectionResult.textContent = copy.selectionAskMissing;
      selectionTooltip.classList.add('expanded');
      return;
    }

    selectionResult.replaceChildren();
    const loading = document.createElement('div');
    loading.textContent = copy.selectionAskLoading;
    selectionResult.appendChild(loading);
    selectionTooltip.classList.add('expanded');
    selectionAskSubmit.disabled = true;
    selectionAskInput.disabled = true;

    try {
      const result = await requestAsk(text, question);
      const output = typeof result?.output === 'string' ? result.output.trim() : '';
      if (!output) {
        throw new Error(copy.selectionAskError);
      }
      selectionResult.textContent = output;
      state.questions.unshift({
        selectedText: text,
        question,
        answer: output,
        createdAt: Date.now()
      });
      saveQuestions();
      renderQuestions();
      selectionAskInput.value = '';
    } catch (error) {
      selectionResult.textContent = error?.message || copy.selectionAskError;
    } finally {
      selectionAskSubmit.disabled = false;
      selectionAskInput.disabled = false;
    }
  });

  selectionCopy.addEventListener('click', async () => {
    const copy = i18n[state.language];
    const text = selectionTooltip.dataset.text?.trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setElementText(selectionCopy, copy.selectionCopied);
      setTimeout(() => {
        setElementText(selectionCopy, copy.selectionCopy);
      }, 1200);
    } catch (error) {
      setElementText(selectionCopy, copy.selectionError);
      setTimeout(() => {
        setElementText(selectionCopy, copy.selectionCopy);
      }, 1200);
    }
  });

  imageLightboxClose?.addEventListener('click', () => {
    closeImageLightbox();
  });

  imageLightboxBackdrop?.addEventListener('click', () => {
    closeImageLightbox();
  });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!selectionTooltip.contains(target)) {
      hideSelectionTooltip();
    }
    if (!tooltip.contains(target)) {
      clearActiveHover();
      hideTooltip();
    }
  });

  window.addEventListener('scroll', () => {
    clearActiveHover();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    closeImageLightbox();
    clearActiveHover();
    hideTooltip();
    hideSelectionTooltip();
  });

  window.addEventListener('focus', () => {
    if (authState.authenticated) {
      runWorkspaceRefreshLoop();
      void refreshWorkspaceFromServer().catch(() => {});
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && authState.authenticated) {
      runWorkspaceRefreshLoop();
      void refreshWorkspaceFromServer().catch(() => {});
    }
  });
}

async function init() {
  authState.notice = consumeAuthResultFromUrl();
  bindEvents();
  const canRenderWorkspace = await hydrateAuthAndWorkspace();
  if (!canRenderWorkspace) {
    return;
  }
  if (!authState.authenticated && !authState.required) {
    void hydrateVocabFromApi();
  }
  void initKuromoji().then((tokenizer) => {
    if (tokenizer) {
      schedulePreviewRender();
    }
  });
}

void init();
