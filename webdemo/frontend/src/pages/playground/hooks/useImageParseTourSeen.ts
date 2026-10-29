import { useCallback } from 'react';

import { useAppStore } from '@map/store';

function seenTourIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

interface SeenTourRecord {
  tourId: string;
  userId?: string;
}

function parseSeenTourRecord(value: string): SeenTourRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [tourId, recordUserId] = parsed;
  if (typeof tourId !== 'string') return undefined;
  if (recordUserId !== undefined && typeof recordUserId !== 'string') return undefined;
  return { tourId, userId: recordUserId };
}

function tourFamily(tourId: string): string {
  return tourId.split(':')[0];
}

function hasSeenTour(values: string[], tourId: string, userId?: string): boolean {
  const currentFamily = tourFamily(tourId);
  return values.some((value) => {
    const record = parseSeenTourRecord(value);
    return (
      record !== undefined &&
      record.userId === userId &&
      tourFamily(record.tourId) === currentFamily
    );
  });
}

/**
 * 读取并写入当前用户绑定的引导已读记录。
 * 历史记录可能带版本号；同一用户看过同族引导的任一版本即视为已读，避免发布后重复弹出。
 * @param tourId 引导标识
 * @param userId 当前用户 ID
 * @returns 是否已读与写入已读的方法
 */
export function useImageParseTourSeen(tourId: string, userId?: string) {
  const seenId = JSON.stringify([tourId, userId]);
  const seen = useAppStore((state) =>
    hasSeenTour(seenTourIds(state.playground.seenTours), tourId, userId),
  );
  const setPlaygroundPrefs = useAppStore((state) => state.setPlaygroundPrefs);
  const markSeen = useCallback(() => {
    const current = seenTourIds(useAppStore.getState().playground.seenTours);
    try {
      setPlaygroundPrefs({ seenTours: Array.from(new Set([...current, seenId])) });
    } catch {
      // Zustand 先更新内存再持久化；浏览器拒绝写入时不妨碍关闭及本次会话的已读判断。
    }
  }, [seenId, setPlaygroundPrefs]);
  return { seen, markSeen };
}
