/**
 * Hook that orchestrates opening, closing, and positioning of the citation-source panel.
 *
 * Purpose: pull the three pieces of state "which message's sources are showing / whether the panel is open / which item is highlighted inside the panel", together with
 * close on Esc, auto-collapse when a source disappears, and clearing the delay timer on unmount, into one place at the page entry. No JSX.
 *
 * Why panel and open are two pieces of state: closing has to play an exit animation, and the panel content must not unmount until the animation finishes,
 * so open turns false first to run the animation, and panel is cleared later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatMessage, Citation } from '../types';

/** Aligned with PlaygroundLayout's PANEL_MOTION (duration-300): unmount the panel content only after the animation finishes. */
const PANEL_EXIT_MS = 300;

/** Sources the panel is currently showing, and the message they belong to. */
interface CitationPanelState {
  messageId: string;
  citations: Citation[];
}

interface UseCitationPanelResult {
  /** Sources currently shown; null means the panel content has unmounted. */
  panel: CitationPanelState | null;
  /** Whether the panel is expanded (drives the animation, and happens before panel is cleared). */
  open: boolean;
  /** Source URL highlighted inside the panel; when unset, no item is highlighted. */
  activeUrl?: string;
  /** Open the source panel for one message; when activeUrl is set, also locate and highlight that source. */
  openPanel: (messageId: string, citations: Citation[], activeUrl?: string) => void;
  /** Close the panel (plays the exit animation). */
  closePanel: () => void;
}

/**
 * Orchestrate opening, closing, and highlight positioning of the citation-source panel.
 * @param messages every message in the current conversation, used to collapse the panel automatically when a source disappears
 * @returns panel state and open/close methods
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
      // An entry with no url (the "view all" at the bottom) also clears the previous highlight, so it does not stay on an unrelated item.
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

  // Close on Esc: on desktop it is a non-modal side-by-side panel with no mask to click, so the keyboard is the only close entry besides the panel's own X.
  useEffect(() => {
    if (!panel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panel, closePanel]);

  // When a source disappears with the message (regenerate, switching versions, clearing the conversation), collapse automatically, so the panel does not sit on empty data.
  useEffect(() => {
    if (panel && !messages.some((m) => m.id === panel.messageId && m.citations?.length)) {
      // This must go through setState rather than being derived during render: closePanel has to finish the 300ms exit animation before unmounting the content,
      // and a pure derivation would make the panel vanish instantly; a derived state would also pop the panel open again when the message is swapped back.
      // Fire once only when the owning message really disappears, not on every render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      closePanel();
    }
  }, [messages, panel, closePanel]);

  return { panel, open, activeUrl, openPanel, closePanel };
}
