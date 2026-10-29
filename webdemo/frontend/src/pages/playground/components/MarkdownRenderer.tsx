/**
 * Markdown 渲染组件。
 *
 * 用途：渲染助手回复的 markdown 正文，支持 GFM（表格/删除线/任务列表）、代码块语法高亮，
 * 以及数学公式（`$...$` 行内 / `$$...$$` 块级，经 remark-math + KaTeX 渲染）。
 * 高亮用 highlight.js（同步、与 rehype 管线天然集成，流式 re-render 无异步闪烁）。
 */

import { memo, useEffect, useMemo, useRef, useState, type AriaRole, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';
import { ArrowUpRight, Check } from 'lucide-react';

import { cn } from '@map/ui';

import type { Citation } from '../types';
import {
  citationDisplayIndex,
  citationDomain,
  citationURLKey,
  safeCitationHref,
} from '../utils/citations';
import { linkifyCitationMarkers } from '../utils/citationMarkers';
import { useMarkdownPreparation } from '../hooks/useMarkdownPreparation';
import { SAFE_KATEX_OPTIONS } from '../utils/math-options';
import { imageParseHighlight, type ImageParseLinkedRange } from '../utils/imageParseHighlight';
import { imageParseLineBreaks } from '../utils/imageParseLineBreaks';
import { imageParseHtmlMath } from '../utils/imageParseHtmlMath';
import type { ImageParseTextRange } from '../utils/imageParseBlocks';
import { imageParseDocumentBlockMarkers } from '../utils/imageParseDocumentBlocks';
import { CitationBadge } from './CitationBadge';
import { ImageParseMarkdownBlock } from './experiences/ImageParseMarkdownBlock';

interface MarkdownRendererProps {
  /** markdown 源文本 */
  content: string;
  /**
   * 渲染场景。
   * - `default`：对话正文；
   * - `reasoning`：思考过程，更紧凑的字号、间距和弱化配色；
   * - `document`：整页文档结果（图像解析），表格使用单层矩形网格，任务列表自绘复选框。
   */
  variant?: 'default' | 'reasoning' | 'document';
  /** 是否仍在流式生成；流式期间仅渲染显式且已闭合的数学定界符。 */
  streaming?: boolean;
  /** OCR 选中块的源范围，供文档预览高亮。 */
  highlightRange?: ImageParseTextRange;
  /** 当前回答的联网引用，用于把命中的 Markdown 链接增强为来源标签。 */
  citations?: Citation[];
  /**
   * 点击正文角标时的回调（序号从 1 起，与来源面板同号）。
   * 必须是稳定引用：它进 `createMarkdownComponents` 的 useMemo 依赖，每渲染新建会让整篇正文重渲。
   */
  onCitationActivate?: (citation: Citation, index: number) => void;
  /** 可定位到原图的 OCR 块；只有服务提供有效映射时传入。 */
  linkedRanges?: readonly ImageParseLinkedRange[];
  /** OCR 原图裁出的占位符图片，仅用于文档预览，不写回 Markdown。 */
  imageCrops?: readonly string[];
  /** 在消毒后的顶层节点添加双击编辑入口。 */
  editableBlocks?: boolean;
}

/** 超过该长度的已完成回答才延迟解析，避免短回答出现可感知的加载占位。 */
export const LAZY_MARKDOWN_THRESHOLD = 12_000;

const MARKDOWN_BASE_CLASSES = `
  [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
  [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold
  [&_a:not([data-citation-badge]):not([data-citation-source])]:text-primary
  [&_a:not([data-citation-badge]):not([data-citation-source])]:underline
  [&_a:not([data-citation-badge]):not([data-citation-source])]:underline-offset-2
  [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
  [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5
  [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted/60 [&_pre]:p-3
  [&_pre_code]:bg-transparent [&_pre_code]:p-0
  [&_table]:w-full
  [&_th]:px-2 [&_th]:py-1 [&_th]:text-left
  [&_td]:px-2 [&_td]:py-1
  [&_.katex]:inline-block [&_.katex]:max-w-full [&_.katex]:overflow-x-auto [&_.katex]:overflow-y-hidden [&_.katex]:align-middle
  [&_.katex-display_.katex]:w-max [&_.katex-display_.katex]:max-w-none
  [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden
`;

/*
  尾元素清掉下边距（[&>*:last-child]:mb-0）：块级兄弟之间外边距会合并，这 8px 平时被后面
  元素的 mt 吃掉、看不出来；但来源胶囊是 inline-flex（要收窄成药丸），行内级盒子不参与合并，
  于是它上方白白多出一截——同一段正文，后面跟什么就给出两种间距。间距该由父容器决定，
  渲染器只负责内部节奏。
*/
const DEFAULT_MARKDOWN_CLASSES = `
  text-[14px] leading-7 text-foreground
  [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&>*:last-child]:mb-0
  [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg
  [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base
  [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm
  [&_code]:text-[13px] [&_pre]:my-3 [&_pre_code]:text-[13px]
  [&_table]:my-3 [&_table]:text-sm
  [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border
  [&_.katex-display]:my-3 [&_.katex-display]:py-1
`;

/*
  pre-wrap 必须下沉到 `p` 内部，不能挂在容器上。两件事都要成立：

  - 思考文本里模型常用单换行分行，那些软换行落在段落内部，得靠 pre-wrap 保住；
  - react-markdown 会在相邻块级元素之间输出一个换行文本节点（`</p>` 与 `<p>` 之间）。
    容器一旦 pre-wrap，这个分隔符就成了真实硬换行——段落之间凭空多出一个空行（leading-6
    即 24px），把 my-1.5 的 6px 间距顶到 30px，读起来像每段都被隔开成了独立的块。

  容器保持默认的空白折叠，分隔符不可见；pre-wrap 只管段落内部。
*/
const REASONING_MARKDOWN_CLASSES = `
  break-words text-[13px] leading-6 text-foreground/70
  [&_p]:my-1.5 [&_p]:whitespace-pre-wrap [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
  [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5
  [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base
  [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm
  [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-[13px]
  [&_code]:text-xs [&_pre]:my-2 [&_pre_code]:text-xs
  [&_table]:my-2 [&_table]:text-xs
  [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border
  [&_.katex-display]:my-2 [&_.katex-display]:py-1
`;

/**
 * 文档型排版。与对话正文的三处关键差别，都是为了让整页 OCR 结果读起来像一份文档而不是一条回复：
 *
 * 1. 标题靠字号与留白分层，不再画分隔线——h1/h2 各带一条线再叠上原文的 `---`，整页会被横线切碎；
 * 2. 正文压到 80% 前景色，标题与加粗保持纯前景色——层级由明度差承担；
 * 3. 表格使用完整单元格网格、表头铺浅底（见 DOCUMENT_COMPONENTS），合并行列沿用 HTML 结构。
 */
const DOCUMENT_MARKDOWN_CLASSES = `
  text-sm leading-[1.85] text-foreground/80
  [&>*:first-child]:mt-0
  [&_p]:my-3.5 [&_p]:text-pretty
  [&_strong]:font-semibold [&_strong]:text-foreground
  [&_h1]:mb-6 [&_h1]:mt-8 [&_h1]:text-balance [&_h1]:text-xl [&_h1]:font-semibold
  [&_h1]:leading-snug [&_h1]:tracking-tight [&_h1]:text-foreground
  [&_h2]:mb-2.5 [&_h2]:mt-7 [&_h2]:text-[15px] [&_h2]:font-semibold
  [&_h2]:tracking-tight [&_h2]:text-foreground
  [&_h1+h2]:mt-0 [&_hr+h2]:mt-0
  [&_h3]:mb-1.5 [&_h3]:mt-6 [&_h3]:text-[0.875rem] [&_h3]:text-foreground
  [&_ul]:my-3.5 [&_ol]:my-3.5 [&_li]:my-1 [&_li]:pl-1
  [&_li::marker]:text-muted-foreground/60
  [&_th]:min-w-24 [&_th]:bg-muted/50 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left
  [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground
  [&_th]:border [&_th]:border-border
  [&_td]:min-w-24 [&_td]:px-4 [&_td]:py-2.5 [&_td]:tabular-nums [&_td]:text-foreground/90
  [&_td]:border [&_td]:border-border
  [&_td[align=right]]:text-right [&_td[align=center]]:text-center
  [&_th[align=right]]:text-right [&_th[align=center]]:text-center
  [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-muted/30
  [&_:not(pre)>code]:bg-muted/70 [&_:not(pre)>code]:text-[0.8125rem]
  [&_:not(pre)>code]:text-foreground/90
  [&_pre]:my-4 [&_pre_code]:text-[13px]
  [&_hr]:my-10 [&_hr]:border-border/50
  [&_blockquote]:my-4 [&_blockquote]:border-primary/40
  [&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0
  [&_.task-list-item]:flex [&_.task-list-item]:items-start [&_.task-list-item]:gap-2.5
  [&_.katex-display]:my-6 [&_.katex-display]:rounded-lg [&_.katex-display]:bg-muted/40
  [&_.katex-display]:px-4 [&_.katex-display]:py-6
`;

/**
 * 文档型表格滚动容器：网格边线由单元格统一绘制，避免外框叠加。
 *
 * 包一层而不是让 table 自己滚——table 的 overflow 按规范就是 visible，
 * 宽表格会直接撑破对照栏。选中使用外轮廓，不改变网格尺寸或遮挡单元格。
 * @param children 表格行内容
 */
function DocumentTable({
  children,
  className,
  'data-ocr-highlight': highlight,
  'data-ocr-hover': hover,
  'data-ocr-block-id': blockId,
  'data-ocr-linked-ids': linkedIds,
  role,
  tabIndex,
}: {
  children?: ReactNode;
  className?: string;
  'data-ocr-highlight'?: string;
  'data-ocr-hover'?: string;
  'data-ocr-block-id'?: string;
  'data-ocr-linked-ids'?: string;
  role?: AriaRole;
  tabIndex?: number;
}) {
  return (
    <div
      data-ocr-highlight={highlight}
      data-ocr-hover={hover}
      data-document-table="true"
      data-ocr-block-id={blockId}
      data-ocr-linked-ids={linkedIds}
      role={role}
      tabIndex={tabIndex}
      className={cn(
        'my-6 overflow-x-auto',
        'data-[ocr-highlight=true]:outline data-[ocr-highlight=true]:outline-1 data-[ocr-highlight=true]:outline-ocr-link data-[ocr-hover=true]:bg-ocr-link/5 data-[ocr-hover=true]:outline data-[ocr-hover=true]:outline-1 data-[ocr-hover=true]:outline-ocr-link/40',
        className,
      )}
    >
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

/**
 * 文档型任务列表复选框。
 *
 * GFM 产出的是 `disabled` 原生 input，浏览器会把它画成灰勾——结果页里那是一份识别结果，
 * 不是一个坏掉的表单控件，所以改成自绘方框。保留 checkbox 语义供读屏使用。
 * @param type 原 input 类型；Markdown 只会生成 checkbox
 * @param checked 是否已勾选
 */
function DocumentCheckbox({ type, checked }: { type?: string; checked?: boolean }) {
  if (type !== 'checkbox') return null;
  return (
    <span
      role="checkbox"
      aria-checked={Boolean(checked)}
      aria-disabled="true"
      className={cn(
        'mt-[0.42em] inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
      )}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : null}
    </span>
  );
}

/** 仅文档型排版启用的节点覆盖；对话正文保持原生渲染，避免影响既有气泡样式。 */
const DOCUMENT_COMPONENTS: Components = {
  table: DocumentTable,
  input: DocumentCheckbox,
  div: ImageParseMarkdownBlock,
};

/** OCR HTML 先过滤再添加定位标记；保留合并单元格和供 KaTeX 解析的公式类名。 */
const DOCUMENT_HTML_SCHEMA: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
    td: [
      ...(defaultSchema.attributes?.td ?? []),
      'rowSpan',
      'colSpan',
      ['align', 'left', 'center', 'right'],
    ],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      'rowSpan',
      'colSpan',
      ['align', 'left', 'center', 'right'],
    ],
  },
};

const DOCUMENT_HTML_PLUGINS: NonNullable<Parameters<typeof ReactMarkdown>[0]['rehypePlugins']> = [
  rehypeRaw,
  imageParseHtmlMath,
  imageParseLineBreaks,
  [rehypeSanitize, DOCUMENT_HTML_SCHEMA],
];

/**
 * 判断回答是否需要按滚动位置延迟渲染。
 * @param contentLength markdown 字符数
 * @param streaming 是否仍在流式生成
 * @returns 是否应该延迟渲染
 */
export function shouldDeferMarkdown(contentLength: number, streaming: boolean): boolean {
  return !streaming && contentLength > LAZY_MARKDOWN_THRESHOLD;
}

/** 场景 → 排版类映射。 */
const VARIANT_CLASSES = {
  default: DEFAULT_MARKDOWN_CLASSES,
  reasoning: REASONING_MARKDOWN_CLASSES,
  document: DOCUMENT_MARKDOWN_CLASSES,
} as const;

/**
 * 渲染 markdown。用 prose 排版类 + 语义 token 控制配色。
 * memo：流式高频更新时，仅 content 变化才重渲染。
 * @param content markdown 源文本
 * @param variant 正文或思考过程样式
 * @param streaming 是否仍在流式生成
 * @param citations 当前回答的联网引用
 * @param onCitationActivate 点击正文角标时的回调
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  variant = 'default',
  streaming = false,
  highlightRange,
  citations = [],
  onCitationActivate,
  linkedRanges,
  imageCrops,
  editableBlocks = false,
}: MarkdownRendererProps) {
  // 先把模型偶尔输出的裸角标 `[1]` 改写成 Markdown 链接，正文渲染侧就只需处理 `a` 一种情况。
  // 文档型排版必须保持原文：OCR 的块位置和图片占位符都依赖原始偏移量，不能被角标改写改变长度。
  const linkified = useMemo(
    () => (variant === 'document' ? content : linkifyCitationMarkers(content, citations)),
    [citations, content, variant],
  );
  // 流式前缀会不断变化，禁止对未标记文本猜测公式，避免 KaTeX 节点短暂挂载后又被卸载。
  // OCR 忠实展示文档；电话号码和编号不得由聊天场景的裸公式推断改写。
  const detectBareMath = variant !== 'document' && !streaming;
  const { normalized, editBlocks, normalizedRange, normalizedLinkedRanges, placeholderOffsets } =
    useMarkdownPreparation({
      sourceContent: content,
      renderContent: linkified,
      detectBareMath,
      editableBlocks,
      highlightRange,
      linkedRanges,
    });
  // 角标增强只用于对话正文；文档型排版继续使用忠实原文的节点覆盖。
  const baseComponents = useMemo(
    () => createMarkdownComponents(citations, onCitationActivate),
    [citations, onCitationActivate],
  );
  // 文档型排版不继承角标增强：OCR 文档不带引用，链接必须保持消毒后的原样渲染
  // （角标渲染会把 <a> 变成来源标签，破坏“忠实展示文档”的语义）。
  const documentComponents = useMemo<Components>(
    () => ({
      ...DOCUMENT_COMPONENTS,
      // 显式兜底：文档预览里的链接只放行 http/https，其余协议一律去掉 href。
      // react-markdown 的 defaultUrlTransform 与 rehype-sanitize 仍是第一道防线，这里不依赖它们。
      a: ({ href, children }) => {
        const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
        return (
          <a href={safe} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
      img: ({ node, src, alt }) => {
        const offset = node?.position?.start?.offset;
        const index = offset === undefined ? -1 : placeholderOffsets.indexOf(offset);
        const crop =
          imageCrops?.length === placeholderOffsets.length && index >= 0
            ? imageCrops[index]
            : undefined;
        if (crop) return <img src={crop} alt={alt ?? 'image'} />;
        if (src && /^(?:https?:|data:)/i.test(src)) return <img src={src} alt={alt ?? ''} />;
        return <span>{alt ?? 'image'}</span>;
      },
    }),
    [imageCrops, placeholderOffsets],
  );
  return (
    <div className={cn(MARKDOWN_BASE_CLASSES, VARIANT_CLASSES[variant])}>
      <ReactMarkdown
        components={variant === 'document' ? documentComponents : baseComponents}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          // 只在 OCR 文档预览解析 HTML；不信任模型提供的脚本、属性或定位标记。
          ...(variant === 'document' ? DOCUMENT_HTML_PLUGINS : []),
          [() => imageParseDocumentBlockMarkers(editBlocks)],
          [imageParseHighlight, normalizedRange, normalizedLinkedRanges, variant === 'document'],
          [rehypeHighlight, { detect: true }],
          // KaTeX 对模型输入禁用受信任命令并限制资源消耗；插件自身负责解析失败回退。
          [rehypeKatex, SAFE_KATEX_OPTIONS],
        ]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
});

interface LazyMarkdownRendererProps {
  /** markdown 源文本 */
  content: string;
  /** 是否仍在流式生成；流式回答必须立即渲染。 */
  streaming?: boolean;
  /** 当前回答的联网引用。 */
  citations?: Citation[];
  /** 点击正文角标时的回调，需为稳定引用，透传给 MarkdownRenderer。 */
  onCitationActivate?: (citation: Citation, index: number) => void;
}

/**
 * 长回答懒渲染器：进入视口前只保留估算高度，接近视口时再运行 Markdown、代码高亮和公式解析。
 * @param content markdown 源文本
 * @param streaming 是否仍在流式生成
 * @param citations 当前回答的联网引用
 * @param onCitationActivate 点击正文角标时的回调
 * @returns 延迟渲染的 Markdown 内容
 */
export function LazyMarkdownRenderer({
  content,
  streaming = false,
  citations = [],
  onCitationActivate,
}: LazyMarkdownRendererProps) {
  const { t } = useTranslation('playground');
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldDefer = shouldDeferMarkdown(content.length, streaming);
  const [rendered, setRendered] = useState(!shouldDefer);

  useEffect(() => {
    if (!shouldDefer || rendered) return;
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setRendered(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRendered(true);
        observer.disconnect();
      },
      { rootMargin: '640px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rendered, shouldDefer]);

  if (rendered || !shouldDefer) {
    return (
      <MarkdownRenderer
        content={content}
        streaming={streaming}
        citations={citations}
        onCitationActivate={onCitationActivate}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      aria-label={t('answerLoading')}
      className="flex items-center rounded-lg bg-muted/20 px-4 text-sm text-muted-foreground [content-visibility:auto]"
      style={{ minHeight: `${estimateMarkdownHeight(content)}px` }}
    >
      {t('scrollToLoadAnswer')}
    </div>
  );
}

/** 估算未渲染 Markdown 的占位高度，降低滚动过程中布局跳动。 */
function estimateMarkdownHeight(content: string): number {
  const lineCount = content.split(/\r?\n/).length;
  const wrappedLineCount = Math.ceil(content.length / 72);
  return Math.min(2_400, Math.max(240, Math.max(lineCount, wrappedLineCount) * 28));
}

/** 独占一行的来源链接样式：跟着上下文取色（引用块里即为弱化色），只用点线下划线提示可跳转。 */
const CITATION_SOURCE_LINK_CLASSES = `
  inline-flex items-baseline gap-0.5 align-baseline
  underline decoration-dotted decoration-from-font underline-offset-4
  transition-colors hover:text-foreground focus-visible:text-foreground
`;

/**
 * hast 子树的最小节点形状。
 * 本仓没有装 `@types/hast` 的顶层软链，`import type { Element } from 'hast'` 解析不到；
 * 这里只用到判定来源行需要的几个字段，结构化匹配 react-markdown 传进来的 `node`。
 */
interface MarkdownNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

/** 收集 hast 子树里的可见文字，用于取回链接的原始标题。 */
function collectNodeText(nodes: readonly MarkdownNode[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' ? (node.value ?? '') : collectNodeText(node.children ?? []),
    )
    .join('');
}

/**
 * 判断一个段落是否整段只有一条命中来源的链接，并取出渲染来源行所需的信息。
 *
 * @param nodes 段落的 hast 子节点
 * @param citationByURL 归一化 URL → 来源与下标
 * @returns 来源行信息；段落还有别的内容或链接没命中来源时返回 undefined
 */
function soleCitationSource(
  nodes: readonly MarkdownNode[] | undefined,
  citationByURL: Map<string, { citation: Citation; index: number }>,
): { citation: Citation; index: number; href: string; title: string } | undefined {
  const visible = (nodes ?? []).filter((node) => node.type !== 'text' || node.value?.trim());
  if (visible.length !== 1) return undefined;
  const [only] = visible;
  if (only.type !== 'element' || only.tagName !== 'a') return undefined;
  const href = only.properties?.href;
  if (typeof href !== 'string') return undefined;
  const hit = citationByURL.get(citationURLKey(href));
  const safeHref = hit ? safeCitationHref(hit.citation.url) : undefined;
  if (!hit || !safeHref) return undefined;
  const text = collectNodeText(only.children ?? []).trim();
  return {
    citation: hit.citation,
    index: citationDisplayIndex(hit.citation, hit.index),
    href: safeHref,
    title: text || hit.citation.title?.trim() || citationDomain(hit.citation.url),
  };
}

/** 为 Markdown 链接增加安全跳转，并把命中 citations 的链接渲染为同号数字角标。 */
function createMarkdownComponents(
  citations: Citation[],
  onCitationActivate?: (citation: Citation, index: number) => void,
): Components {
  // 连带下标一起存：后端未下发 ref 的老数据要靠它回退出编号（见 citationDisplayIndex）。
  const citationByURL = new Map(
    citations.map((citation, index) => [citationURLKey(citation.url), { citation, index }]),
  );

  return {
    /*
      整段只有一条来源链接时保留标题，不压成裸角标。

      提示词要求模型把链接跟在它支撑的论断后面，但模型常常改成单独列一行来源
      （实测多为 `> [标题](url)`）。这种独占一行的链接若照行内规则压成角标，整行就只剩一个
      灰色数字，标题和可读信息全丢；此时把角标提到行首、标题照原样展示。
    */
    p({ node, children, ...props }) {
      const source = soleCitationSource(node?.children, citationByURL);
      if (!source) return <p {...props}>{children}</p>;
      return (
        <p {...props}>
          <CitationBadge
            citation={source.citation}
            index={source.index}
            onActivate={
              onCitationActivate
                ? () => onCitationActivate(source.citation, source.index)
                : undefined
            }
          />{' '}
          <a
            href={source.href}
            target="_blank"
            rel="noopener noreferrer"
            data-citation-source
            className={cn(CITATION_SOURCE_LINK_CLASSES)}
          >
            <span>{source.title}</span>
            <ArrowUpRight className="size-3 shrink-0 self-center opacity-60" aria-hidden="true" />
          </a>
        </p>
      );
    },
    a({ href, children }) {
      const hit = href ? citationByURL.get(citationURLKey(href)) : undefined;
      if (hit) {
        const displayIndex = citationDisplayIndex(hit.citation, hit.index);
        return (
          <CitationBadge
            citation={hit.citation}
            index={displayIndex}
            onActivate={
              onCitationActivate ? () => onCitationActivate(hit.citation, displayIndex) : undefined
            }
          />
        );
      }

      const safeHref = href ? safeCitationHref(href) : undefined;
      if (!safeHref) {
        return <span>{children}</span>;
      }
      return (
        <a href={safeHref} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };
}
