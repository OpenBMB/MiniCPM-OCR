import type { ImageParseLayoutBlock, ImageParseRotationInfo } from './imageParseSample';

const IMAGE_KINDS = new Set(['image', 'chart', 'seal']);
const PLACEHOLDER = /!\[image\]\(\)/g;
const IMAGE_MARKUP = /!\[image\]\((?:<([^>\r\n]*)>|([^)]*))\)/g;

/** 正文里需要用原图裁切补上的插图位置。http(s) 和 data URL 保持原样。 */
export function unservedImagePlaceholderOffsets(markdown: string): number[] {
  const offsets: number[] = [];
  for (const match of markdown.matchAll(IMAGE_MARKUP)) {
    const target = (match[1] ?? match[2] ?? '').trim();
    if (/^(?:https?:|data:)/i.test(target)) continue;
    if (match.index !== undefined) offsets.push(match.index);
  }
  return offsets;
}

/** 图表与有文字印章在正文里显示文字；关闭展示时才替换为原图占位符。 */
export function isImageParseDisplayTextBlock(block: ImageParseLayoutBlock): boolean {
  return (block.kind === 'chart' || block.kind === 'seal') && Boolean(block.text.trim());
}

function pictureBlocks(blocks: readonly ImageParseLayoutBlock[]): ImageParseLayoutBlock[] {
  return blocks.filter(
    (block) => IMAGE_KINDS.has(block.kind) && !isImageParseDisplayTextBlock(block),
  );
}

function isFooterImage(block: ImageParseLayoutBlock): boolean {
  return (block.label ?? '').toLowerCase() === 'footer_image';
}

function isEmptySeal(block: ImageParseLayoutBlock): boolean {
  return block.kind === 'seal' && !block.text.trim();
}

/** 展示印章图片时使用的完整裁图集合；页脚图没有正文占位符，不纳入集合。 */
export function imageParseAllCropBlocks(
  blocks: readonly ImageParseLayoutBlock[],
): ImageParseLayoutBlock[] {
  return blocks.filter((block) => IMAGE_KINDS.has(block.kind) && !isFooterImage(block));
}

/**
 * 正文里的 ![image]() 按阅读顺序对应这些块。
 * 有文字的印章和图表对应正文，不参与图片占位符配对。
 * header_image、footer_image 和 image 一样要出图。服务端若漏了页脚图占位符，数量对不上时先去掉它再配，避免把别的图贴错。
 * 还是对不上就不猜，避免把图贴到错误的块上。
 */
export function imageParseCropBlocks(
  blocks: readonly ImageParseLayoutBlock[],
  placeholderCount: number,
): ImageParseLayoutBlock[] {
  const pictures = pictureBlocks(blocks);
  if (pictures.length === placeholderCount) return pictures;
  const withoutFooter = pictures.filter((block) => !isFooterImage(block));
  return withoutFooter.length === placeholderCount ? withoutFooter : [];
}

/**
 * 服务正文已有占位符与图片块配对。
 * 有文字的印章和图表对应正文；服务端通常不会为空印章写占位符，
 * 因此数量对不上时先排除空印章，
 * 再由兼容层补写印章占位符，避免把已有图片占位符错配给印章。
 */
export function imageParseMarkdownCropBlocks(
  blocks: readonly ImageParseLayoutBlock[],
  placeholderCount: number,
): ImageParseLayoutBlock[] {
  const pictures = pictureBlocks(blocks);
  if (pictures.length === placeholderCount) return pictures;
  const withoutEmptySeals = pictures.filter((block) => !isEmptySeal(block));
  if (withoutEmptySeals.length === placeholderCount) return withoutEmptySeals;
  const withoutFooter = pictures.filter((block) => !isFooterImage(block));
  if (withoutFooter.length === placeholderCount) return withoutFooter;
  const withoutOmitted = withoutFooter.filter((block) => !isEmptySeal(block));
  return withoutOmitted.length === placeholderCount ? withoutOmitted : [];
}

/** 占位符数量与可显示图块数量不一致时不猜测配对，避免把别的图贴到错误块上。 */
export async function imageParseCrops(
  markdown: string,
  blocks: readonly ImageParseLayoutBlock[],
  original: string,
  signal: AbortSignal,
  rotation?: ImageParseRotationInfo,
  options?: { allPictures?: boolean },
): Promise<string[]> {
  const count = [...markdown.matchAll(PLACEHOLDER)].length;
  const eligible = options?.allPictures
    ? imageParseAllCropBlocks(blocks)
    : imageParseCropBlocks(blocks, count);
  const remote = /^https?:\/\//i.test(original);
  if (
    (!options?.allPictures && (!count || count !== eligible.length)) ||
    (options?.allPictures && !eligible.length) ||
    count > 60 ||
    (!/^data:image\/[^;,]+;base64,/.test(original) && !remote)
  )
    return [];
  const image = new Image();
  if (remote) image.crossOrigin = 'anonymous';
  image.src = original;
  // jsdom 与部分旧浏览器没有 decode；裁图是增强能力，失败时保留文字与坐标。
  if (typeof image.decode !== 'function') return [];
  try {
    await image.decode();
  } catch {
    return [];
  }
  signal.throwIfAborted();
  const angle =
    rotation?.enabled && rotation.applied && Number.isFinite(rotation.totalAngle)
      ? rotation.totalAngle
      : 0;
  let source: CanvasImageSource = image;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (angle) {
    const radians = (angle * Math.PI) / 180;
    const width =
      image.naturalWidth * Math.abs(Math.cos(radians)) +
      image.naturalHeight * Math.abs(Math.sin(radians));
    const height =
      image.naturalWidth * Math.abs(Math.sin(radians)) +
      image.naturalHeight * Math.abs(Math.cos(radians));
    const upright = document.createElement('canvas');
    upright.width = Math.max(1, Math.round(width));
    upright.height = Math.max(1, Math.round(height));
    const context = upright.getContext('2d');
    if (!context) return [];
    context.translate(upright.width / 2, upright.height / 2);
    context.rotate(-radians);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    source = upright;
    sourceWidth = upright.width;
    sourceHeight = upright.height;
  }
  return eligible.map((block) => {
    const canvas = document.createElement('canvas');
    const x = Math.round(block.x * sourceWidth);
    const y = Math.round(block.y * sourceHeight);
    canvas.width = Math.max(1, Math.min(sourceWidth - x, Math.round(block.w * sourceWidth)));
    canvas.height = Math.max(1, Math.min(sourceHeight - y, Math.round(block.h * sourceHeight)));
    canvas
      .getContext('2d')
      ?.drawImage(source, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  });
}
