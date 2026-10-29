/**
 * Backend storage shape for Playground history conversations (private per user).
 *
 * Purpose: DTOs converted to and from the frontend ChatMessage. Split out of types.ts so both files stay
 * within the 500-line hard limit for type files. types.ts still re-exports them, so caller import paths stay the same.
 */

/** History conversation (list item / metadata, without message details) */
export interface MapConversation {
  id: string;
  title: string;
  model?: string;
  created_at: string;
  updated_at: string;
}

/** One message in a history conversation (backend storage shape, converted to and from the frontend ChatMessage) */
export interface MapStoredMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Time to first token (ms, measured by frontend instrumentation) */
  first_token_ms?: number;
  /** Total duration of this turn (ms, measured by frontend instrumentation) */
  duration_ms?: number;
  /** Platform L2 request ID for the currently selected answer version */
  request_id?: string;
  /** Client correlation ID for the currently selected answer version */
  client_request_id?: string;
  /** API Key ID actually used by the currently selected answer version */
  api_key_id?: string;
  /** Every version of a multi-version answer (set only for a regenerated assistant message; empty for a single version) */
  alt_versions?: MapStoredVersion[];
  /** Index of the currently selected version (0-based; empty means a single version) */
  active_version?: number;
  /** Feedback highlight (like/dislike of the currently selected version) */
  feedback?: 'up' | 'down';
  /** Web-search citation sources (single-version assistant message) */
  citations?: Array<{ url: string; title?: string; snippet?: string }>;
  /** Web-tool status text (top level of a single-version message; redraws the process area after refresh) */
  search_status?: string;
  /** Current web-retrieval stage (top level of a single-version message) */
  search_step?: string;
  /** Number of web pages retrieved (top level of a single-version message) */
  search_result_count?: number;
  /** Web tool currently running or most recently finished (top level of a single-version message) */
  search_active_tool?: string;
  /** Number of pages the web reader is about to browse or has browsed (top level of a single-version message) */
  search_browse_count?: number;
  /** Query terms actually used by web search (top level of a single-version message) */
  search_queries?: string[];
  /** Tool names actually invoked this turn (top level of a single-version message) */
  search_tools?: string[];
  /** Tool-call event summary for this turn (top level of a single-version message) */
  tool_events?: ToolEventDTO[];
  /** User-message attachment metadata; store only the object-storage URL/key and display metadata, not base64 */
  attachments?: Array<{
    id: string;
    kind: 'image' | 'video' | 'audio' | 'file';
    name: string;
    mime: string;
    size: number;
    url?: string;
    proxyUrl?: string;
    publicUrl?: string;
    objectKey?: string;
    dataUrl?: string;
  }>;
  /** A content-safety-review blocked message can still be shown, but is not fed back into later model context. */
  context_excluded?: boolean;
  created_at: string;
}

/** Storage shape of one answer version (the backend round-trips jsonb as-is and does not interpret the content) */
export interface MapStoredVersion {
  content: string;
  reasoning?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  first_token_ms?: number;
  duration_ms?: number;
  /** Platform L2 request ID for this answer version */
  request_id?: string;
  /** Client correlation ID for this answer version */
  client_request_id?: string;
  /** API Key ID actually used by this answer version */
  api_key_id?: string;
  /** Web citation sources for this version */
  citations?: Array<{ url: string; title?: string; snippet?: string }>;
  /** Feedback highlight for this version (like/dislike) */
  feedback?: 'up' | 'down';
  /** Whether this version is incomplete because a client lifecycle event such as a page refresh interrupted it */
  interrupted?: boolean;
  /** Web-tool status text for this version (used to redraw the process area) */
  search_status?: string;
  /** Current web-retrieval stage for this version */
  search_step?: string;
  /** Number of web pages retrieved for this version */
  search_result_count?: number;
  /** Web tool currently running or most recently finished for this version */
  search_active_tool?: string;
  /** Number of pages the web reader is about to browse or has browsed for this version */
  search_browse_count?: number;
  /** Query terms actually used by web search for this version */
  search_queries?: string[];
  /** Tool names actually invoked this turn for this version */
  search_tools?: string[];
  /** Tool-call event summary for this version */
  tool_events?: ToolEventDTO[];
}

/** Tool-event summary in a Playground history message. */
export interface ToolEventDTO {
  eventId: string;
  step: number;
  tool: string;
  status: 'running' | 'success' | 'failed' | 'interrupted';
  queryCount?: number;
  /** Query terms this tool actually used. */
  queries?: string[];
  resultCount?: number;
  pageCount?: number;
  durationMs?: number;
  message?: string;
  /** Source URLs involved in this tool, shown in place on the process timeline with site icons and page titles. */
  citationUrls?: string[];
  /**
   * Reasoning character count already produced when this tool’s first frame arrived, used as the split point in the reasoning text.
   * Derived on the frontend during streaming; the backend does not send it. History messages and non-streaming answers do not have this field.
   */
  reasoningOffset?: number;
}

/** History conversation detail (metadata plus message details) */
export interface MapConversationDetail {
  conversation: MapConversation;
  messages: MapStoredMessage[];
}

/** Request body for saving a conversation (full overwrite) */
export interface MapSaveConversationInput {
  title?: string;
  model?: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    reasoning?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    first_token_ms?: number;
    duration_ms?: number;
    request_id?: string;
    client_request_id?: string;
    api_key_id?: string;
    alt_versions?: MapStoredVersion[];
    active_version?: number;
    feedback?: 'up' | 'down';
    citations?: Array<{ url: string; title?: string; snippet?: string }>;
    /** Web-tool status text (top level of a single-version message; redraws the process area after refresh) */
    search_status?: string;
    /** Current web-retrieval stage (top level of a single-version message) */
    search_step?: string;
    /** Number of web pages retrieved (top level of a single-version message) */
    search_result_count?: number;
    /** Web tool currently running or most recently finished (top level of a single-version message) */
    search_active_tool?: string;
    /** Number of pages the web reader is about to browse or has browsed (top level of a single-version message) */
    search_browse_count?: number;
    /** Query terms actually used by web search (top level of a single-version message) */
    search_queries?: string[];
    /** Tool names actually invoked this turn (top level of a single-version message) */
    search_tools?: string[];
    /** Tool-call event summary for this turn */
    tool_events?: ToolEventDTO[];
    attachments?: MapStoredMessage['attachments'];
    context_excluded?: boolean;
  }>;
}
