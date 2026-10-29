/**
 * OCR 编辑器样式：正文和表格沿用主题色，宽表仅在自身容器内滚动。
 * 首尾节点使用更具体的选择器清除预览排版的外边距，单块编辑不重复增加段间留白。
 */
export const IMAGE_PARSE_RICH_EDITOR_CLASS = `
  px-4 py-3 text-sm leading-[1.85] text-foreground
  [&_.tiptap]:outline-none [&_.tiptap]:break-words
  [&_.tiptap>:first-child]:mt-0 [&_.tiptap>:last-child]:mb-0
  [&_p]:my-3 [&_h1]:my-5 [&_h1]:text-xl [&_h1]:font-semibold
  [&_h2]:my-4 [&_h2]:text-[15px] [&_h2]:font-semibold
  [&_h3]:my-3 [&_h3]:font-semibold
  [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5
  [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5
  [&_a]:text-primary [&_a]:underline
  [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3
  [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted/60 [&_pre]:p-3
  [&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1
  [&_.tableWrapper]:my-4 [&_.tableWrapper]:overflow-x-auto [&_.tableWrapper]:rounded-lg
  [&_.tableWrapper]:border [&_.tableWrapper]:border-border/70
  [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]
  [&_td]:relative [&_td]:min-w-24 [&_td]:border [&_td]:border-border [&_td]:px-4 [&_td]:py-2
  [&_th]:relative [&_th]:min-w-24 [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-4 [&_th]:py-2 [&_th]:text-left
  [&_td_p]:my-0 [&_th_p]:my-0 [&_.selectedCell]:bg-primary/10
  [&_.tiptap-mathematics-render]:inline-block [&_.tiptap-mathematics-render]:max-w-full [&_.tiptap-mathematics-render]:overflow-x-auto [&_.tiptap-mathematics-render]:overflow-y-hidden [&_.tiptap-mathematics-render]:rounded [&_.tiptap-mathematics-render]:bg-muted/30
  [&_.tiptap-mathematics-render_.katex]:w-max [&_.tiptap-mathematics-render_.katex]:max-w-none
  [&_.tiptap-mathematics-render]:px-1 [&_.tiptap-mathematics-render]:text-foreground
  [&_.tiptap-mathematics-render[data-type=block-math]]:my-4
  [&_.tiptap-mathematics-render[data-type=block-math]]:block
  [&_.tiptap-mathematics-render[data-type=block-math]]:max-w-full
  [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden
  [&_.katex-display_.katex]:w-max [&_.katex-display_.katex]:max-w-none
  [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0
  [&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:items-start [&_li[data-type=taskItem]]:gap-2
  [&_li[data-type=taskItem]>label]:mt-1.5 [&_li[data-type=taskItem]>div]:flex-1
  [&_input]:accent-primary [&_img]:max-w-full
`;
