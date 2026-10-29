export type StreamTextKind = 'content' | 'reasoning';

type QueuedText = {
  kind: StreamTextKind;
  units: string[];
  offset: number;
};

type StreamTextEmitter = (kind: StreamTextKind, delta: string) => void;

const STREAM_TICK_MS = 16;
const BACKLOG_BURST_THRESHOLD = 64;
const BACKLOG_BURST_UNITS = 16;
const HEAVY_BACKLOG_THRESHOLD = 512;
const HEAVY_BACKLOG_BURST_UNITS = 64;

/**
 * Smooths protocol-sized deltas into small UI updates. This is only a
 * presentation queue: the server must still release content only after
 * moderation has allowed it.
 */
export function createStreamTextQueue(emit: StreamTextEmitter) {
  const queue: QueuedText[] = [];
  let queueHead = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drained: (() => void) | undefined;
  let stopped = false;
  let finished = false;
  let finishing = false;
  let pendingUnitCount = 0;

  const hasPending = (): boolean => queueHead < queue.length;

  const compactQueue = (): void => {
    if (queueHead === queue.length) {
      queue.length = 0;
      queueHead = 0;
      return;
    }
    if (queueHead > 64 && queueHead * 2 >= queue.length) {
      queue.splice(0, queueHead);
      queueHead = 0;
    }
  };

  const emitAll = (): void => {
    while (hasPending()) {
      const current = queue[queueHead];
      queueHead += 1;
      const remaining = current.units.slice(current.offset).join('');
      if (remaining) emit(current.kind, remaining);
    }
    queue.length = 0;
    queueHead = 0;
    pendingUnitCount = 0;
  };

  const schedule = (): void => {
    if (stopped || timer !== undefined || !hasPending()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (finishing) {
        emitAll();
        if (drained) {
          const callback = drained;
          drained = undefined;
          callback();
        }
        return;
      }

      const burst =
        pendingUnitCount >= HEAVY_BACKLOG_THRESHOLD
          ? HEAVY_BACKLOG_BURST_UNITS
          : pendingUnitCount >= BACKLOG_BURST_THRESHOLD
            ? BACKLOG_BURST_UNITS
            : 1;
      let emitted = 0;
      while (emitted < burst && hasPending()) {
        const current = queue[queueHead];
        if (current.offset >= current.units.length) {
          queueHead += 1;
          continue;
        }
        const take = Math.min(burst - emitted, current.units.length - current.offset);
        const delta = current.units.slice(current.offset, current.offset + take).join('');
        emit(current.kind, delta);
        current.offset += take;
        pendingUnitCount -= take;
        emitted += take;
        if (current.offset >= current.units.length) queueHead += 1;
      }
      compactQueue();
      if (hasPending()) {
        schedule();
      } else if (drained) {
        const callback = drained;
        drained = undefined;
        callback();
      }
    }, STREAM_TICK_MS);
  };

  return {
    enqueue(kind: StreamTextKind, text: string): void {
      if (stopped || finished || !text) return;
      const units = Array.from(text);
      queue.push({ kind, units, offset: 0 });
      pendingUnitCount += units.length;
      schedule();
    },

    finish(onDrained: () => void): void {
      if (stopped || finished) return;
      finished = true;
      drained = onDrained;
      finishing = true;
      if (!hasPending()) {
        drained = undefined;
        onDrained();
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      emitAll();
      const callback = drained;
      drained = undefined;
      callback?.();
    },

    cancel(): void {
      stopped = true;
      finished = true;
      finishing = false;
      queue.length = 0;
      pendingUnitCount = 0;
      drained = undefined;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
