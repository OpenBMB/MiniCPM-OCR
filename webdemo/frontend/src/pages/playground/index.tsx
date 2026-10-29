/** Playground page: composes the model entry, credentials, chat state, and document workspace. */

import { useCallback, useState } from 'react';
import { useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { confirm, useToast } from '@map/ui';
import { useAppStore } from '@map/store';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '@/hooks/useResponsive';
import { PlaygroundLayout } from './components/PlaygroundLayout';
import { PlaygroundSidebar } from './components/PlaygroundSidebar';
import type { PlaygroundSidebarHistory } from './components/PlaygroundHistoryList';
import { PlaygroundTopBar } from './components/PlaygroundTopBar';
import { ExperienceTopBar, experienceIcon } from './components/ExperienceTopBar';
import { WelcomeHero } from './components/WelcomeHero';
import { TaskCards } from './components/TaskCards';
import { ComposerSlot, KeyHint } from './components/ComposerSlot';
import { MessageList } from './components/MessageList';
import { SettingsPanel } from './components/SettingsPanel';
import { FeedbackDialog } from './components/FeedbackDialog';
import { TtsExperience } from './components/experiences/TtsExperience';
import { DuplexExperience } from './components/experiences/DuplexExperience';
import { ImageParseExperience } from './components/experiences/ImageParseExperience';
import { useChat } from './hooks/useChat';
import { usePlaygroundModel } from './hooks/usePlaygroundModel';
import { usePlaygroundParams } from './hooks/usePlaygroundParams';
import { useConversationPersistence } from './hooks/useConversationPersistence';
import { useMessageFeedback } from './hooks/useMessageFeedback';
import { allowsReasoning } from '../models/components/modelCapabilities';
import { shouldStartNewConversationOnModelChange } from './utils/modelSwitch';
import { getSendDisabledReason } from './utils/sendDisabledReason';
import {
  experienceChromeCopy,
  experiencePath,
  isDocumentExperience,
  normalizeExperience,
  resolveExperience,
  type ExperienceKey,
} from './utils/experienceRoute';
import { canUsePlaygroundWebSearch } from './utils/webSearchCapability';
import { CitationDrawer } from './components/CitationDrawer';
import { useCitationPanel } from './hooks/useCitationPanel';

/** Map from a URL experience key to a free-quota type; language models use the default language. */
const playgroundCredentialExperiences = {
  language: 'language',
  tts: 'tts',
  duplex: 'realtime',
  'image-parse': 'image-parse',
  'field-extract': 'image-parse',
} as const;

/** Compose the standalone experience page and the shared sidebar from the URL. */
export default function PlaygroundPage() {
  const { toast } = useToast();
  const { t } = useTranslation('playground');
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { experience: experienceParam } = useParams();
  const collapsed = useAppStore((s) => s.playground.sidebarCollapsed);
  const setPrefs = useAppStore((s) => s.setPlaygroundPrefs);
  // On mobile (<lg) the sidebar becomes a drawer.
  const isMobile = !useBreakpoint('lg');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [imageParseHistory, setImageParseHistory] = useState<PlaygroundSidebarHistory>();
  const [imageParseWorkspaceKey, setImageParseWorkspaceKey] = useState(0);

  // Credentials fall back independently for the experience type in the URL: when that type’s free quota is used up, switch immediately to the user’s own key.
  const credentialExperience =
    playgroundCredentialExperiences[normalizeExperience(experienceParam)];
  const model = usePlaygroundModel(credentialExperience);
  const selectedModel = model.models.find((item) => item.id === model.modelId);
  const attachmentCapabilities = selectedModel?.capabilities;
  // Reasoning display, parameter defaults, and message rendering follow the current model’s capabilities.
  const allowReasoning = allowsReasoning(
    model.models.find((m) => m.id === model.modelId)?.capabilities,
  );
  const allowWebSearch = canUsePlaygroundWebSearch(selectedModel?.capabilities);
  const { params, update, setThinkingDepth, setWebSearch, setStream, reset } = usePlaygroundParams(
    model.modelId,
    selectedModel?.capabilities,
    selectedModel?.parameter_config,
    allowWebSearch,
  );
  const chat = useChat({
    model: model.modelId,
    getSecret: model.getSecret,
    keyId: model.keyId,
    params,
    refreshCredential: model.refreshTrial,
  });

  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Citation panel: open and close, which content it belongs to, and highlight positioning are all orchestrated by useCitationPanel.
  const {
    panel: citationPanel,
    open: citationPanelOpen,
    activeUrl: activeCitationUrl,
    openPanel: openCitationPanel,
    closePanel: closeCitationPanel,
  } = useCitationPanel(chat.messages);
  // The URL stays the entry; after models load, an experience the user cannot access falls back to language chat.
  const hasTtsModels = model.ttsModels.length > 0;
  const hasRealtimeModels = model.realtimeModels.length > 0;
  const hasImageParseModels = model.imageParseModels.length > 0;
  const experience = resolveExperience(normalizeExperience(experienceParam), model.modelsLoading, {
    tts: hasTtsModels,
    duplex: hasRealtimeModels,
    'image-parse': hasImageParseModels,
  });
  const isLanguage = experience === 'language';
  const isDocument = isDocumentExperience(experience);

  const hasMessages = chat.messages.length > 0;
  // Send requires a selected model, a selected key, and a plaintext secret that is ready (so a request is not sent, and fails, before the secret finishes decrypting).
  const canSend =
    Boolean(model.modelId) && Boolean(model.keyId) && (params.webSearch || model.secretReady);
  const sendDisabledReason = getSendDisabledReason(
    {
      modelId: model.modelId,
      keysLoading: model.keysLoading,
      hasKeys: model.hasKeys,
      keyId: model.keyId,
      secretReady: model.secretReady,
      secretLoading: model.secretLoading,
      secretError: model.secretError,
      trialAvailable: model.trialAvailable,
      webSearch: params.webSearch,
    },
    t,
  );

  // Restoring a model from history is covered by resolveSelection; depend only on the stable selection function.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const restoreModel = useCallback((m: string) => model.selectModel(m), [model.selectModel]);

  // Chat history persistence (list, load, autosave, create, delete).
  const conv = useConversationPersistence({
    messages: chat.messages,
    model: model.modelId,
    ownerId: model.userId,
    ownerLoading: model.userLoading,
    setMessages: chat.setMessages,
    clear: chat.clear,
    onModelRestore: restoreModel,
  });

  // Chat feedback: thumbs-up is reported quietly, thumbs-down opens a reason dialog and then reports; local highlight still lives in chat.setFeedback.
  const feedback = useMessageFeedback({
    messages: chat.messages,
    model: model.modelId,
    conversationId: conv.activeConversationId,
    setLocalFeedback: chat.setFeedback,
  });

  // Mobile: collapse the drawer after selecting a conversation or starting a new one.
  const closeDrawer = useCallback(() => setMobileSidebarOpen(false), []);
  // Switch experience (language, speech synthesis, realtime audio and video, image parse): write it into the URL so refresh keeps it; on mobile, also collapse the drawer.
  const selectExperience = useCallback(
    (key: ExperienceKey) => {
      if (isDocumentExperience(key) && !hasImageParseModels) return;
      if (isDocumentExperience(key)) {
        setImageParseWorkspaceKey((value) => value + 1);
      }
      navigate(experiencePath(key));
      closeDrawer();
    },
    [closeDrawer, hasImageParseModels, navigate],
  );
  const selectSession = useCallback(
    (id: string) => {
      conv.selectConversation(id);
      closeDrawer();
    },
    [conv, closeDrawer],
  );
  const currentModelId = model.modelId;
  const selectModel = model.selectModel;
  const newChat = useCallback(() => {
    // When it is already a blank new chat (no messages and not yet saved), only show a notice, so a click does not feel like it did nothing.
    if (chat.messages.length === 0 && !conv.activeConversationId) {
      toast({ title: t('currentNewConversation') });
      closeDrawer();
      return;
    }
    conv.newChat();
    setInput(''); // Also clear the input, back to a clean new-chat scene.
    toast({ title: t('newConversationStarted') });
    closeDrawer();
  }, [chat.messages.length, closeDrawer, conv, t, toast]);
  // When the user switches to a different model on purpose, the model context cannot be reused. The old conversation stays in recent chats,
  // and the new model starts from a blank conversation; restoring a model from a history conversation still uses restoreModel and does not pass through here.
  const selectLanguageModel = useCallback(
    (nextModelId: string) => {
      if (
        shouldStartNewConversationOnModelChange(currentModelId, nextModelId, chat.messages.length)
      ) {
        conv.newChat();
        setInput('');
        toast({ title: t('modelChangedNewConversation') });
      }
      selectModel(nextModelId);
    },
    [chat.messages.length, conv, currentModelId, selectModel, t, toast],
  );
  // Delete confirmation: a destructive dialog confirms before the history conversation is actually deleted, so it is not removed by mistake.
  const deleteSession = useCallback(
    async (id: string) => {
      const target = conv.sessions.find((s) => s.id === id);
      const ok = await confirm({
        title: t('deleteConversationConfirmTitle'),
        description: t('deleteConversationConfirmDescription', {
          title: target?.title ?? t('unknownConversation'),
        }),
        confirmText: t('delete'),
        variant: 'destructive',
      });
      if (ok) conv.removeConversation(id);
    },
    [conv, t],
  );

  const sidebar = (
    <PlaygroundSidebar
      collapsed={!isMobile && collapsed}
      onToggle={() => setPrefs({ sidebarCollapsed: !collapsed })}
      activeExperience={experience}
      onSelectExperience={selectExperience}
      sessions={conv.sessions}
      activeSessionId={conv.activeConversationId}
      onSelectSession={selectSession}
      onDeleteSession={deleteSession}
      onNewChat={newChat}
      hasTtsModels={hasTtsModels}
      hasRealtimeModels={hasRealtimeModels}
      hasImageParseModels={hasImageParseModels}
      hasMore={conv.hasMore}
      loadingMore={conv.loadingMore}
      onLoadMore={conv.loadMore}
      imageParseHistory={
        imageParseHistory
          ? {
              ...imageParseHistory,
              onSelectSession: (id) => {
                imageParseHistory.onSelectSession(id);
                closeDrawer();
              },
              onNewChat: () => {
                imageParseHistory.onNewChat();
                closeDrawer();
              },
            }
          : undefined
      }
    />
  );

  let topBar: React.ReactNode = null;
  if (isLanguage) {
    topBar = (
      <PlaygroundTopBar
        models={model.models}
        modelsLoading={model.modelsLoading}
        modelId={model.modelId}
        onSelectModel={selectLanguageModel}
        onOpenSettings={() => setSettingsOpen(true)}
        onClear={chat.clearContext}
        canClear={hasMessages}
        showMenuButton={isMobile}
        onOpenSidebar={() => setMobileSidebarOpen(true)}
      />
    );
  } else if (!isDocument) {
    topBar = (
      <ExperienceTopBar
        title={t(experienceChromeCopy(experience).titleKey)}
        subtitle={t(experienceChromeCopy(experience).subtitleKey)}
        icon={experienceIcon(experience)}
        experience={experience}
        showMenuButton={isMobile}
        onOpenSidebar={() => setMobileSidebarOpen(true)}
      />
    );
  }

  // The language input slot is shared by the welcome state and the chat state, so Composer and the key-status row are not assembled twice.
  const composer = (
    <>
      <ComposerSlot
        input={input}
        setInput={setInput}
        params={params}
        setThinkingDepth={setThinkingDepth}
        setWebSearch={setWebSearch}
        chat={chat}
        canSend={canSend}
        disabledReason={sendDisabledReason}
        showReasoning={allowReasoning}
        webSearchAvailable={allowWebSearch}
        attachmentCapabilities={attachmentCapabilities}
      />
      <KeyHint model={model} />
    </>
  );

  // Language-model main area: either the welcome state (centered input plus task cards) or the chat state (message stream plus input at the bottom).
  function renderLanguage() {
    return hasMessages ? (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <MessageList
            messages={chat.messages}
            onRegenerate={chat.regenerate}
            onFeedback={feedback.onFeedback}
            onSwitchVersion={chat.setActiveVersion}
            loading={chat.loading}
            showReasoning={allowReasoning}
            onOpenCitations={openCitationPanel}
            openCitationsMessageId={citationPanel?.messageId}
          />
        </div>
        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto max-w-3xl">{composer}</div>
        </div>
      </div>
    ) : (
      <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-8">
        <div className="flex w-full max-w-3xl flex-col items-center gap-6">
          <WelcomeHero />
          <div className="w-full">{composer}</div>
          <TaskCards onPick={setInput} />
        </div>
      </div>
    );
  }

  // The main area is dispatched by experience: language models render the real chat area, and the other experiences each have their own page.
  function renderMain() {
    if (isLanguage) return renderLanguage();
    if (experience === 'tts') return <TtsExperience model={model} />;
    if (isDocument) {
      return (
        <ImageParseExperience
          key={`${experience}:${imageParseWorkspaceKey}:${model.userId}:${model.defaultProjectId}`}
          task={experience === 'field-extract' ? 'kie' : 'standard'}
          startFresh={imageParseWorkspaceKey > 0 && navigationType !== 'POP'}
          model={model}
          showMenuButton={isMobile}
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          onHistoryChange={setImageParseHistory}
        />
      );
    }
    return <DuplexExperience model={model} />;
  }

  return (
    <>
      <PlaygroundLayout
        sidebar={sidebar}
        topBar={topBar}
        hideFooter={isDocument}
        isMobile={isMobile}
        mobileSidebarOpen={mobileSidebarOpen}
        onCloseMobileSidebar={closeDrawer}
        rightPanel={
          citationPanel ? (
            <CitationDrawer
              citations={citationPanel.citations}
              activeUrl={activeCitationUrl}
              onClose={closeCitationPanel}
            />
          ) : null
        }
        rightPanelOpen={citationPanelOpen}
        onCloseRightPanel={closeCitationPanel}
      >
        {renderMain()}
      </PlaygroundLayout>
      <SettingsPanel
        open={settingsOpen}
        modelId={model.modelId}
        onOpenChange={setSettingsOpen}
        params={params}
        showReasoning={allowReasoning}
        onUpdate={update}
        onStreamChange={setStream}
        onReset={reset}
      />

      {/* Thumbs-down feedback dialog: collect a reason tag plus optional text, then report. */}
      <FeedbackDialog
        open={feedback.dialogOpen}
        onOpenChange={feedback.setDialogOpen}
        submitting={feedback.submitting}
        onSubmit={feedback.submitDown}
      />
    </>
  );
}
