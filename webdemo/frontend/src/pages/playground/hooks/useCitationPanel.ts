/**
 * 引用来源面板的开合与定位编排 hook。
 *
 * 用途：把「正在展示哪条消息的来源 / 面板是否展开 / 面板内高亮哪一条」这三份状态，连同
 * Esc 关闭、来源消失时自动收起、卸载清理延时器，从页面入口收敛到一处。不含 JSX。
 *
 * 为什么 panel 与 open 要分成两份状态：关闭需要走退出动画，面板内容必须等动画跑完才能卸载，
 * 所以 open 先转 false 放动画，panel 延后清空。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatMessage, Citation } from '../types';

/** 与 PlaygroundLayout 的 PANEL_MOTION（duration-300）对齐：动画跑完再卸载面板内容。 */
const PANEL_EXIT_MS = 300;

/** 面板当前展示的来源及其归属消息。 */
interface CitationPanelState {
  messageId: string;
  citations: Citation[];
}

interface UseCitationPanelResult {
  /** 当前展示的来源；null 表示面板内容已卸载。 */
  panel: CitationPanelState | null;
  /** 面板是否展开（驱动动画，早于 panel 清空）。 */
  open: boolean;
  /** 面板内高亮定位的来源 URL；未指定时不高亮任何一条。 */
  activeUrl?: string;
  /** 打开某条消息的来源面板；带 activeUrl 时同时定位并高亮该来源。 */
  openPanel: (messageId: string, citations: Citation[], activeUrl?: string) => void;
  /** 关闭面板（走退出动画）。 */
  closePanel: () => void;
}

/**
 * 编排引用来源面板的开合与高亮定位。
 * @param messages 当前对话的全部消息，用于在来源消失时自动收起面板
 * @returns 面板状态与开关方法
 */
export function useCitationPanel(messages: ChatMessage[]): UseCitationPanelResult {
  const [panel, setPanel] = useState<CitationPanelState | null>(null);
  const [open, setOpen] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | undefined>(undefined);
  const exitTimer = useRef<number | undefined>(undefined);

  const openPanel = useCallback(
    (messageId: string, citations: Citation[], nextActiveUrl?: string) => {
      if (citations.length === 0) return;
      window.clearTimeout(exitTimer.current);
      setPanel({ messageId, citations });
      setOpen(true);
      // 不带 url 的入口（底部「查看全部」）顺带清掉上一次的高亮，避免停在无关的一条上。
      setActiveUrl(nextActiveUrl);
    },
    [],
  );

  const closePanel = useCallback(() => {
    setOpen(false);
    setActiveUrl(undefined);
    window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => {
      setPanel(null);
    }, PANEL_EXIT_MS);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(exitTimer.current);
    },
    [],
  );

  // Esc 关闭：桌面端是非模态并排，没有遮罩可点，键盘是除面板自带 X 之外唯一的关闭入口。
  useEffect(() => {
    if (!panel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panel, closePanel]);

  // 来源随消息消失（重新生成、切换版本、清空会话）时自动收起，不让面板停在空数据上。
  useEffect(() => {
    if (panel && !messages.some((m) => m.id === panel.messageId && m.citations?.length)) {
      // 这里必须走 setState 而非 render 期推导：closePanel 要放完 300ms 退出动画再卸载内容，
      // 纯推导会让面板瞬间消失；且推导态在消息被换回来时会把面板又弹开。
      // 只在归属消息真的消失时触发一次，不是每渲染都跑。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      closePanel();
    }
  }, [messages, panel, closePanel]);

  return { panel, open, activeUrl, openPanel, closePanel };
}
