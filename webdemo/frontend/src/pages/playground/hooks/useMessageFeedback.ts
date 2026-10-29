/**
 * 体验中心对话反馈编排 hook。
 *
 * 用途：把「点赞直接静默上报 / 点踩弹框选原因后上报 / 本地高亮态切换」收敛为一处，喂给页面。
 * 本地高亮态仍由 useChat.setFeedback 持有（即时反馈）；本 hook 负责上报后端与点踩弹框状态。
 * 不含 JSX。上报为 fire-and-forget：失败仅 toast，不回退本地高亮（简单账本式处理）。
 */

import { useCallback, useState } from 'react';
import { useToast } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { useSubmitFeedbackMutation } from '@/api/map';
import type { MessageFeedback, ChatMessage } from '../types';
import { findQAPair } from '../utils/messages';

interface FeedbackSnapshot {
  assistantId: string;
  conversationId?: string;
  requestId?: string;
  clientRequestId?: string;
  apiKeyId?: string;
  publicModel: string;
  question: string;
  answer: string;
}

interface Args {
  /** 当前消息列表（取问答快照） */
  messages: ChatMessage[];
  /** 当前模型 id（= public_model） */
  model: string;
  /** 当前会话 id（新对话未保存时为 undefined） */
  conversationId?: string;
  /** 切换本地高亮态（赞/踩互斥、再点取消） */
  setLocalFeedback: (assistantId: string, kind: MessageFeedback) => void;
}

interface Return {
  /** 点击赞/踩：赞直接上报，踩打开弹框 */
  onFeedback: (assistantId: string, kind: MessageFeedback) => void;
  /** 点踩弹框是否打开 */
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  /** 上报中 */
  submitting: boolean;
  /** 提交点踩弹框（带原因/正文） */
  submitDown: (payload: { reasons: string[]; comment: string }) => void;
}

export function useMessageFeedback(args: Args): Return {
  const { messages, model, conversationId, setLocalFeedback } = args;
  const { toast } = useToast();
  const { t } = useTranslation('playground');
  const submitMut = useSubmitFeedbackMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  // 待提交点踩的反馈快照：弹框期间会话/版本可能切换，提交必须使用点击当刻的问答与归属。
  const [pending, setPending] = useState<FeedbackSnapshot | null>(null);

  const makeSnapshot = useCallback(
    (assistantId: string): FeedbackSnapshot => {
      const { question, answer, requestId, clientRequestId, apiKeyId } = findQAPair(
        messages,
        assistantId,
      );
      return {
        assistantId,
        conversationId,
        requestId,
        clientRequestId,
        apiKeyId,
        publicModel: model,
        question,
        answer,
      };
    },
    [messages, model, conversationId],
  );

  const report = useCallback(
    (snapshot: FeedbackSnapshot, kind: MessageFeedback, reasons: string[], comment: string) => {
      submitMut.mutate(
        {
          conversation_id: snapshot.conversationId,
          ...(snapshot.requestId ? { request_id: snapshot.requestId } : {}),
          ...(snapshot.clientRequestId ? { client_request_id: snapshot.clientRequestId } : {}),
          ...(snapshot.apiKeyId ? { api_key_id: snapshot.apiKeyId } : {}),
          public_model: snapshot.publicModel,
          feedback_type: kind,
          reasons,
          comment: comment || undefined,
          question: snapshot.question,
          answer: snapshot.answer,
        },
        {
          onSuccess: () => toast({ title: t('thanksForFeedback') }),
          onError: () => toast({ title: t('feedbackSubmitFailed'), variant: 'error' }),
        },
      );
    },
    [submitMut, t, toast],
  );

  const changeDialogOpen = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) setPending(null);
  }, []);

  const isCurrentPendingTarget = useCallback(
    (snapshot: FeedbackSnapshot) =>
      snapshot.conversationId === conversationId &&
      messages.some((m) => m.id === snapshot.assistantId),
    [messages, conversationId],
  );

  const onFeedback = useCallback(
    (assistantId: string, kind: MessageFeedback) => {
      const wasActive = messages.find((m) => m.id === assistantId)?.feedback === kind;
      // 取消高亮（再次点击同项）：直接切掉本地态，不上报、不弹框
      if (wasActive) {
        setLocalFeedback(assistantId, kind);
        return;
      }
      if (kind === 'up') {
        // 点赞即时反馈：切高亮 + 静默上报
        setLocalFeedback(assistantId, 'up');
        report(makeSnapshot(assistantId), 'up', [], '');
      } else {
        // 点踩：先冻结问答快照并打开弹框；提交成功才落高亮，取消则不留痕迹。
        setPending(makeSnapshot(assistantId));
        setDialogOpen(true);
      }
    },
    [messages, setLocalFeedback, report, makeSnapshot],
  );

  const submitDown = useCallback(
    (payload: { reasons: string[]; comment: string }) => {
      if (pending) {
        // 若弹框期间已经切换会话，不再改当前页面高亮，但仍按点击当刻快照上报。
        if (isCurrentPendingTarget(pending)) {
          setLocalFeedback(pending.assistantId, 'down');
        }
        report(pending, 'down', payload.reasons, payload.comment);
      }
      setDialogOpen(false);
      setPending(null);
    },
    [pending, isCurrentPendingTarget, setLocalFeedback, report],
  );

  return {
    onFeedback,
    dialogOpen,
    setDialogOpen: changeDialogOpen,
    submitting: submitMut.isPending,
    submitDown,
  };
}
