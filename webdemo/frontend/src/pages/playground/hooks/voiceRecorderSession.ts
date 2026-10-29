/** PCM 录音会话及其浏览器资源。 */
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
 * 释放一次 PCM 录音会话占用的浏览器资源。
 * @param session 待释放的录音会话
 */
export function releaseRecordingSession(session: PcmRecordingSession): void {
  session.processor.disconnect();
  session.source.disconnect();
  session.sink.disconnect();
  session.stream.getTracks().forEach((track) => track.stop());
  void session.context.close();
}

/**
 * 合并录音过程中采集的 PCM 分片。
 * @param chunks PCM 分片
 * @returns 连续的单声道 PCM 样本
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
