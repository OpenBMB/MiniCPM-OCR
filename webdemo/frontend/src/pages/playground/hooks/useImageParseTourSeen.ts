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
 * Read and write the tour-seen record bound to the current user.
 * A history record may carry a version number; if the same user has seen any version of the same family of tour, it counts as seen, so it does not pop again after a release.
 * @param tourId tour id
 * @param userId current user ID
 * @returns whether it has been seen, and the method that writes seen
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
      // Zustand updates memory first and then persists; when the browser refuses the write, that does not block closing or this session's seen judgment.
    }
  }, [seenId, setPlaygroundPrefs]);
  return { seen, markSeen };
}
