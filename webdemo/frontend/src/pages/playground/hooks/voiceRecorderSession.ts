/** A PCM recording session and its browser resources. */
export interface PcmRecordingSession {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  chunks: Float32Array[];
  sampleRate: number;
}

/**
 * Release the browser resources held by one PCM recording session.
 * @param session recording session to release
 */
export function releaseRecordingSession(session: PcmRecordingSession): void {
  session.processor.disconnect();
  session.source.disconnect();
  session.sink.disconnect();
  session.stream.getTracks().forEach((track) => track.stop());
  void session.context.close();
}

/**
 * Merge PCM chunks captured during recording.
 * @param chunks PCM chunks
 * @returns continuous mono PCM samples
 */
export function mergeRecordingChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    samples.set(chunk, offset);
    offset += chunk.length;
  });
  return samples;
}
