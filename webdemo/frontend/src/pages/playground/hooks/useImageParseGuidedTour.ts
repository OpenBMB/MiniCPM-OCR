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
  /** 首屏身份、历史与当前文档初始化结束后才自动启动。 */
  ready?: boolean;
  hasDocument?: boolean;
  /** 当前阶段可展示目标；不同任务可分别表示配置就绪或结果就绪。 */
  resultReady?: boolean;
  /** 上传失败、识别失败或用户停止时，取消自动恢复。 */
  failed?: boolean;
  gateSelectors: readonly string[];
  buildSteps: (hasDocument: () => boolean) => DriveStep[];
}

/**
 * 图像解析任务共用的首次引导生命周期，负责任务状态暂停、恢复与已读记录。
 * @param options 引导标识、步骤构造和当前任务状态
 * @returns 手动重播引导的入口
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
        // 动画尚未完成时 driver 不一定触发 onDestroyed，用户关闭必须在此清理。
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

  // 语言变化更新下次启动的步骤，不中途销毁引导。
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
  // 程序化清理不走用户关闭钩子，避免切页或账号切换被误记为已读。
  useEffect(() => stop, [enabled, userId, tourId, stop]);

  // 上传/识别时移除遮罩，保留步骤；只在当前任务目标就绪后恢复。
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
    // 等首屏布局稳定再弹，避免遮罩跟着布局抖动。
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
  /** 手动重播忽略已读记录，初始化中则等页面就绪。 */
  const replay = useCallback(() => {
    if (!enabled || !userId) return;
    stop();
    if (!ready || (hasDocument && !resultReady)) pendingReplay.current = true;
    else startRef.current();
  }, [enabled, userId, ready, hasDocument, resultReady, stop]);
  return { replay };
}
