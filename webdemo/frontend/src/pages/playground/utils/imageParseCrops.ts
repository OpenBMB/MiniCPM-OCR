import type { ImageParseLayoutBlock, ImageParseRotationInfo } from './imageParseSample';

const IMAGE_KINDS = new Set(['image', 'chart', 'seal']);
const PLACEHOLDER = /!\[image\]\(\)/g;
const IMAGE_MARKUP = /!\[image\]\((?:<([^>\r\n]*)>|([^)]*))\)/g;

/** Illustration positions in the body that need a crop from the original image. http(s) and data URLs are left as-is. */
export function unservedImagePlaceholderOffsets(markdown: string): number[] {
  const offsets: number[] = [];
  for (const match of markdown.matchAll(IMAGE_MARKUP)) {
    const target = (match[1] ?? match[2] ?? '').trim();
    if (/^(?:https?:|data:)/i.test(target)) continue;
    if (match.index !== undefined) offsets.push(match.index);
  }
  return offsets;
}

/** Charts and seals that have text show that text in the body; they are replaced with an original-image placeholder only when display is turned off. */
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

/** Full crop set used when showing seal images; footer images have no body placeholder and are not included. */
export function imageParseAllCropBlocks(
  blocks: readonly ImageParseLayoutBlock[],
): ImageParseLayoutBlock[] {
  return blocks.filter((block) => IMAGE_KINDS.has(block.kind) && !isFooterImage(block));
}

/**
 * `![image]()` in the body corresponds to these blocks in reading order.
 * Seals and charts that have text correspond to the body and do not take part in image-placeholder pairing.
 * header_image, footer_image, and image all need a picture. If the server omitted a footer-image placeholder, drop it before pairing when the counts disagree, so another image is not pasted in the wrong place.
 * If they still disagree, do not guess, so an image is not pasted onto the wrong block.
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
 * Pair placeholders already in the service body with image blocks.
 * Seals and charts that have text correspond to the body; the server usually does not write a placeholder for an empty seal,
 * so when the counts disagree, exclude empty seals first,
 * then let the compatibility layer write seal placeholders, so an existing image placeholder is not mismatched to a seal.
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

/** When the placeholder count and the number of displayable image blocks disagree, do not guess the pairing, so another image is not pasted onto the wrong block. */
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
  // jsdom and some old browsers have no decode; cropping is an enhancement, and on failure the text and coordinates are kept.
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
