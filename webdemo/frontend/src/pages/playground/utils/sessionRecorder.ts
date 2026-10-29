import { resamplePcm } from './pcmStream';

const RECORD_RATE = 16000;

export interface RecordingResult {
  blob: Blob;
  durationSec: number;
  sizeBytes: number;
}

interface RightEntry {
  offset: number;
  data: Float32Array;
}

export class SessionRecorder {
  private recording = false;
  private paused = false;
  private startedAt = 0;
  private leftChunks: Float32Array[] = [];
  private rightEntries: RightEntry[] = [];
  private rightNextOffset = 0;

  get active(): boolean {
    return this.recording;
  }

  start(): void {
    this.leftChunks = [];
    this.rightEntries = [];
    this.rightNextOffset = 0;
    this.startedAt = performance.now();
    this.paused = false;
    this.recording = true;
  }

  pause(): void {
    if (this.recording) this.paused = true;
  }

  resume(): void {
    if (this.recording) this.paused = false;
  }

  pushLeft(samples: Float32Array): void {
    if (!this.recording || this.paused || samples.length === 0) return;
    this.leftChunks.push(new Float32Array(samples));
  }

  pushRight(samples: Float32Array, sampleRate: number, timestamp = performance.now()): void {
    if (!this.recording || this.paused || samples.length === 0) return;
    const data = resamplePcm(samples as Float32Array<ArrayBuffer>, sampleRate, RECORD_RATE);
    const arrivalOffset = Math.max(
      0,
      Math.floor(((timestamp - this.startedAt) / 1000) * RECORD_RATE),
    );
    const offset = Math.max(arrivalOffset, this.rightNextOffset);
    this.rightEntries.push({ offset, data });
    this.rightNextOffset = offset + data.length;
  }

  stop(): RecordingResult | null {
    if (!this.recording) return null;
    this.recording = false;
    const leftLength = this.leftChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const rightLength = this.rightEntries.reduce(
      (max, entry) => Math.max(max, entry.offset + entry.data.length),
      0,
    );
    const totalSamples = Math.max(leftLength, rightLength);
    if (totalSamples === 0) return null;

    const left = new Float32Array(totalSamples);
    let leftOffset = 0;
    for (const chunk of this.leftChunks) {
      left.set(chunk, leftOffset);
      leftOffset += chunk.length;
    }
    const right = new Float32Array(totalSamples);
    for (const entry of this.rightEntries) {
      for (
        let index = 0;
        index < entry.data.length && entry.offset + index < right.length;
        index += 1
      ) {
        right[entry.offset + index] += entry.data[index];
      }
    }
    const blob = encodeStereoWav(left, right, RECORD_RATE);
    return { blob, durationSec: totalSamples / RECORD_RATE, sizeBytes: blob.size };
  }
}

function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + left.length * 4);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + left.length * 4, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, left.length * 4, true);
  let offset = 44;
  for (let index = 0; index < left.length; index += 1) {
    view.setInt16(offset, floatToInt16(left[index]), true);
    view.setInt16(offset + 2, floatToInt16(right[index]), true);
    offset += 4;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    view.setUint8(offset + index, value.charCodeAt(index));
}
