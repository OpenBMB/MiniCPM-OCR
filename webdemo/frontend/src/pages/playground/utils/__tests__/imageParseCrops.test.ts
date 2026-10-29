import { afterEach, describe, expect, it, vi } from 'vitest';

import { imageParseCrops } from '../imageParseCrops';
import type { ImageParseLayoutBlock, ImageParseRotationInfo } from '../imageParseSample';

interface FakeCanvasContext {
  translate: (x: number, y: number) => void;
  rotate: (angle: number) => void;
  drawImage: (...args: unknown[]) => void;
}

interface FakeCanvas {
  width: number;
  height: number;
  context: FakeCanvasContext;
  getContext: () => FakeCanvasContext;
  operations: string[];
  toDataURL: () => string;
}

function createCanvasSpy() {
  const canvases: FakeCanvas[] = [];
  const createElement = vi.fn((tagName: string) => {
    if (tagName !== 'canvas') throw new Error(`unexpected element: ${tagName}`);
    const operations: string[] = [];
    const context: FakeCanvasContext = {
      translate: (x, y) => operations.push(`translate:${x},${y}`),
      rotate: (angle) => operations.push(`rotate:${angle}`),
      drawImage: (...args) => operations.push(`drawImage:${args.slice(1).join(',')}`),
    };
    const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      operations,
      context,
      getContext: () => context,
      toDataURL: () => {
        operations.push('toDataURL');
        return 'data:image/png;base64,CROP=';
      },
    };
    canvases.push(canvas);
    return canvas;
  });
  return { canvases, createElement };
}

const rotation = (totalAngle: number): ImageParseRotationInfo => ({
  enabled: true,
  applied: true,
  totalAngle,
  predictedAngle: totalAngle,
  predictedScore: 0.97,
  confirmed: true,
  orientationAngle: totalAngle,
  deskewAngle: 0,
  skippedReason: null,
});

const imageBlock = (label: string): ImageParseLayoutBlock => ({
  id: `ocr-${label}`,
  order: 0,
  label,
  kind: 'image',
  x: 0.2,
  y: 0.3,
  w: 0.2,
  h: 0.2,
  text: '',
  markdown: '',
  confidence: null,
  status: 'skipped_no_vlm',
});

const sealBlock = (): ImageParseLayoutBlock => ({
  ...imageBlock('seal'),
  kind: 'seal',
  status: 'skipped_seal',
});

describe('imageParseCrops', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('签链图片异步加载后仍能按摆正坐标恢复插图，使用匿名跨域加载', async () => {
    const { canvases, createElement } = createCanvasSpy();
    const sources: { src: string; crossOrigin: string | null }[] = [];
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 50;
      crossOrigin: string | null = null;
      set src(src: string) {
        sources.push({ src, crossOrigin: this.crossOrigin });
      }
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(document, 'createElement').mockImplementation(
      createElement as unknown as typeof document.createElement,
    );
    expect(
      await imageParseCrops(
        '![image]()',
        [imageBlock('image')],
        'https://files.example/signed.png',
        new AbortController().signal,
        rotation(-90),
      ),
    ).toEqual(['data:image/png;base64,CROP=']);
    expect(sources).toEqual([
      { src: 'https://files.example/signed.png', crossOrigin: 'anonymous' },
    ]);
    expect(canvases[0]).toMatchObject({ width: 50, height: 100 });
  });

  it('负角度也按服务端方向反向旋转，保证裁图使用摆正坐标', async () => {
    const { canvases, createElement } = createCanvasSpy();
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 50;
      src = '';
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(document, 'createElement').mockImplementation(
      createElement as unknown as typeof document.createElement,
    );

    const crops = await imageParseCrops(
      '![image]()',
      [imageBlock('image')],
      'data:image/png;base64,ORIGINAL=',
      new AbortController().signal,
      rotation(-90),
    );

    expect(crops).toEqual(['data:image/png;base64,CROP=']);
    expect(canvases[0]).toMatchObject({ width: 50, height: 100 });
    expect(canvases[0]!.operations).toEqual([
      'translate:25,50',
      `rotate:${Math.PI / 2}`,
      'drawImage:-50,-25',
    ]);
    expect(canvases[1]!.operations).toEqual(['drawImage:10,30,10,20,0,0,10,20', 'toDataURL']);
  });

  it('页脚图片同样参与裁图，不只支持 image/chart/seal 标签', async () => {
    const { createElement } = createCanvasSpy();
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 50;
      src = '';
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(document, 'createElement').mockImplementation(
      createElement as unknown as typeof document.createElement,
    );

    const crops = await imageParseCrops(
      '![image]()',
      [imageBlock('footer_image')],
      'data:image/png;base64,ORIGINAL=',
      new AbortController().signal,
    );

    expect(crops).toEqual(['data:image/png;base64,CROP=']);
  });

  it('没有识别文字的印章按版面坐标裁出原图', async () => {
    const { canvases, createElement } = createCanvasSpy();
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 50;
      src = '';
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(document, 'createElement').mockImplementation(
      createElement as unknown as typeof document.createElement,
    );

    const crops = await imageParseCrops(
      '![image]()',
      [sealBlock()],
      'data:image/png;base64,ORIGINAL=',
      new AbortController().signal,
    );

    expect(crops).toEqual(['data:image/png;base64,CROP=']);
    expect(canvases[0]!.operations).toEqual(['drawImage:20,15,20,10,0,0,20,10', 'toDataURL']);
  });

  it('开启旋转自适应时印章裁图先按摆正坐标旋转原图', async () => {
    const { canvases, createElement } = createCanvasSpy();
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 50;
      src = '';
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(document, 'createElement').mockImplementation(
      createElement as unknown as typeof document.createElement,
    );

    await imageParseCrops(
      '![image]()',
      [sealBlock()],
      'data:image/png;base64,ORIGINAL=',
      new AbortController().signal,
      rotation(-90),
    );

    expect(canvases[0]).toMatchObject({ width: 50, height: 100 });
    expect(canvases[1]!.operations).toEqual(['drawImage:10,30,10,20,0,0,10,20', 'toDataURL']);
  });

  it('关闭旋转自适应时印章裁图直接使用原始方向坐标', async () => {
    const { canvases, createElement } = createCanvasSpy();
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 50;
      src = '';
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(document, 'createElement').mockImplementation(
      createElement as unknown as typeof document.createElement,
    );

    await imageParseCrops(
      '![image]()',
      [sealBlock()],
      'data:image/png;base64,ORIGINAL=',
      new AbortController().signal,
      {
        ...rotation(-90),
        enabled: false,
        applied: false,
        totalAngle: 0,
        predictedAngle: null,
        predictedScore: null,
        confirmed: null,
        skippedReason: 'disabled',
      },
    );

    expect(canvases).toHaveLength(1);
    expect(canvases[0]!.operations).toEqual(['drawImage:20,15,20,10,0,0,20,10', 'toDataURL']);
  });

  it('header_image 与 image 都裁进预览，页脚图不占占位符', async () => {
    const { canvases, createElement } = createCanvasSpy();
    class FakeImage {
      naturalWidth = 100;
      naturalHeight = 100;
      src = '';
      decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(document, 'createElement').mockImplementation(
      createElement as unknown as typeof document.createElement,
    );
    const blockAt = (label: string, y: number): ImageParseLayoutBlock => ({
      ...imageBlock(label),
      id: label,
      y,
    });

    const crops = await imageParseCrops(
      '![image]()\n\n![image]()',
      [blockAt('header_image', 0.1), blockAt('footer_image', 0.8), blockAt('image', 0.4)],
      'data:image/png;base64,ORIGINAL=',
      new AbortController().signal,
    );

    expect(crops).toEqual(['data:image/png;base64,CROP=', 'data:image/png;base64,CROP=']);
    const drawn = canvases.map((canvas) =>
      canvas.operations.filter((op) => op.startsWith('drawImage:')),
    );
    expect(drawn).toEqual([
      ['drawImage:20,10,20,20,0,0,20,20'],
      ['drawImage:20,40,20,20,0,0,20,20'],
    ]);
  });
});
