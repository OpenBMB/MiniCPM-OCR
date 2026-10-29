/**
 * Markdown renderer.
 *
 * Purpose: render an assistant reply's markdown body, with GFM (tables/strikethrough/task lists), syntax highlighting for code blocks, and math (`$...$` inline / `$$...$$` display, via remark-math + KaTeX). Highlighting uses highlight.js (synchronous and naturally integrated with the rehype pipeline, so streaming re-renders do not flash asynchronously).
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
  /** markdown source text */
  content: string;
  /**
   * Render scene.
   * - `default`: conversation body;
   * - `reasoning`: reasoning, with tighter type size, spacing, and muted color;
   * - `document`: a full-page document result (image parse). Tables use a single-layer rectangular grid, and task lists draw their own checkboxes.
   */
  variant?: 'default' | 'reasoning' | 'document';
  /** Whether generation is still streaming; while streaming, render only explicit and already-closed math delimiters. */
  streaming?: boolean;
  /** Source range of the selected OCR block, for highlighting in the document preview. */
  highlightRange?: ImageParseTextRange;
  /** Web citations for the current answer, used to enhance matching Markdown links into source labels. */
  citations?: Citation[];
  /**
   * Callback when a body badge is clicked (index starting at 1, the same number as the source panel).
   * It must be a stable reference: it is a useMemo dependency of `createMarkdownComponents`, and a new one on every render re-renders the whole body.
   */
  onCitationActivate?: (citation: Citation, index: number) => void;
  /** OCR blocks that can be located on the original image; pass them only when the service provides a valid mapping. */
  linkedRanges?: readonly ImageParseLinkedRange[];
  /** Placeholder images cropped from the OCR original, used only in the document preview and not written back into Markdown. */
  imageCrops?: readonly string[];
  /** Add a double-click edit entry on sanitized top-level nodes. */
  editableBlocks?: boolean;
}

/** Only completed answers longer than this are parsed lazily, so short answers do not show a perceptible loading placeholder. */
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
  Clear the bottom margin on the last element ([&>*:last-child]:mb-0): margins between block siblings collapse, so this 8px is normally eaten by the following element's mt and is invisible. The source chip is inline-flex (it has to shrink into a pill), and an inline-level box does not participate in collapsing, so a stretch of space appears above it for nothing — the same body gives two spacings depending on what follows. Spacing should be decided by the parent; the renderer is only responsible for its internal rhythm.
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
  pre-wrap must sink into `p` and must not hang on the container. Both of these have to hold:

  - In reasoning text the model often breaks lines with a single newline. Those soft breaks land inside paragraphs and have to be kept with pre-wrap;
  - react-markdown emits a newline text node between adjacent block elements (between `</p>` and `<p>`). Once the container is pre-wrap, that separator becomes a real hard break — an empty line appears between paragraphs from nowhere (leading-6 is 24px), pushing the 6px of my-1.5 up to 30px, so it reads as if every paragraph were separated into its own block.

  The container keeps the default whitespace collapse, so the separator is invisible; pre-wrap only covers the inside of paragraphs.
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
 * Document typography. The three key differences from conversation body are all so a full-page OCR result reads as a document rather than a reply:
 *
 * 1. Headings layer by type size and whitespace, and no longer draw rules — an h1/h2 each carrying a line, stacked on the original `---`, would slice the page into strips;
 * 2. Body text is pressed to 80% foreground, while headings and bold stay pure foreground — hierarchy is carried by the lightness difference;
 * 3. Tables use a full cell grid with a light header background (see DOCUMENT_COMPONENTS). Merged rows and columns keep the HTML structure.
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
 * Document table scroll container: grid borders are drawn by the cells, so an outer frame is not stacked on top.
 *
 * Wrap a layer instead of letting the table scroll itself — a table's overflow is visible by spec, and a wide table would burst the comparison column. Selection uses an outer outline and does not change the grid size or cover cells.
 * @param children Table row content
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
 * Document task-list checkbox.
 *
 * GFM produces a `disabled` native input, and the browser paints it as a gray check — on the result page that is a recognition result, not a broken form control, so it is drawn as a custom box. Checkbox semantics are kept for screen readers.
 * @param type Original input type; Markdown only generates checkbox
 * @param checked Whether it is checked
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

/** Node overrides enabled only for document typography; conversation body keeps native rendering so existing bubble styles are unaffected. */
const DOCUMENT_COMPONENTS: Components = {
  table: DocumentTable,
  input: DocumentCheckbox,
  div: ImageParseMarkdownBlock,
};

/** Filter OCR HTML first, then add location markers; keep merged cells and the formula class names KaTeX parses. */
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
 * Decides whether an answer should be rendered lazily by scroll position.
 * @param contentLength markdown character count
 * @param streaming Whether generation is still streaming
 * @returns Whether rendering should be deferred
 */
export function shouldDeferMarkdown(contentLength: number, streaming: boolean): boolean {
  return !streaming && contentLength > LAZY_MARKDOWN_THRESHOLD;
}

/** Scene → typography class map. */
const VARIANT_CLASSES = {
  default: DEFAULT_MARKDOWN_CLASSES,
  reasoning: REASONING_MARKDOWN_CLASSES,
  document: DOCUMENT_MARKDOWN_CLASSES,
} as const;

/**
 * Renders markdown. Prose typography classes plus semantic tokens control color.
 * memo: on high-frequency streaming updates, re-render only when content changes.
 * @param content markdown source text
 * @param variant Body or reasoning style
 * @param streaming Whether generation is still streaming
 * @param citations Web citations for the current answer
 * @param onCitationActivate Callback when a body badge is clicked
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
  // First rewrite a bare badge such as `[1]` that the model occasionally emits into a Markdown link, so the body renderer only has to handle `a`.
  // Document typography must keep the original text: OCR block positions and image placeholders depend on the original offsets, and a badge rewrite must not change the length.
  const linkified = useMemo(
    () => (variant === 'document' ? content : linkifyCitationMarkers(content, citations)),
    [citations, content, variant],
  );
  // A streaming prefix keeps changing. Do not guess formulas in unmarked text, or a KaTeX node mounts briefly and is then unmounted.
  // OCR displays the document faithfully; phone numbers and identifiers must not be rewritten by the chat scene's bare-formula inference.
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
  // Badge enhancement is only for conversation body; document typography keeps using the node overrides that stay faithful to the original.
  const baseComponents = useMemo(
    () => createMarkdownComponents(citations, onCitationActivate),
    [citations, onCitationActivate],
  );
  // Document typography does not inherit badge enhancement: an OCR document has no citations, and links must keep rendering as sanitized originals
  // (badge rendering turns <a> into a source label and breaks the meaning of "display the document faithfully").
  const documentComponents = useMemo<Components>(
    () => ({
      ...DOCUMENT_COMPONENTS,
      // Explicit fallback: links in the document preview allow only http/https, and every other protocol has its href removed.
      // react-markdown's defaultUrlTransform and rehype-sanitize are still the first line of defense; this does not depend on them.
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
          // Parse HTML only in the OCR document preview; do not trust scripts, attributes, or location markers supplied by the model.
          ...(variant === 'document' ? DOCUMENT_HTML_PLUGINS : []),
          [() => imageParseDocumentBlockMarkers(editBlocks)],
          [imageParseHighlight, normalizedRange, normalizedLinkedRanges, variant === 'document'],
          [rehypeHighlight, { detect: true }],
          // KaTeX disables trusted commands for model input and limits resource use; the plugin itself is responsible for falling back when parsing fails.
          [rehypeKatex, SAFE_KATEX_OPTIONS],
        ]}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
});

interface LazyMarkdownRendererProps {
  /** markdown source text */
  content: string;
  /** Whether generation is still streaming; a streaming answer must render immediately. */
  streaming?: boolean;
  /** Web citations for the current answer. */
  citations?: Citation[];
  /** Callback when a body badge is clicked. It must be a stable reference and is passed through to MarkdownRenderer. */
  onCitationActivate?: (citation: Citation, index: number) => void;
}

/**
 * Lazy renderer for long answers: before entering the viewport it keeps only an estimated height, and near the viewport it runs Markdown, code highlighting, and formula parsing.
 * @param content markdown source text
 * @param streaming Whether generation is still streaming
 * @param citations Web citations for the current answer
 * @param onCitationActivate Callback when a body badge is clicked
 * @returns Lazily rendered Markdown content
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

/** Estimates the placeholder height of unrendered Markdown, reducing layout shift while scrolling. */
function estimateMarkdownHeight(content: string): number {
  const lineCount = content.split(/\r?\n/).length;
  const wrappedLineCount = Math.ceil(content.length / 72);
  return Math.min(2_400, Math.max(240, Math.max(lineCount, wrappedLineCount) * 28));
}

/** Style for a source link that occupies its own line: take color from context (muted inside a quote), and use only a dotted underline to show it can be followed. */
const CITATION_SOURCE_LINK_CLASSES = `
  inline-flex items-baseline gap-0.5 align-baseline
  underline decoration-dotted decoration-from-font underline-offset-4
  transition-colors hover:text-foreground focus-visible:text-foreground
`;

/**
 * Minimal node shape for a hast subtree.
 * This repo has no top-level symlink for `@types/hast`, so `import type { Element } from 'hast'` does not resolve; only the few fields needed to decide a source row are used here, structurally matching the `node` passed in by react-markdown.
 */
interface MarkdownNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

/** Collect visible text in a hast subtree, used to recover a link's original title. */
function collectNodeText(nodes: readonly MarkdownNode[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' ? (node.value ?? '') : collectNodeText(node.children ?? []),
    )
    .join('');
}

/**
 * Decide whether a paragraph is entirely one link that matches a source, and take the information needed to render a source row.
 *
 * @param nodes The paragraph's hast child nodes
 * @param citationByURL Normalized URL → source and index
 * @returns Source-row information; undefined when the paragraph has other content or the link misses a source
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

/** Add a safe navigation to Markdown links, and render links that match citations as same-number digit badges. */
function createMarkdownComponents(
  citations: Citation[],
  onCitationActivate?: (citation: Citation, index: number) => void,
): Components {
  // Store the index along with it: old data that never received a ref from the backend falls back to a number from it (see citationDisplayIndex).
  const citationByURL = new Map(
    citations.map((citation, index) => [citationURLKey(citation.url), { citation, index }]),
  );

  return {
    /*
      When a whole paragraph is only one source link, keep the title and do not compress it into a bare badge.

      The prompt asks the model to put the link right after the claim it supports, but the model often lists the source on its own line instead (in practice usually `> [title](url)`). If that full-line link is compressed into a badge by the inline rule, the line is left with only a gray number, and the title and readable information are all lost; in that case move the badge to the start of the line and show the title as-is.
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
