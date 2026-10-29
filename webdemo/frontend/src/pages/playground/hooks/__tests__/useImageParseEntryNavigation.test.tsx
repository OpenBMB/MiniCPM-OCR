import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useImageParseEntryNavigation } from '../useImageParseEntryNavigation';
import { readCurrentImageParseId } from '../../utils/imageParseCurrent';
import type { ImageParseHistoryEntry } from '../../utils/imageParseHistoryTypes';

const entry: ImageParseHistoryEntry = {
  id: 'kie-history',
  createdAt: 1,
  snapshot: {
    attachment: {
      id: 'invoice',
      kind: 'image',
      name: 'invoice.png',
      mime: 'image/png',
      size: 3,
      dataUrl: 'data:image/png;base64,AAA',
    },
    mode: 'kie',
    fields: ['金额'],
    markdown: '{"金额":"100"}',
    layout: [],
  },
};
const options: Parameters<typeof useImageParseEntryNavigation>[0] = {
  userId: 'user',
  projectId: 'project',
  task: 'standard' as const,
  startFresh: true,
};

describe('独立文档任务入口导航', () => {
  beforeEach(() => localStorage.clear());

  it('跨入口历史只写目标指针，路由不保存文件或正文，目标覆盖新建意图', () => {
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useImageParseEntryNavigation>[0]) => ({
        navigation: useImageParseEntryNavigation(props),
        location: useLocation(),
      }),
      {
        initialProps: options,
        wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    );
    expect(result.current.navigation.startFresh).toBe(true);
    act(() => result.current.navigation.openEntry(entry));
    const kieScope = JSON.stringify(['user', 'project', 'kie']);
    expect(result.current.location.pathname).toBe('/playground/field-extract');
    expect(result.current.location.state).toEqual({ restoreImageParseScope: kieScope });
    expect(readCurrentImageParseId(kieScope)).toBe('invoice');
    expect(readCurrentImageParseId(JSON.stringify(['user', 'project']))).toBeUndefined();
    rerender({ ...options, task: 'kie' });
    expect(result.current.navigation.startFresh).toBe(false);
    rerender({ ...options, task: 'kie', userId: 'other-user' });
    expect(result.current.navigation.startFresh).toBe(true);
    expect(readCurrentImageParseId(result.current.navigation.scope)).toBeUndefined();
  });

  it('返回全文识别沿用旧范围，刷新与直接进入可恢复当前任务', () => {
    const { result } = renderHook(
      () => ({
        navigation: useImageParseEntryNavigation({ ...options, task: 'kie', startFresh: false }),
        location: useLocation(),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>,
      },
    );
    act(() =>
      result.current.navigation.openEntry({
        ...entry,
        snapshot: { ...entry.snapshot, mode: 'standard' },
      }),
    );
    expect(result.current.location.pathname).toBe('/playground/document-parse');
    expect(readCurrentImageParseId(JSON.stringify(['user', 'project']))).toBe('invoice');
    expect(result.current.navigation.startFresh).toBe(false);
  });
});
