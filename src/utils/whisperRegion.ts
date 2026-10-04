export interface AudioRegion { start: number; end: number }

export function resampleAudioRegion(decoded: AudioBuffer, region?: AudioRegion) {
  const start = region ? Math.max(0, region.start) : 0;
  const end = region ? Math.min(decoded.duration, region.end) : decoded.duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('A/B 區間超出音檔範圍');
  const rate = 16000;
  // Allocate only the selected interval, never a full-length 16 kHz copy.
  const samples = new Float32Array(Math.ceil((end - start) * rate));
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  for (let i = 0; i < samples.length; i++) {
    const source = Math.min(decoded.length - 1, Math.floor((start + i / rate) * decoded.sampleRate));
    let sum = 0;
    for (const channel of channels) sum += channel[source] || 0;
    samples[i] = sum / channels.length;
  }
  return { samples, start, end };
}

export function mergeRegionLines<T extends { startTime: number | null; endTime: number | null }>(existing: T[], replacement: T[], region: AudioRegion): T[] {
  const kept = existing.filter(line => line.startTime === null || line.endTime === null
    || line.startTime < 0 || line.endTime <= region.start || line.startTime >= region.end);
  return [...kept, ...replacement].sort((a, b) => (a.startTime ?? Infinity) - (b.startTime ?? Infinity));
}
