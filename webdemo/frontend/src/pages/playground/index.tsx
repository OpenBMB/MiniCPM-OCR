/** 体验中心页面：组合模型入口、凭据、对话状态与文档工作台。 */

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

/** URL 体验键到免费额度类型的映射；语言模型使用缺省 language。 */
const playgroundCredentialExperiences = {
  language: 'language',
  tts: 'tts',
  duplex: 'realtime',
  'image-parse': 'image-parse',
  'field-extract': 'image-parse',
} as const;

/** 按 URL 组合独立体验页与公共侧栏。 */
export default function PlaygroundPage() {
  const { toast } = useToast();
  const { t } = useTranslation('playground');
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { experience: experienceParam } = useParams();
  const collapsed = useAppStore((s) => s.playground.sidebarCollapsed);
  const setPrefs = useAppStore((s) => s.setPlaygroundPrefs);
  // 移动端（<lg）侧栏转抽屉
  const isMobile = !useBreakpoint('lg');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [imageParseHistory, setImageParseHistory] = useState<PlaygroundSidebarHistory>();
  const [imageParseWorkspaceKey, setImageParseWorkspaceKey] = useState(0);

  // 凭据按 URL 对应的体验类型独立回退：该类型免费额度用尽时立即改用用户自有 Key。
  const credentialExperience =
    playgroundCredentialExperiences[normalizeExperience(experienceParam)];
  const model = usePlaygroundModel(credentialExperience);
  const selectedModel = model.models.find((item) => item.id === model.modelId);
  const attachmentCapabilities = selectedModel?.capabilities;
  // 思考展示、参数默认值与消息渲染遵从当前模型能力。
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
  // 引用来源面板：开合、内容归属、高亮定位统一由 useCitationPanel 编排
  const {
    panel: citationPanel,
    open: citationPanelOpen,
    activeUrl: activeCitationUrl,
    openPanel: openCitationPanel,
    closePanel: closeCitationPanel,
  } = useCitationPanel(chat.messages);
  // URL 保持入口；模型加载完成后，无权限的体验回退语言模型。
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
  // 可发送要求：已选模型 + 已选 Key + 明文密钥已就绪（避免密钥解密未完成就发起请求而失败）
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

  // 历史恢复模型时由 resolveSelection 兜底；只依赖稳定的选择函数。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const restoreModel = useCallback((m: string) => model.selectModel(m), [model.selectModel]);

  // 历史对话持久化（列表/加载/自动保存/新建/删除）
  const conv = useConversationPersistence({
    messages: chat.messages,
    model: model.modelId,
    ownerId: model.userId,
    ownerLoading: model.userLoading,
    setMessages: chat.setMessages,
    clear: chat.clear,
    onModelRestore: restoreModel,
  });

  // 对话反馈编排：点赞静默上报，点踩弹框选原因后上报；本地高亮仍由 chat.setFeedback 持有
  const feedback = useMessageFeedback({
    messages: chat.messages,
    model: model.modelId,
    conversationId: conv.activeConversationId,
    setLocalFeedback: chat.setFeedback,
  });

  // 移动端：选会话/新建后自动收起抽屉
  const closeDrawer = useCallback(() => setMobileSidebarOpen(false), []);
  // 切换体验（语言/语音合成/实时音视频/图像解析）：写入 URL 以便刷新保持；移动端顺带收起抽屉
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
    // 已是空白新对话（无消息且未落库）时，仅提示，避免"点了没反应"的困惑
    if (chat.messages.length === 0 && !conv.activeConversationId) {
      toast({ title: t('currentNewConversation') });
      closeDrawer();
      return;
    }
    conv.newChat();
    setInput(''); // 顺带清空输入框，回到干净的新对话现场
    toast({ title: t('newConversationStarted') });
    closeDrawer();
  }, [chat.messages.length, closeDrawer, conv, t, toast]);
  // 用户主动切换不同模型时，模型上下文不能继续复用。旧会话保留在最近对话中，
  // 新模型从空白会话开始；历史会话恢复模型则继续使用 restoreModel，不经过这里。
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
  // 删除二次确认：destructive 弹窗确认后再真正删除，避免误删历史对话
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

  // 语言输入槽在欢迎态与对话态复用，避免重复装配 Composer 与密钥状态行。
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

  // 语言模型体验主区：欢迎态（居中输入 + 任务卡）与对话态（消息流 + 底部输入）二选一
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

  // 主区按体验分发：语言模型渲染真功能对话区，其余体验各自独立页面
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

      {/* 点踩反馈弹窗：收集原因标签 + 可选正文后上报 */}
      <FeedbackDialog
        open={feedback.dialogOpen}
        onOpenChange={feedback.setDialogOpen}
        submitting={feedback.submitting}
        onSubmit={feedback.submitDown}
      />
    </>
  );
}
