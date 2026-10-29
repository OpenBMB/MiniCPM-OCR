/**
 * Playground 流式 SSE 回调集合。
 *
 * 用途：把 content/reasoning/citations/usage/tool_status/done 六路增量收敛成对
 * `setMessages` 的补丁，并在这里持有一次补全期间的流式局部状态（播放队列、工具是否在跑、
 * 思考切分游标）。与 chatCompletion.ts 的纯列表变换分开：那半边是无状态的收尾函数，
 * 这半边是有生命周期的工厂，放一起会让 util 文件越过 300 行上限。
 */

import type { Dispatch, SetStateAction } from 'react';
import type { Citation, StreamCallbacks, TokenUsage, ToolStatusEvent } from '@/api/map/chat';
import type { ChatMessage, Translate } from '../types';
import { isReaderTool } from './answerTimeline';
import { appendToMessage } from './messages';
import { toolStatusStep, toolStatusText } from './chatStatus';
import { createStreamTextQueue, type StreamTextKind } from './streamTextQueue';
import { upsertToolEvent } from './toolEvents';

/** createStreamCallbacks 入参 */
export interface StreamCallbackContext {
  assistantId: string;
  /** 是否为联网搜索流；普通流式回答不能展示搜索过程条。 */
  webSearch: boolean;
  /** i18n 翻译函数（playground 命名空间），用于工具进度文案。 */
  t: Translate;
  isActive: () => boolean;
  markFirstToken: () => void;
  onDone: () => void;
  onRequestId: (requestId: string) => void;
  onModerationAnswer?: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

export type StreamCallbacksController = StreamCallbacks & {
  cancel: () => void;
};

/**
 * 构造流式 SSE 回调集合（content/reasoning/citations/usage/tool_status/done）。
 * @param ctx assistantId、首 token 埋点、完成回调与 setMessages
 */
export function createStreamCallbacks(ctx: StreamCallbackContext): StreamCallbacksController {
  const {
    assistantId,
    webSearch,
    t,
    isActive,
    markFirstToken,
    onDone,
    onRequestId,
    onModerationAnswer,
    setMessages,
  } = ctx;
  // 追踪工具是否仍在执行中（running 状态）。running 期间 content delta 不覆盖 searching，
  // 避免 queue 的 text flush 把正展开的面板在 content delta 到达时错误收起。
  let toolRunningRef = false;
  /*
    思考文本的切分游标：工具首帧到达时把它锚进事件，过程时间线据此把整块思考切成
    「思考 → 工具 → 思考」交错的一条线。

    必须在 onReasoning 回调里累加，不能改成读 prev.reasoning?.length：思考增量要过
    createStreamTextQueue 的 16ms 节流，而 onToolStatus 是立即 setMessages，读 prev 会拿到
    滞后于真实进度的长度，切点会系统性偏前。这里累加的是"已 enqueue 总量"，与 SSE 到达
    顺序严格一致，不受播放队列影响。

    这个"抢跑"由渲染侧兜住：onToolStatus 不过播放队列，工具事件会比它上方那段思考文字
    "播完"早几百毫秒到；buildProcessTimeline 的 holdUnplayed 因此把切点还没播到的工具行
    押着不出。不改成让工具事件也排进同一个队列——那会把 searching 等状态反馈整体推迟。
  */
  let enqueuedReasoningChars = 0;
  const queue = createStreamTextQueue((kind: StreamTextKind, delta: string) => {
    if (!isActive()) return;
    markFirstToken();
    const deltaPatch = kind === 'content' ? { contentDelta: delta } : { reasoningDelta: delta };
    // 仅在工具已执行完（非 running）时才由 text flush 收 searching 状态；
    // 工具执行中（running）时 searching 状态由 onToolStatus 全权管理。
    // 这里不再要求"曾有过工具活动"：开了联网但模型压根没调工具时，正文一开始生成就必须
    // 把 searching 收掉，否则进度卡片会一路转圈到流结束。
    const progressPatch = webSearch && !toolRunningRef ? { searching: false } : {};
    setMessages((prev) => appendToMessage(prev, assistantId, { ...deltaPatch, ...progressPatch }));
  });

  return {
    onContent: (delta: string) => {
      if (!isActive()) return;
      queue.enqueue('content', delta);
    },
    onReasoning: (delta: string) => {
      if (!isActive()) return;
      enqueuedReasoningChars += delta.length;
      queue.enqueue('reasoning', delta);
    },
    onCitations: (citations: Citation[]) => {
      if (!isActive()) return;
      setMessages((prev) => appendToMessage(prev, assistantId, { citationsDelta: citations }));
    },
    onUsage: (usage: TokenUsage) => {
      if (!isActive()) return;
      setMessages((prev) => appendToMessage(prev, assistantId, { usage }));
    },
    onToolStatus: (status: ToolStatusEvent) => {
      if (!isActive()) return;
      toolRunningRef = status.status === 'running';
      // 只按工具名判定"在读网页"：带 urls 就算读页会把将来任何附带地址的工具误报成浏览。
      const readingPages = isReaderTool(status.tool);
      const resultCount =
        status.result_count !== undefined ? status.result_count : status.urls?.length;
      setMessages((prev) =>
        appendToMessage(prev, assistantId, {
          searching: status.status === 'running',
          searchStep: toolStatusStep(status),
          searchStatus: toolStatusText(status, t),
          ...(status.tool ? { searchActiveTool: status.tool } : {}),
          ...(status.queries?.length ? { searchQueriesDelta: status.queries } : {}),
          ...(status.tool ? { searchToolsDelta: [status.tool] } : {}),
          toolEvents: upsertToolEvent(
            prevToolEvents(prev, assistantId) ?? [],
            status,
            enqueuedReasoningChars,
          ),
          ...(readingPages && resultCount !== undefined ? { searchBrowseCount: resultCount } : {}),
          ...(!readingPages && status.result_count !== undefined
            ? { searchResultCount: status.result_count }
            : {}),
        }),
      );
    },
    onRequestId: (requestId: string) => {
      if (!isActive()) return;
      onRequestId(requestId);
    },
    onModerationAnswer: () => {
      if (!isActive()) return;
      onModerationAnswer?.();
    },
    onDone: () => {
      if (!isActive()) return;
      queue.finish(onDone);
    },
    cancel: () => queue.cancel(),
  };
}

/** 取指定 assistant 的当前工具事件，供函数式状态更新复用。 */
function prevToolEvents(list: ChatMessage[], assistantId: string): ChatMessage['toolEvents'] {
  return list.find((message) => message.id === assistantId)?.toolEvents;
}
