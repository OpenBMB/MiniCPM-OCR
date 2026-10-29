/**
 * Types local to the Playground page.
 *
 * Purpose: chat messages, parameter preferences, reasoning depth, and other types used only on this page, shared by hooks and components.
 * Aligned with the token usage types in the SSE API layer (src/api/map/chat.ts).
 */

import type { TokenUsage } from '@/api/map/chat';

/** Chat message role. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** i18n translate function signature (compatible with react-i18next’s t). */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Web-search progress phase (live display for the current answer only). */
export type SearchProgressStep =
  | 'searching'
  | 'found'
  | 'reading'
  | 'synthesizing'
  | 'failed'
  | 'browse_failed';

/** Terminal state of a tool-call event. */
export type ToolEventStatus = 'running' | 'success' | 'failed' | 'interrupted';

/**
 * A user-visible summary of one tool call.
 * Raw arguments, the tool’s full result, and internal credentials are not stored.
 */
export interface ToolEvent {
  eventId: string;
  step: number;
  tool: string;
  status: ToolEventStatus;
  queryCount?: number;
  /** The query this tool actually used; an in-progress search row shows it in place. */
  queries?: string[];
  resultCount?: number;
  pageCount?: number;
  durationMs?: number;
  message?: string;
  /** Source addresses this tool touched (already normalized), shown in place on the progress timeline as a site icon and page title. */
  citationUrls?: string[];
  /**
   * Reasoning character count already produced when this tool’s first frame arrived, used as the split point in the reasoning text.
   * Derived on the frontend during streaming; the backend does not send it. History messages and non-streaming answers do not have this field.
   */
  reasoningOffset?: number;
}

/** Attachment modality: image, video, audio, or file (documents and similar). */
export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

/**
 * An attachment the user uploaded with a message. The Playground prefers an object-storage URL; dataUrl is only a local preview or compatibility fallback.
 * Each modality is mapped to a different OpenAI content part when sent (see utils/attachments.ts).
 */
export interface Attachment {
  /** Unique id generated on the frontend (used as a key and for removal). */
  id: string;
  /** Modality. */
  kind: AttachmentKind;
  /** Original filename (passed through for the file modality so the upstream can recognize the type; other modalities use it for display). */
  name: string;
  /** MIME type. */
  mime: string;
  /** Size in bytes. */
  size: number;
  /**
   * Local preview URL. A failed upload falls back to a base64 data URL; restoring a cloud PDF from history uses a short-lived link temporarily,
   * which is replaced by a fileId reference before save. The short-lived link is not persisted.
   */
  dataUrl: string;
  /** Access URL after the backend uploads to object storage; preferred when sending to the model. */
  url?: string;
  /** Same-origin platform proxy URL, used for display so OBS hotlink protection does not block the browser. */
  proxyUrl?: string;
  /** Public signed platform proxy URL, so LIS or the model can fetch the attachment by URL. */
  publicUrl?: string;
  /** Object-storage key, used when tracing a problem. */
  objectKey?: string;
  /** Business file id from file-upload; before send, a model read link is re-signed for the current logged-in user. */
  fileId?: string;
}

/**
 * One chat message.
 * While an assistant message is streaming, `streaming=true`; content deltas merge into `content` and reasoning deltas merge into `reasoning`.
 */
export interface ChatMessage {
  /** Unique message id (generated on the frontend). */
  id: string;
  role: ChatRole;
  /** Body (markdown). */
  content: string;
  /** Attachments the user uploaded with the message (image, video, audio, or file; session only, not persisted to history). */
  attachments?: Attachment[];
  /** Reasoning trace (only some models have it). */
  reasoning?: string;
  /** Whether it is currently streaming. */
  streaming?: boolean;
  /** Whether it is in the web-search phase (a client-inferred state after web search is on and before the first body text arrives). */
  searching?: boolean;
  /** Web-search tool status text. */
  searchStatus?: string;
  /** Current web-search progress phase. */
  searchStep?: SearchProgressStep;
  /** Number of sources web search has found. */
  searchResultCount?: number;
  /** The web tool currently running, or the one that finished most recently. */
  searchActiveTool?: string;
  /** How many pages the page-read tool is about to browse, or did browse, this time. */
  searchBrowseCount?: number;
  /** Query web search actually used, shown in the progress area. */
  searchQueries?: string[];
  /** Tool names actually called during this turn’s web search. */
  searchTools?: string[];
  /** Append-only event summary of this turn’s tool calls. */
  toolEvents?: ToolEvent[];
  /** Web-search citation sources (shown under the answer when present). */
  citations?: Citation[];
  /** Token usage for this turn (usage on the tail chunk). */
  usage?: TokenUsage;
  /** Performance for this turn (frontend timing: time to first token, and total duration). */
  metrics?: MessageMetrics;
  /** Platform L2 request id for the currently selected answer version. */
  requestId?: string;
  /** Client correlation id for this Playground call, used to look up the platform request id exactly when the response header cannot be read. */
  clientRequestId?: string;
  /** API key id actually used for this Playground call. */
  apiKeyId?: string;
  /** Error message (when generation fails). */
  error?: string;
  /** Upstream error code, used to tell a content-safety block from an ordinary request failure. */
  errorCode?: string;
  /** A turn blocked by content-safety review is kept only for display and audit, and no longer takes part in any later model context. */
  contextExcluded?: boolean;
  /** Whether the answer is incomplete because a client lifecycle event, such as a page refresh, interrupted it. */
  interrupted?: boolean;
  /** Context divider: rendered as a horizontal rule; history above it is not sent to the model as context (this is not a new conversation). */
  divider?: boolean;
  /** Feedback highlight (thumbs-up or thumbs-down on the selected version; persisted when the conversation is saved, and reported to /feedback). */
  feedback?: MessageFeedback;
  /**
   * Multi-version answers ("regenerate" keeps older versions, ChatGPT-style ‹n/N›). Present only on assistant turns that have been regenerated.
   * Invariant: top-level content, reasoning, citations, usage, metrics, and feedback always mirror versions[activeVersion],
   * so every reader of the top-level fields (toRequestMessages, copy, and render) does not need to know about multiple versions.
   */
  versions?: AnswerVersion[];
  /** Index of the selected version (into versions; defaults to the last one). */
  activeVersion?: number;
}

/** Snapshot of one answer version (one complete answer produced by regenerate). */
export interface AnswerVersion {
  content: string;
  reasoning?: string;
  searchStatus?: string;
  searchStep?: SearchProgressStep;
  searchResultCount?: number;
  searchActiveTool?: string;
  searchBrowseCount?: number;
  searchQueries?: string[];
  searchTools?: string[];
  /** Tool-call event summary for this answer version. */
  toolEvents?: ToolEvent[];
  citations?: Citation[];
  usage?: TokenUsage;
  metrics?: MessageMetrics;
  /** Platform L2 request id for this answer version. */
  requestId?: string;
  /** Client correlation id for this answer version. */
  clientRequestId?: string;
  /** API key id actually used for this answer version. */
  apiKeyId?: string;
  error?: string;
  /** Whether this version is a partial answer restored after an interruption. */
  interrupted?: boolean;
  /** Feedback belongs to a specific version (each version can be liked or disliked on its own). */
  feedback?: MessageFeedback;
}

/** Assistant feedback: up or down. They are mutually exclusive; clicking the same one again clears it. */
export type MessageFeedback = 'up' | 'down';

/**
 * Performance for one generation turn (frontend timing, not a backend field).
 * Filled in during streaming: request start to the first delta is firstTokenMs, and request start to completion is durationMs.
 */
export interface MessageMetrics {
  /** Time to first token (ms): from send until the first body or reasoning delta arrives. */
  firstTokenMs?: number;
  /** Total duration (ms): from send until this turn ends (including network and generation). */
  durationMs?: number;
}

/** Web-search citation source (normalized from url_citation annotations on the response). */
export interface Citation {
  /**
   * Global source number assigned by the backend (starting at 1), stable across turns and bound to the URL.
   *
   * The marker number must come from this, not from the array index: each search reorders results by relevance,
   * and the array index only happens to match on a single search. Across multiple searches it would silently point at an unrelated page.
   * Fall back to the array index only when an old backend does not send it (see citationDisplayIndex).
   */
  ref?: number;
  /** Source URL. */
  url: string;
  /** Source title (the frontend falls back to the domain when it is missing). */
  title?: string;
  /** Short snippet extracted from the search result or the page body. */
  snippet?: string;
}

/** Reasoning depth (UI level): off or on. */
export type ThinkingDepth = 'off' | 'on';

/**
 * Reasoning parameter style: models do not agree on the field name for "turn reasoning on".
 * - `reasoning_effort`: OpenAI-style enum
 * - `thinking`: some models use `{type:enabled|disabled}`
 * - `both`: send both, for the widest compatibility
 */
export type ThinkingStyle = 'reasoning_effort' | 'thinking' | 'both';

/** Format of the reasoning switch field; handled separately from whether reasoning_effort is also attached. */
export type ThinkingControlFormat = 'chat_template_kwargs' | 'thinking' | 'both';

/** Chat parameter preferences (non-sensitive, safe to persist in the store). */
export interface PlaygroundParams {
  /** Sampling temperature. */
  temperature?: number;
  /** Nucleus sampling top_p. */
  topP?: number;
  /** Maximum output tokens; omitted when unset. An explicit 0 is still a valid value. */
  maxTokens?: number;
  /** v4.7 image compression ratio; sent only when the user explicitly chooses it, otherwise the model default is kept. */
  imageDownsampleMode?: '4x' | '16x';
  /** Reasoning depth level. */
  thinkingDepth: ThinkingDepth;
  /** Reasoning parameter style. */
  thinkingStyle: ThinkingStyle;
  /** Whether the Playground explicitly sends reasoning parameters; when false, the model’s parameter_config injects them. */
  includeThinkingParams: boolean;
  /** Model protocol field to use when the user toggles reasoning. */
  thinkingControlFormat: ThinkingControlFormat;
  /** Default reasoning object for the current model, used only when merging the request, not written into user preferences. */
  thinkingDefaults?: {
    chat_template_kwargs?: Record<string, unknown>;
    thinking?: Record<string, unknown>;
  };
  /** Whether output is streamed (true = SSE token by token; false = the full reply is returned at once). */
  stream: boolean;
  /** Whether web search is on (when on, the call goes through the L3 Playground BFF). */
  webSearch: boolean;
  /**
   * Tool names enabled for this web-search request. The three-state meaning matches backend enabledToolDefinitions:
   * `undefined` (field omitted) = every tool is available; an empty array = all disabled; a named list = filter by name.
   *
   * The default must be `undefined`, not `[]`: when the user has not chosen tools, the set should follow the backend registry as it is now.
   * Once the frontend materializes an explicit list into preferences, a built-in tool added later never takes effect for existing users.
   */
  enabledTools?: string[];
  /** Location the user set manually (for example "Beijing"), used by the datetime tool for place-related questions. */
  userLocation?: string;
}

/** Parameter defaults. */
export const DEFAULT_PARAMS: PlaygroundParams = {
  thinkingDepth: 'off',
  thinkingStyle: 'both',
  includeThinkingParams: true,
  thinkingControlFormat: 'chat_template_kwargs',
  stream: true,
  webSearch: false,
};
