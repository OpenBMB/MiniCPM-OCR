/**
 * 体验中心（Playground）本页类型集合。
 *
 * 用途：集中声明对话消息、参数偏好、思考深度等本页专用类型，供 hooks / components 共享。
 * 与 SSE API 层（src/api/map/chat.ts）的 token usage 类型对齐。
 */

import type { TokenUsage } from '@/api/map/chat';

/** 对话消息角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** i18n 翻译函数签名（与 react-i18next 的 t 函数兼容）。 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** 联网搜索过程阶段（仅用于当前回答的实时展示）。 */
export type SearchProgressStep =
  | 'searching'
  | 'found'
  | 'reading'
  | 'synthesizing'
  | 'failed'
  | 'browse_failed';

/** 工具调用事件终态。 */
export type ToolEventStatus = 'running' | 'success' | 'failed' | 'interrupted';

/**
 * 一次工具调用的用户可见摘要。
 * 不保存原始 arguments、工具全文结果或内部凭据。
 */
export interface ToolEvent {
  eventId: string;
  step: number;
  tool: string;
  status: ToolEventStatus;
  queryCount?: number;
  /** 该工具实际使用的查询词，进行中的搜索行就地展示它。 */
  queries?: string[];
  resultCount?: number;
  pageCount?: number;
  durationMs?: number;
  message?: string;
  /** 该工具涉及的来源地址（已归一化），用于在过程时间线上就地展示站点图标与页面标题。 */
  citationUrls?: string[];
  /**
   * 该工具首帧到达时已产出的思考字符数，作为思考文本的切分点。
   * 由前端在流式期间推导，后端不下发；历史消息与非流式回答没有该字段。
   */
  reasoningOffset?: number;
}

/** 附件模态：图像 / 视频 / 音频 / 文件（文档等） */
export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

/**
 * 用户随消息上传的附件。体验中心优先使用对象存储 URL，dataUrl 仅作为本地预览/兼容兜底。
 * 各模态发送时映射为不同的 OpenAI content-part（见 utils/attachments.ts）。
 */
export interface Attachment {
  /** 前端生成的唯一 id（用于 key / 移除） */
  id: string;
  /** 模态类别 */
  kind: AttachmentKind;
  /** 原始文件名（file 模态透传给上游识别类型，其余用于展示） */
  name: string;
  /** MIME 类型 */
  mime: string;
  /** 字节大小 */
  size: number;
  /**
   * 本地预览地址。上传失败兜底使用 base64 data URL；云端 PDF 历史恢复时临时使用短时链接，
   * 保存前会被 fileId 引用替换，不持久化短时链接。
   */
  dataUrl: string;
  /** 后端上传到对象存储后的访问 URL，发送给模型时优先使用 */
  url?: string;
  /** 平台同源代理 URL，用于前端展示，避免 OBS 防盗链影响浏览器访问 */
  proxyUrl?: string;
  /** 平台公开签名代理 URL，供 LIS/模型按 URL 拉取附件 */
  publicUrl?: string;
  /** 对象存储 key，用于问题定位 */
  objectKey?: string;
  /** file-upload 的业务文件 ID；发送前按当前登录用户重新签发模型读取链接 */
  fileId?: string;
}

/**
 * 单条对话消息。
 * assistant 消息在流式生成期间 `streaming=true`，正文增量并入 `content`、思考增量并入 `reasoning`。
 */
export interface ChatMessage {
  /** 消息唯一 id（前端生成） */
  id: string;
  role: ChatRole;
  /** 正文（markdown） */
  content: string;
  /** 用户随消息上传的附件（图像/视频/音频/文件；仅会话内，不持久化到历史） */
  attachments?: Attachment[];
  /** 思考过程（reasoning，部分模型才有） */
  reasoning?: string;
  /** 是否正在流式生成 */
  streaming?: boolean;
  /** 是否处于联网搜索阶段（开启联网后、首个正文到达前的客户端推断态） */
  searching?: boolean;
  /** 联网搜索工具状态文本 */
  searchStatus?: string;
  /** 联网搜索当前过程阶段 */
  searchStep?: SearchProgressStep;
  /** 联网搜索已发现的来源数量 */
  searchResultCount?: number;
  /** 当前正在执行或最近完成的联网工具。 */
  searchActiveTool?: string;
  /** 网页读取工具本次准备浏览或成功浏览的页面数量。 */
  searchBrowseCount?: number;
  /** 联网搜索实际使用的查询词，用于过程区展示。 */
  searchQueries?: string[];
  /** 本轮联网过程中实际调用过的工具名称。 */
  searchTools?: string[];
  /** 本轮工具调用的追加式事件摘要。 */
  toolEvents?: ToolEvent[];
  /** 联网搜索引用来源（有则在回答下方展示） */
  citations?: Citation[];
  /** 本轮 token 用量（尾块 usage） */
  usage?: TokenUsage;
  /** 本轮性能指标（前端计时：首 token 延迟、总耗时） */
  metrics?: MessageMetrics;
  /** 当前选中回答版本对应的平台 L2 请求 ID */
  requestId?: string;
  /** 本次 Playground 调用的客户端关联 ID，用于响应头不可读时精确反查平台请求 ID */
  clientRequestId?: string;
  /** 本次 Playground 调用实际使用的 API Key ID */
  apiKeyId?: string;
  /** 错误信息（生成失败时） */
  error?: string;
  /** 上游错误码，用于区分内容安全拦截与普通请求失败 */
  errorCode?: string;
  /** 安审拦截的轮次仅保留展示与审计，不再参与任何后续模型上下文。 */
  contextExcluded?: boolean;
  /** 回答是否因页面刷新等客户端生命周期中断而不完整 */
  interrupted?: boolean;
  /** 上下文分隔线标记：渲染为横线；其上的历史不再作为上下文发送给模型（非新会话） */
  divider?: boolean;
  /** 反馈高亮（当前选中版本的点赞/点踩；会话保存时持久化，并上报 /feedback） */
  feedback?: MessageFeedback;
  /**
   * 多版本回答（「重新生成」保留旧版本，ChatGPT 式 ‹n/N›）。仅重新生成过的 assistant 轮次存在。
   * 不变式：顶层 content/reasoning/citations/usage/metrics/feedback 始终镜像 versions[activeVersion]，
   * 使所有读顶层字段的逻辑（toRequestMessages/复制/渲染）无需感知多版本。
   */
  versions?: AnswerVersion[];
  /** 当前选中版本索引（指向 versions；默认末位） */
  activeVersion?: number;
}

/** 单个回答版本快照（重新生成产生的一份完整回答）。 */
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
  /** 该回答版本的工具调用事件摘要。 */
  toolEvents?: ToolEvent[];
  citations?: Citation[];
  usage?: TokenUsage;
  metrics?: MessageMetrics;
  /** 该回答版本对应的平台 L2 请求 ID */
  requestId?: string;
  /** 该回答版本对应的客户端关联 ID */
  clientRequestId?: string;
  /** 该回答版本实际使用的 API Key ID */
  apiKeyId?: string;
  error?: string;
  /** 该版本是否为中断后恢复的部分回答 */
  interrupted?: boolean;
  /** 反馈属于具体版本（不同版本可各自点赞/点踩） */
  feedback?: MessageFeedback;
}

/** 助手消息反馈态：赞 / 踩。二者互斥，再次点击同一项即取消。 */
export type MessageFeedback = 'up' | 'down';

/**
 * 单轮生成的性能指标（前端计时，非后端字段）。
 * 流式下逐步填充：发起→首增量得 firstTokenMs，发起→完成得 durationMs。
 */
export interface MessageMetrics {
  /** 首 token 延迟（ms）：从发起到第一个正文/思考增量到达 */
  firstTokenMs?: number;
  /** 总耗时（ms）：从发起到本轮结束（含网络与生成） */
  durationMs?: number;
}

/** 联网搜索引用来源（由响应的 url_citation annotations 归一化而来） */
export interface Citation {
  /**
   * 后端分配的全局来源编号（1 起），跨轮稳定、与 URL 绑定。
   *
   * 角标数字必须取它而不是数组下标：后端每轮搜索都会按相关性重排结果，
   * 数组下标只在单轮搜索时碰巧与之相同，多轮时会静默指向无关网页。
   * 老后端不下发时才回退到数组下标（见 citationDisplayIndex）。
   */
  ref?: number;
  /** 来源 URL */
  url: string;
  /** 来源标题（缺省时前端回退展示域名） */
  title?: string;
  /** 搜索结果或网页正文中提取的短摘要。 */
  snippet?: string;
}

/** 思考深度（UI 档位）：关闭 / 开启 */
export type ThinkingDepth = 'off' | 'on';

/**
 * 思考参数风格：不同模型对「开启思考」的字段命名不一。
 * - `reasoning_effort`：OpenAI 风格枚举
 * - `thinking`：部分模型用 `{type:enabled|disabled}`
 * - `both`：两者都发，最大兼容
 */
export type ThinkingStyle = 'reasoning_effort' | 'thinking' | 'both';

/** 思考开关字段格式；与是否附加 reasoning_effort 分开处理。 */
export type ThinkingControlFormat = 'chat_template_kwargs' | 'thinking' | 'both';

/** 对话参数偏好（非敏感，可持久化到 store） */
export interface PlaygroundParams {
  /** 采样温度 */
  temperature?: number;
  /** 核采样 top_p */
  topP?: number;
  /** 最大输出 token；未设置时不下发，显式 0 仍是有效值 */
  maxTokens?: number;
  /** v4.7 图片压缩比例；仅用户显式选择时发送，否则沿用模型默认值 */
  imageDownsampleMode?: '4x' | '16x';
  /** 思考深度档位 */
  thinkingDepth: ThinkingDepth;
  /** 思考参数风格 */
  thinkingStyle: ThinkingStyle;
  /** 是否由体验中心显式发送思考参数；false 时交给模型 parameter_config 注入 */
  includeThinkingParams: boolean;
  /** 用户切换思考时应使用的模型协议字段 */
  thinkingControlFormat: ThinkingControlFormat;
  /** 当前模型的思考对象默认值，仅用于请求合并，不写入用户偏好 */
  thinkingDefaults?: {
    chat_template_kwargs?: Record<string, unknown>;
    thinking?: Record<string, unknown>;
  };
  /** 是否流式输出（true=SSE 逐字；false=一次性返回完整回复） */
  stream: boolean;
  /** 是否开启联网搜索（开启时走 L3 Playground BFF） */
  webSearch: boolean;
  /**
   * 本次联网请求启用的工具名称列表，三态语义与后端 enabledToolDefinitions 对齐：
   * `undefined`（不下发该字段）= 全部工具可用；空数组 = 全部禁用；具名列表 = 按名过滤。
   *
   * 默认必须是 `undefined` 而非 `[]`：用户没做过工具选择时，工具集应由后端当下的注册表决定。
   * 一旦在前端物化成显式列表存进偏好，后续新增的内置工具对老用户就永远不会生效。
   */
  enabledTools?: string[];
  /** 用户手动设置的当前位置（如"北京市"），用于 datetime 工具回答地点相关问题。 */
  userLocation?: string;
}

/** 参数默认值 */
export const DEFAULT_PARAMS: PlaygroundParams = {
  thinkingDepth: 'off',
  thinkingStyle: 'both',
  includeThinkingParams: true,
  thinkingControlFormat: 'chat_template_kwargs',
  stream: true,
  webSearch: false,
};
