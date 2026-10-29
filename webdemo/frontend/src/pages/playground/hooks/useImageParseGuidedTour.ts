import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { driver, type Driver, type DriveStep } from 'driver.js';
import { trackImageParseTourLayout } from '../utils/imageParseTourLayout';
import { clearTourStepHighlight, syncTourStepHighlight } from '../utils/imageParseTourSettings';
import { useImageParseTourSeen } from './useImageParseTourSeen';
import { useImageParseTourMenus } from './useImageParseTourMenus';

import 'driver.js/dist/driver.css';
import '../utils/imageParseTourStyles.css';

export interface UseImageParseGuidedTourOptions {
  tourId: string;
  userId?: string;
  enabled: boolean;
  /** Start automatically only after first-screen identity, history, and the current document have finished initializing. */
  ready?: boolean;
  hasDocument?: boolean;
  /** Targets the current phase can show; different tasks may mean configuration ready or result ready. */
  resultReady?: boolean;
  /** Cancel automatic resume when upload fails, recognition fails, or the user stops. */
  failed?: boolean;
  gateSelectors: readonly string[];
  buildSteps: (hasDocument: () => boolean) => DriveStep[];
}

/**
 * Shared first-visit tour lifecycle for image-parsing tasks, responsible for pausing and resuming on task state, and for the seen record.
 * @param options tour id, step builder, and current task state
 * @returns the entry that replays the tour manually
 */
export function useImageParseGuidedTour({
  tourId,
  userId,
  enabled,
  ready = true,
  hasDocument = false,
  resultReady = hasDocument,
  failed = false,
  gateSelectors,
  buildSteps,
}: UseImageParseGuidedTourOptions) {
  const { t } = useTranslation('playground');
  const { seen, markSeen } = useImageParseTourSeen(tourId, userId);
  const documentRef = useRef(hasDocument);
  const tourRef = useRef<Driver | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const stopLayoutTracking = useRef(() => {});
  const pendingReplay = useRef(false);
  const pausedTour = useRef<{ instance: Driver; index: number } | null>(null);
  const interrupted = useRef(false);
  const { close: closeAutoOpenedMenu, open: openMenuForStep } = useImageParseTourMenus();

  const start = useCallback(() => {
    const tour = driver({
      steps: buildSteps(() => documentRef.current),
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: t('imageParseTourNext'),
      prevBtnText: t('imageParseTourPrev'),
      doneBtnText: t('imageParseTourDone'),
      popoverClass: 'map-tour-popover',
      stagePadding: 4,
      stageRadius: 6,
      popoverOffset: 10,
      onHighlightStarted: (element, _step, { driver: instance }) => {
        stopLayoutTracking.current();
        syncTourStepHighlight(element, instance);
      },
      onHighlighted: (element, _step, { driver: instance }) => {
        closeAutoOpenedMenu();
        openMenuForStep(element);
        stopLayoutTracking.current = trackImageParseTourLayout(instance);
      },
      onDestroyStarted: (_element, _step, { driver: instance }) => {
        if (tourRef.current !== instance) return;
        closeAutoOpenedMenu();
        clearTourStepHighlight();
        stopLayoutTracking.current();
        markSeen();
        // Before the animation finishes, driver may not fire onDestroyed; a user close must clean up here.
        tourRef.current = null;
        instance.destroy();
      },
      onDestroyed: () => {
        closeAutoOpenedMenu();
        clearTourStepHighlight();
        stopLayoutTracking.current();
        if (tourRef.current === tour) tourRef.current = null;
      },
    });
    tourRef.current = tour;
    tour.drive();
  }, [buildSteps, closeAutoOpenedMenu, markSeen, openMenuForStep, t]);

  // A language change updates the steps for the next start, and does not destroy the tour halfway.
  const startRef = useRef(start);
  useLayoutEffect(() => {
    documentRef.current = hasDocument;
    startRef.current = start;
  }, [hasDocument, start]);
  const stop = useCallback(() => {
    closeAutoOpenedMenu();
    clearTourStepHighlight();
    stopLayoutTracking.current();
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    pendingReplay.current = false;
    pausedTour.current = null;
    interrupted.current = false;
    const active = tourRef.current;
    tourRef.current = null;
    active?.destroy();
  }, [closeAutoOpenedMenu]);
  // Programmatic cleanup does not go through the user-close hook, so changing pages or accounts is not recorded as seen by mistake.
  useEffect(() => stop, [enabled, userId, tourId, stop]);

  // While uploading or recognizing, remove the mask and keep the step; resume only after the current task's target is ready.
  useEffect(() => {
    if (!enabled || !userId) return;
    if (failed) {
      stop();
      interrupted.current = true;
      return;
    }
    const active = tourRef.current;
    if (!ready || (hasDocument && !resultReady)) {
      if (active?.isActive()) {
        pausedTour.current = { instance: active, index: active.getActiveIndex() ?? 0 };
        tourRef.current = null;
        closeAutoOpenedMenu();
        stopLayoutTracking.current();
        active.destroy();
      }
      return;
    }
    const paused = pausedTour.current;
    const instance = paused?.instance ?? active;
    if (!instance) return;
    let index = paused?.index ?? instance.getActiveIndex() ?? 0;
    const atGate = gateSelectors.includes(String(instance.getConfig().steps?.[index]?.element));
    if (hasDocument && resultReady && atGate) index++;
    if (paused) {
      pausedTour.current = null;
      tourRef.current = instance;
      instance.drive(index);
    } else if (hasDocument && resultReady && atGate) instance.moveNext();
  }, [
    enabled,
    userId,
    ready,
    hasDocument,
    resultReady,
    failed,
    gateSelectors,
    stop,
    closeAutoOpenedMenu,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !userId ||
      !ready ||
      failed ||
      interrupted.current ||
      pausedTour.current ||
      (hasDocument && !resultReady) ||
      (seen && !pendingReplay.current) ||
      tourRef.current?.isActive()
    )
      return;
    // Wait for the first-screen layout to settle before popping, so the mask does not jitter with the layout.
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      pendingReplay.current = false;
      startRef.current();
    }, 400);
    return () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [enabled, userId, ready, hasDocument, resultReady, failed, seen]);
  /** A manual replay ignores the seen record, and waits for the page to be ready if initialization is still in progress. */
  const replay = useCallback(() => {
    if (!enabled || !userId) return;
    stop();
    if (!ready || (hasDocument && !resultReady)) pendingReplay.current = true;
    else startRef.current();
  }, [enabled, userId, ready, hasDocument, resultReady, stop]);
  return { replay };
}
