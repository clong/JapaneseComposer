import {
  Badge,
  Button,
  Card,
  Heading,
  Text,
  TextArea,
  TextField,
  Theme
} from '@radix-ui/themes';
import {
  BackpackIcon,
  BookmarkFilledIcon,
  BookmarkIcon,
  CameraIcon,
  ChatBubbleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClipboardCopyIcon,
  CopyIcon,
  Cross2Icon,
  DashboardIcon,
  ExitIcon,
  FilePlusIcon,
  FileTextIcon,
  GlobeIcon,
  MagicWandIcon,
  PaperPlaneIcon,
  PersonIcon,
  PlusIcon,
  ReaderIcon,
  RocketIcon,
  TrashIcon
} from '@radix-ui/react-icons';

function ActionButton({
  id,
  label,
  icon: Icon,
  className = '',
  variant = 'surface',
  size = '2',
  type = 'button',
  ...props
}) {
  return (
    <Button
      id={id}
      type={type}
      variant={variant}
      size={size}
      radius="full"
      className={className}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" className="button-icon" /> : null}
      <span data-label>{label}</span>
    </Button>
  );
}

function PanelToggleButton({
  id,
  label,
  controls,
  orientation = 'vertical'
}) {
  const isDrawer = orientation === 'horizontal';
  return (
    <Button
      className={`ghost panel-toggle ${isDrawer ? 'panel-toggle-drawer' : 'panel-toggle-section'}`}
      id={id}
      type="button"
      variant="ghost"
      aria-expanded="true"
      aria-controls={controls}
    >
      <span className="panel-toggle-icons" aria-hidden="true">
        {isDrawer ? (
          <>
            <ChevronLeftIcon className="panel-toggle-icon panel-toggle-expanded-icon" />
            <ChevronRightIcon className="panel-toggle-icon panel-toggle-collapsed-icon" />
          </>
        ) : (
          <>
            <ChevronUpIcon className="panel-toggle-icon panel-toggle-expanded-icon" />
            <ChevronDownIcon className="panel-toggle-icon panel-toggle-collapsed-icon" />
          </>
        )}
      </span>
      <span data-label>{label}</span>
    </Button>
  );
}

function PanelKicker({ icon: Icon, children }) {
  return (
    <Badge variant="soft" radius="full" className="panel-kicker">
      {Icon ? <Icon aria-hidden="true" className="badge-icon" /> : null}
      <span>{children}</span>
    </Badge>
  );
}

export function AppShell() {
  return (
    <Theme
      appearance="light"
      accentColor="orange"
      grayColor="sand"
      radius="large"
      scaling="100%"
      panelBackground="translucent"
      hasBackground={false}
    >
      <div className="app-shell">
        <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
        <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
        <div className="ambient-grid" aria-hidden="true" />

        <div className="app auth-loading" id="app">
          <header className="app-header-shell">
            <Card className="app-header">
              <div className="app-header-top">
                <div className="brand brand-hero">
                  <Heading as="h1" size="8" className="brand-title">
                    <span id="app-title">Japanese Composer</span>
                  </Heading>
                  <Text as="p" size="3" className="brand-subtitle">
                    <span id="app-subtitle">Journal workspace with furigana and vocab support</span>
                  </Text>
                </div>

                <div className="header-utility-stack">
                  <div className="controls">
                    <ActionButton
                      id="language-toggle"
                      label="日本語 UI"
                      icon={GlobeIcon}
                      variant="surface"
                      className="chip toolbar-chip"
                      aria-pressed="false"
                    />
                    <ActionButton
                      id="vocab-toggle"
                      label="Vocab: On"
                      icon={BackpackIcon}
                      variant="surface"
                      className="chip toolbar-chip"
                      aria-pressed="true"
                    />
                  </div>

                  <div className="account-controls">
                    <ActionButton
                      id="auth-google"
                      label="Sign in with Google"
                      icon={PersonIcon}
                      variant="surface"
                      className="ghost account-button"
                    />
                    <div className="account-user" id="auth-user" hidden>
                      <img className="account-avatar" id="auth-avatar" alt="" referrerPolicy="no-referrer" />
                      <span className="account-name" id="auth-name" />
                    </div>
                    <ActionButton
                      id="auth-logout"
                      label="Sign out"
                      icon={ExitIcon}
                      variant="ghost"
                      className="ghost account-button"
                      hidden
                    />
                    <div className="account-sync-status" id="auth-sync-status" />
                  </div>
                </div>
              </div>

              <div className="page-nav-shell">
                <div className="page-nav">
                  <ActionButton
                    id="page-nav-compose"
                    label="Compose"
                    icon={FileTextIcon}
                    variant="surface"
                    className="chip page-chip"
                    aria-pressed="true"
                  />
                  <ActionButton
                    id="page-nav-vocabulary"
                    label="Vocabulary"
                    icon={BookmarkFilledIcon}
                    variant="surface"
                    className="chip page-chip"
                    aria-pressed="false"
                  />
                </div>
              </div>
            </Card>
          </header>

          <section className="auth-gate" id="auth-gate" hidden>
            <Card className="auth-gate-card">
              <div className="auth-gate-eyebrow" id="auth-gate-eyebrow">Private workspace</div>
              <Heading as="h2" size="7" className="auth-gate-title">
                <span id="auth-gate-title">Sign in with Google to continue</span>
              </Heading>
              <Text as="p" size="3" className="auth-gate-message">
                <span id="auth-gate-message">Only approved Google accounts can access this application.</span>
              </Text>
              <div className="auth-gate-actions">
                <ActionButton
                  id="auth-gate-google"
                  label="Sign in with Google"
                  icon={PersonIcon}
                  variant="solid"
                  className="primary"
                  disabled
                />
              </div>
              <div className="auth-gate-status" id="auth-gate-status" role="status" aria-live="polite" />
            </Card>
          </section>

          <main className="app-main page-view compose-page is-active" id="compose-page">
            <Card className="document-drawer panel is-open" id="documents-drawer">
              <div className="panel-header panel-header-actions">
                <div className="document-drawer-header-copy">
                  <PanelKicker icon={DashboardIcon}>Workspace</PanelKicker>
                  <Heading as="h2" size="5">
                    <span id="documents-drawer-title">Saved documents</span>
                  </Heading>
                  <Text as="p" size="2" color="gray">
                    <span id="documents-drawer-subtitle">Open a saved document</span>
                  </Text>
                </div>
                <div className="panel-actions document-drawer-actions">
                  <PanelToggleButton
                    id="documents-drawer-toggle"
                    label="Collapse"
                    controls="documents-drawer-body"
                    orientation="horizontal"
                  />
                  <ActionButton
                    id="document-new"
                    label="New"
                    icon={FilePlusIcon}
                    variant="surface"
                    className="ghost"
                  />
                </div>
              </div>
              <div className="panel-body" id="documents-drawer-body">
                <div className="document-list" id="document-list" />
              </div>
            </Card>

            <Card className="panel editor-panel">
              <div className="panel-header panel-header-actions editor-heading">
                <div className="editor-heading-copy">
                  <PanelKicker icon={FileTextIcon}>Composer</PanelKicker>
                  <Heading as="h2" size="6">
                    <span id="editor-title">Composer</span>
                  </Heading>
                  <Text as="p" size="2" color="gray">
                    <span id="editor-subtitle">Write in English or Japanese — switch to Reading Mode for furigana and kanji details.</span>
                  </Text>
                </div>
                <div className="editor-toolbar">
                  <ActionButton
                    id="mode-toggle"
                    label="Mode: Edit"
                    icon={ReaderIcon}
                    variant="surface"
                    className="chip editor-chip"
                    aria-pressed="false"
                  />
                  <ActionButton
                    id="furigana-toggle"
                    label="Furigana: On"
                    icon={BookmarkIcon}
                    variant="surface"
                    className="chip editor-chip"
                    aria-pressed="true"
                  />
                </div>
              </div>

              <div className="document-bar">
                <div className="document-field">
                  <label htmlFor="document-title" id="document-title-label">Document title</label>
                  <TextField.Root
                    id="document-title"
                    size="3"
                    className="document-input"
                    placeholder="Give this entry a title..."
                  >
                    <TextField.Slot>
                      <BookmarkIcon aria-hidden="true" className="field-icon" />
                    </TextField.Slot>
                  </TextField.Root>
                </div>
                <div className="document-actions">
                  <ActionButton
                    id="document-save"
                    label="Save"
                    icon={CheckIcon}
                    variant="solid"
                    className="primary document-save-button"
                  />
                </div>
              </div>

              <div className="composer-surface">
                <TextArea
                  id="composer-input"
                  spellCheck={false}
                  className="composer-input"
                  placeholder="Write your journal entry here..."
                />
                <div id="preview" className="preview overlay-preview" aria-live="polite" />
              </div>

              <Card className="image-gallery-panel">
                <div className="image-gallery-header">
                  <div>
                    <PanelKicker icon={CameraIcon}>Reference images</PanelKicker>
                    <Heading as="h3" size="4">
                      <span id="image-gallery-title">Pictures</span>
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      <span id="image-gallery-subtitle">Drag images here or click to add them to this document.</span>
                    </Text>
                  </div>
                  <ActionButton
                    id="image-gallery-browse"
                    label="Browse"
                    icon={CameraIcon}
                    variant="surface"
                    className="ghost"
                  />
                </div>
                <input id="image-gallery-input" type="file" accept="image/*" multiple hidden />
                <Button
                  className="image-dropzone"
                  id="image-dropzone"
                  type="button"
                  variant="surface"
                  size="3"
                  aria-describedby="image-dropzone-copy image-dropzone-status"
                >
                  <CameraIcon aria-hidden="true" className="dropzone-icon" />
                  <span id="image-dropzone-copy">Drop images here or click to browse.</span>
                  <span id="image-dropzone-status" className="image-dropzone-status" aria-live="polite" />
                </Button>
                <div className="image-gallery-grid" id="image-gallery-grid" aria-live="polite" />
              </Card>

              <Card className="corrections-panel" id="corrections-panel" hidden>
                <div className="corrections-header">
                  <PanelKicker icon={MagicWandIcon}>Corrections</PanelKicker>
                  <Heading as="h3" size="4">
                    <span id="corrections-title">Tracked Changes</span>
                  </Heading>
                  <Text as="p" size="2" color="gray">
                    <span id="corrections-subtitle">Tracked edits from the original text.</span>
                  </Text>
                </div>
                <div className="corrections-list" id="corrections-list" aria-live="polite" />
              </Card>

              <Card className="proofread-panel">
                <div className="proofread-header">
                  <div>
                    <PanelKicker icon={MagicWandIcon}>OpenAI review</PanelKicker>
                    <Heading as="h3" size="4">
                      <span id="proofread-title">AI Proofreader</span>
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      <span id="proofread-subtitle">Send the full entry to OpenAI for JLPT feedback and corrections.</span>
                    </Text>
                  </div>
                  <ActionButton
                    id="proofread-button"
                    label="Proofread"
                    icon={MagicWandIcon}
                    variant="solid"
                    className="primary"
                  />
                </div>
                <div className="proofread-meta" id="proofread-meta" />
                <div className="proofread-result" id="proofread-result" aria-live="polite" />
              </Card>
            </Card>

            <aside className="side-panel">
              <Card className="panel vocab-panel" id="vocab-panel">
                <div className="panel-header panel-header-actions">
                  <div>
                    <PanelKicker icon={BookmarkFilledIcon}>Memory bank</PanelKicker>
                    <Heading as="h2" size="5">
                      <span id="vocab-title">Vocabulary</span>
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      <span id="vocab-subtitle">Saved words from your journal entry.</span>
                    </Text>
                  </div>
                  <div className="panel-actions">
                    <PanelToggleButton
                      id="vocab-collapse"
                      label="Collapse"
                      controls="vocab-body"
                    />
                    <ActionButton
                      id="clear-vocab"
                      label="Clear"
                      icon={TrashIcon}
                      variant="surface"
                      className="ghost"
                    />
                  </div>
                </div>
                <div className="panel-body" id="vocab-body">
                  <div id="vocab-list" className="vocab-list" />
                </div>
              </Card>

              <Card className="panel questions-panel" id="questions-panel">
                <div className="panel-header panel-header-actions">
                  <div>
                    <PanelKicker icon={ChatBubbleIcon}>Ask about text</PanelKicker>
                    <Heading as="h2" size="5">
                      <span id="questions-title">Questions</span>
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      <span id="questions-subtitle">Your Q&amp;A about selected text.</span>
                    </Text>
                  </div>
                  <div className="panel-actions">
                    <PanelToggleButton
                      id="questions-collapse"
                      label="Collapse"
                      controls="questions-body"
                    />
                  </div>
                </div>
                <div className="panel-body" id="questions-body">
                  <div id="questions-list" className="questions-list" />
                </div>
              </Card>

              <Card className="panel share-panel" id="share-panel">
                <div className="panel-header panel-header-actions">
                  <div>
                    <PanelKicker icon={PaperPlaneIcon}>Collaboration</PanelKicker>
                    <Heading as="h2" size="5">
                      <span id="share-title">Share with Google User</span>
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      <span id="share-subtitle">Send this entry to another signed-in user by email.</span>
                    </Text>
                  </div>
                  <div className="panel-actions">
                    <PanelToggleButton
                      id="share-collapse"
                      label="Collapse"
                      controls="share-body"
                    />
                  </div>
                </div>
                <div className="panel-body" id="share-body">
                  <div className="share-form" id="share-form">
                    <div className="share-field">
                      <label id="share-user-label" htmlFor="share-user-email">Google account email</label>
                      <TextField.Root
                        id="share-user-email"
                        size="3"
                        className="share-user-input"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="friend@gmail.com"
                      >
                        <TextField.Slot>
                          <PersonIcon aria-hidden="true" className="field-icon" />
                        </TextField.Slot>
                      </TextField.Root>
                    </div>
                    <ActionButton
                      id="share-send"
                      label="Share with user"
                      icon={PaperPlaneIcon}
                      variant="solid"
                      className="primary"
                    />
                  </div>
                  <Card className="workflow-card" id="workflow-card" hidden>
                    <div className="workflow-meta">
                      <div className="workflow-row">
                        <span className="workflow-label" id="workflow-role-label">Your role</span>
                        <span className="workflow-value" id="workflow-role-value">Student</span>
                      </div>
                      <div className="workflow-row">
                        <span className="workflow-label" id="workflow-partner-label">Partner</span>
                        <span className="workflow-value" id="workflow-partner-value">-</span>
                      </div>
                      <div className="workflow-row">
                        <span className="workflow-label" id="workflow-status-label">Status</span>
                        <span className="workflow-value" id="workflow-status-value">Draft</span>
                      </div>
                      <div className="workflow-row">
                        <span className="workflow-label" id="workflow-updated-label">Last transition</span>
                        <span className="workflow-value" id="workflow-updated-value">-</span>
                      </div>
                    </div>
                    <div className="workflow-actions" id="workflow-actions" />
                    <div className="workflow-history">
                      <div className="workflow-history-title" id="workflow-history-title">History</div>
                      <div className="workflow-history-list" id="workflow-history-list" />
                    </div>
                  </Card>
                  <div className="share-status" id="share-status" />
                </div>
              </Card>
            </aside>
          </main>

          <main className="app-main page-view vocabulary-page" id="vocabulary-page">
            <Card className="panel vocabulary-panel">
              <div className="panel-header">
                <PanelKicker icon={BookmarkFilledIcon}>Review space</PanelKicker>
                <Heading as="h2" size="6">
                  <span id="vocabulary-page-title">Vocabulary</span>
                </Heading>
                <Text as="p" size="2" color="gray">
                  <span id="vocabulary-page-subtitle">Saved words from all your posts.</span>
                </Text>
              </div>
              <div className="synthetic-generator">
                <div className="synthetic-controls">
                  <div className="synthetic-field" id="vocab-review-mode-field">
                    <label htmlFor="vocab-review-mode" id="vocab-review-mode-label">Review mode</label>
                    <div className="native-select-shell">
                      <select className="synthetic-select" id="vocab-review-mode" name="vocab-review-mode">
                        <option value="synthetic">Synthetic document</option>
                        <option value="flashcard">Flashcard review</option>
                      </select>
                    </div>
                  </div>
                  <div className="synthetic-field" id="synthetic-difficulty-field">
                    <label htmlFor="synthetic-difficulty" id="synthetic-difficulty-label">Reading difficulty</label>
                    <div className="native-select-shell">
                      <select className="synthetic-select" id="synthetic-difficulty" name="synthetic-difficulty">
                        <option value="N5">N5</option>
                        <option value="N4">N4</option>
                        <option value="N3">N3</option>
                        <option value="N2">N2</option>
                        <option value="N1">N1</option>
                      </select>
                    </div>
                  </div>
                  <div className="synthetic-field" id="synthetic-category-field">
                    <label htmlFor="synthetic-category" id="synthetic-category-label">Text category</label>
                    <div className="native-select-shell">
                      <select className="synthetic-select" id="synthetic-category" name="synthetic-category">
                        <option value="News Article">News Article</option>
                        <option value="Fiction Novel">Fiction Novel</option>
                        <option value="Technical Writing">Technical Writing</option>
                        <option value="Poetry">Poetry</option>
                        <option value="Essay">Essay</option>
                        <option value="Diary">Diary</option>
                      </select>
                    </div>
                  </div>
                  <ActionButton
                    id="synthetic-generate"
                    label="Generate"
                    icon={RocketIcon}
                    variant="solid"
                    className="primary synthetic-generate"
                  />
                </div>
                <div className="synthetic-status" id="synthetic-status" role="status" aria-live="polite" />
              </div>
              <div className="vocab-list vocabulary-list" id="all-vocab-list" />
              <div className="synthetic-result-section">
                <div className="synthetic-result-title" id="synthetic-result-title">Generated text</div>
                <div id="synthetic-result" className="synthetic-result" />
                <Card id="flashcard-review" className="flashcard-review" hidden>
                  <div className="flashcard-review-header">
                    <div>
                      <div className="flashcard-review-title" id="flashcard-review-title">Flashcard review</div>
                      <div className="flashcard-review-subtitle" id="flashcard-review-subtitle" />
                    </div>
                    <Button
                      className="flashcard-exit"
                      id="flashcard-exit"
                      type="button"
                      variant="ghost"
                      aria-label="Exit flashcard review"
                    >
                      <Cross2Icon aria-hidden="true" />
                    </Button>
                  </div>
                  <ActionButton
                    id="flashcard-start"
                    label="Start review"
                    icon={ReaderIcon}
                    variant="solid"
                    className="primary flashcard-start"
                  />
                  <div id="flashcard-card" className="flashcard-card" hidden>
                    <div className="flashcard-card-back flashcard-card-back-lower" aria-hidden="true" />
                    <div className="flashcard-card-back flashcard-card-back-upper" aria-hidden="true" />
                    <div className="flashcard-card-inner">
                      <div className="flashcard-meta-row">
                        <div className="flashcard-progress" id="flashcard-progress" />
                        <Badge id="flashcard-chip" className="flashcard-chip" radius="full" variant="soft" />
                      </div>
                      <div className="flashcard-prompt-shell">
                        <div className="flashcard-prompt-label" id="flashcard-prompt-label">Meaning</div>
                        <div className="flashcard-prompt" id="flashcard-prompt" />
                      </div>
                      <form id="flashcard-answer-form" className="flashcard-answer-form" autoComplete="off">
                        <label htmlFor="flashcard-answer" id="flashcard-answer-label" className="flashcard-answer-label">Type kana or kanji</label>
                        <div className="flashcard-answer-row">
                          <TextField.Root className="flashcard-answer-input-shell" id="flashcard-answer" type="text">
                            <TextField.Slot>
                              <ReaderIcon aria-hidden="true" className="field-icon" />
                            </TextField.Slot>
                          </TextField.Root>
                          <ActionButton
                            id="flashcard-check"
                            label="Check"
                            icon={CheckIcon}
                            type="submit"
                            variant="solid"
                            className="primary flashcard-check"
                          />
                        </div>
                      </form>
                      <div className="flashcard-feedback" id="flashcard-feedback" role="status" aria-live="polite" />
                    </div>
                  </div>
                  <div id="flashcard-summary" className="flashcard-summary" hidden />
                </Card>
              </div>
            </Card>
          </main>

          <footer className="app-footer">
            <span id="build-stamp">Build @@BUILD_TIMESTAMP@@</span>
          </footer>
        </div>

        <Card id="tooltip" className="tooltip" role="dialog" aria-hidden="true">
          <div className="tooltip-title" id="tooltip-word">---</div>
          <div className="tooltip-reading" id="tooltip-reading">---</div>
          <div className="tooltip-meaning" id="tooltip-meaning">---</div>
          <ActionButton
            id="tooltip-add"
            label="Add to vocab"
            icon={PlusIcon}
            variant="solid"
            className="primary"
          />
        </Card>

        <Card id="selection-tooltip" className="tooltip selection-tooltip" role="dialog" aria-hidden="true">
          <div className="tooltip-title" id="selection-title">Selection</div>
          <div className="selection-actions">
            <ActionButton
              id="selection-translate"
              label="Translate"
              icon={GlobeIcon}
              variant="surface"
              className="ghost"
            />
            <ActionButton
              id="selection-add-vocab"
              label="Add to vocab"
              icon={PlusIcon}
              variant="surface"
              className="ghost"
            />
            <ActionButton
              id="selection-copy"
              label="Copy"
              icon={ClipboardCopyIcon}
              variant="surface"
              className="ghost"
            />
            <ActionButton
              id="selection-ask"
              label="Ask"
              icon={ChatBubbleIcon}
              variant="surface"
              className="ghost"
            />
          </div>
          <form className="selection-ask" id="selection-ask-form">
            <label className="sr-only" id="selection-ask-label" htmlFor="selection-ask-input">Ask about selected text</label>
            <TextArea id="selection-ask-input" rows={3} placeholder="Ask a question about this text..." />
            <ActionButton
              id="selection-ask-submit"
              label="Send"
              icon={PaperPlaneIcon}
              type="submit"
              variant="solid"
              className="primary"
            />
          </form>
          <div className="selection-result" id="selection-result" />
        </Card>

        <div className="image-lightbox" id="image-lightbox" hidden aria-hidden="true">
          <div className="image-lightbox-backdrop" id="image-lightbox-backdrop" />
          <Card className="image-lightbox-dialog" role="dialog" aria-modal="true" aria-labelledby="image-lightbox-caption">
            <ActionButton
              id="image-lightbox-close"
              label="Close"
              icon={Cross2Icon}
              variant="surface"
              className="ghost image-lightbox-close"
            />
            <img className="image-lightbox-image" id="image-lightbox-image" alt="" />
            <div className="image-lightbox-caption" id="image-lightbox-caption" />
          </Card>
        </div>
      </div>
    </Theme>
  );
}
