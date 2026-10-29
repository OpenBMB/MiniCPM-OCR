import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../types';
import { useMessageFeedback } from '../useMessageFeedback';

const mutate = vi.fn();
const toast = vi.fn();

vi.mock('@map/ui', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('@/api/map', () => ({
  useSubmitFeedbackMutation: () => ({ mutate, isPending: false }),
}));

function assistant(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, streaming: false };
}

function user(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, streaming: false };
}

describe('useMessageFeedback', () => {
  beforeEach(() => {
    mutate.mockReset();
    toast.mockReset();
  });

  it('点踩弹框提交使用打开弹框时的问答/模型/会话快照', () => {
    const setLocalFeedback = vi.fn();
    const firstMessages = [
      user('u1', '旧问题'),
      {
        ...assistant('a1', '旧回答'),
        requestId: 'req_feedback_source',
        clientRequestId: 'map_playground_0123456789abcdef0123456789abcdef',
        apiKeyId: '00000000-0000-0000-0000-000000000001',
      },
    ];
    const secondMessages = [user('u2', '新问题'), assistant('a2', '新回答')];

    const { result, rerender } = renderHook(
      ({ messages, model, conversationId }) =>
        useMessageFeedback({
          messages,
          model,
          conversationId,
          setLocalFeedback,
        }),
      {
        initialProps: {
          messages: firstMessages,
          model: 'model-old',
          conversationId: 'conv-old',
        },
      },
    );

    act(() => {
      result.current.onFeedback('a1', 'down');
    });
    expect(result.current.dialogOpen).toBe(true);

    rerender({
      messages: secondMessages,
      model: 'model-new',
      conversationId: 'conv-new',
    });

    act(() => {
      result.current.submitDown({ reasons: ['格式错乱'], comment: '补充说明' });
    });

    expect(mutate).toHaveBeenCalledWith(
      {
        conversation_id: 'conv-old',
        public_model: 'model-old',
        feedback_type: 'down',
        reasons: ['格式错乱'],
        comment: '补充说明',
        question: '旧问题',
        answer: '旧回答',
        request_id: 'req_feedback_source',
        client_request_id: 'map_playground_0123456789abcdef0123456789abcdef',
        api_key_id: '00000000-0000-0000-0000-000000000001',
      },
      expect.any(Object),
    );
    expect(setLocalFeedback).not.toHaveBeenCalled();
    expect(result.current.dialogOpen).toBe(false);
  });
});
