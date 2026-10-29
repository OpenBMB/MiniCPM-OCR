import { describe, expect, it } from 'vitest';

import { imageParseHighlight } from '../imageParseHighlight';

describe('OCR highlight range lookup', () => {
  it('should avoid comparing every node with every range in a long document', () => {
    let reads = 0;
    const linked = Array.from({ length: 300 }, (_, index) => ({
      id: `block-${index}`,
      range: {
        get start() {
          reads++;
          return index * 20;
        },
        get end() {
          reads++;
          return index * 20 + 10;
        },
      },
    }));
    const tree = {
      type: 'root',
      children: linked.map(({ id }, index) => ({
        type: 'element',
        tagName: 'p',
        properties: {} as Record<string, unknown>,
        position: { start: { offset: index * 20 }, end: { offset: index * 20 + 10 } },
        children: [{ type: 'text', value: id }],
      })),
    };
    imageParseHighlight(undefined, linked)(tree);
    expect(tree.children.map((node) => node.properties.dataOcrBlockId)).toEqual(
      linked.map(({ id }) => id),
    );
    expect(reads).toBeLessThan(10_000);
  });

  it('should preserve ambiguous, overlapping and unsorted mappings without guessing', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {} as Record<string, unknown>,
          position: { start: { offset: 20 }, end: { offset: 30 } },
        },
      ],
    };
    imageParseHighlight(undefined, [
      { id: 'later', range: { start: 25, end: 40 } },
      { id: 'earlier', range: { start: 0, end: 100 } },
      { id: 'unrelated', range: { start: 100, end: 110 } },
    ])(tree);
    expect(tree.children[0].properties.dataOcrLinkedIds).toBe('["later","earlier"]');
    expect(tree.children[0].properties.dataOcrBlockId).toBeUndefined();
  });
});
