/**
 * Playground 历史对话的后端存储形态（每用户私有）。
 *
 * 用途：与前端 ChatMessage 互转的 DTO 集合。从 types.ts 拆出来是为了让两边都留在
 * 类型文件 500 行的硬上限内；对外仍由 types.ts 统一再导出，调用方 import 路径不变。
 */

/** 历史对话（列表项 / 元信息，不含消息明细） */
export interface MapConversation {
  id: string;
  title: string;
  model?: string;
  created_at: string;
  updated_at: string;
}

/** 历史对话中的一条消息（后端存储形态，与前端 ChatMessage 互转） */
export interface MapStoredMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** 首 token 延迟（ms，前端埋点实测） */
  first_token_ms?: number;
  /** 本轮总耗时（ms，前端埋点实测） */
  duration_ms?: number;
  /** 当前选中回答版本对应的平台 L2 请求 ID */
  request_id?: string;
  /** 当前选中回答版本对应的客户端关联 ID */
  client_request_id?: string;
  /** 当前选中回答版本实际使用的 API Key ID */
  api_key_id?: string;
  /** 多版本回答的全部版本（仅重新生成过的 assistant 有值；单版本为空） */
  alt_versions?: MapStoredVersion[];
  /** 当前选中版本索引（0 起；空=单版本） */
  active_version?: number;
  /** 反馈高亮（当前选中版本的点赞/点踩） */
  feedback?: 'up' | 'down';
  /** 联网搜索引用来源（单版本 assistant 消息） */
  citations?: Array<{ url: string; title?: string; snippet?: string }>;
  /** 联网工具状态文本（单版本消息顶层；用于刷新后重绘过程区） */
  search_status?: string;
  /** 联网检索当前阶段（单版本消息顶层） */
  search_step?: string;
  /** 联网检索到的网页数量（单版本消息顶层） */
  search_result_count?: number;
  /** 当前正在执行或最近完成的联网工具（单版本消息顶层） */
  search_active_tool?: string;
  /** 网页读取工具准备浏览或成功浏览的页面数量（单版本消息顶层） */
  search_browse_count?: number;
  /** 联网搜索实际使用的查询词（单版本消息顶层） */
  search_queries?: string[];
  /** 本轮实际调用过的工具名称（单版本消息顶层） */
  search_tools?: string[];
  /** 本轮工具调用事件摘要（单版本消息顶层） */
  tool_events?: ToolEventDTO[];
  /** 用户消息附件元信息；只保存对象存储 URL/key 与展示元数据，不保存 base64 */
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
  /** 安审拦截消息仍可展示，但不会重新带入后续模型上下文。 */
  context_excluded?: boolean;
  created_at: string;
}

/** 单个回答版本的存储形态（后端以 jsonb 原样往返，不解释内容） */
export interface MapStoredVersion {
  content: string;
  reasoning?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  first_token_ms?: number;
  duration_ms?: number;
  /** 该回答版本对应的平台 L2 请求 ID */
  request_id?: string;
  /** 该回答版本对应的客户端关联 ID */
  client_request_id?: string;
  /** 该回答版本实际使用的 API Key ID */
  api_key_id?: string;
  /** 该版本的联网引用来源 */
  citations?: Array<{ url: string; title?: string; snippet?: string }>;
  /** 该版本的反馈高亮（点赞/点踩） */
  feedback?: 'up' | 'down';
  /** 该版本是否因页面刷新等客户端生命周期中断而不完整 */
  interrupted?: boolean;
  /** 该版本联网工具状态文本（用于过程区重绘） */
  search_status?: string;
  /** 该版本联网检索当前阶段 */
  search_step?: string;
  /** 该版本联网检索到的网页数量 */
  search_result_count?: number;
  /** 该版本当前正在执行或最近完成的联网工具 */
  search_active_tool?: string;
  /** 该版本网页读取工具准备浏览或成功浏览的页面数量 */
  search_browse_count?: number;
  /** 该版本联网搜索实际使用的查询词 */
  search_queries?: string[];
  /** 该版本本轮实际调用过的工具名称 */
  search_tools?: string[];
  /** 该版本工具调用事件摘要 */
  tool_events?: ToolEventDTO[];
}

/** Playground 历史消息中的工具事件摘要。 */
export interface ToolEventDTO {
  eventId: string;
  step: number;
  tool: string;
  status: 'running' | 'success' | 'failed' | 'interrupted';
  queryCount?: number;
  /** 该工具实际使用的查询词。 */
  queries?: string[];
  resultCount?: number;
  pageCount?: number;
  durationMs?: number;
  message?: string;
  /** 该工具涉及的来源地址，用于在过程时间线上就地展示站点图标与页面标题。 */
  citationUrls?: string[];
  /**
   * 该工具首帧到达时已产出的思考字符数，作为思考文本的切分点。
   * 由前端在流式期间推导，后端不下发；历史消息与非流式回答没有该字段。
   */
  reasoningOffset?: number;
}

/** 历史对话详情（元信息 + 消息明细） */
export interface MapConversationDetail {
  conversation: MapConversation;
  messages: MapStoredMessage[];
}

/** 保存对话的请求体（整段覆盖式） */
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
    /** 联网工具状态文本（单版本消息顶层；用于刷新后重绘过程区） */
    search_status?: string;
    /** 联网检索当前阶段（单版本消息顶层） */
    search_step?: string;
    /** 联网检索到的网页数量（单版本消息顶层） */
    search_result_count?: number;
    /** 当前正在执行或最近完成的联网工具（单版本消息顶层） */
    search_active_tool?: string;
    /** 网页读取工具准备浏览或成功浏览的页面数量（单版本消息顶层） */
    search_browse_count?: number;
    /** 联网搜索实际使用的查询词（单版本消息顶层） */
    search_queries?: string[];
    /** 本轮实际调用过的工具名称（单版本消息顶层） */
    search_tools?: string[];
    /** 本轮工具调用事件摘要 */
    tool_events?: ToolEventDTO[];
    attachments?: MapStoredMessage['attachments'];
    context_excluded?: boolean;
  }>;
}
