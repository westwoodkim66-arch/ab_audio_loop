export interface WhisperChunk { text: string; timestamp: [number | null, number | null] }
export interface WhisperResult { text: string; chunks: WhisperChunk[]; wordTimestamped: boolean }
export const WHISPER_RESULT_VERSION = 2;

const key = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// Flag sustained decoder loops, not isolated repeated words or two repeated sentences.
// This is a quality alarm: never "fix" hallucinated speech by deleting sentences.
export function hasRepetitionLoop(text: string): boolean {
  const sentences = text.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu) || [];
  let previous = '', run = 0;
  for (const sentence of sentences) {
    const normalized = key(sentence);
    run = normalized === previous ? run + 1 : 1;
    previous = normalized;
    if (normalized.length >= 20 && run >= 4) return true;
  }
  const tokens = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  for (let width = 5; width <= 24; width++) {
    for (let start = 0; start + width * 4 <= tokens.length; start++) {
      const phrase = tokens.slice(start, start + width);
      if (new Set(phrase).size < 3) continue;
      let repeats = true;
      for (let i = width; i < width * 4; i++) {
        if (tokens[start + i] !== phrase[i % width]) { repeats = false; break; }
      }
      if (repeats) return true;
    }
  }
  return false;
}

// Only skip effectively silent PCM. Quiet speech must still reach the model.
export function isNearSilent(samples: Float32Array): boolean {
  if (!samples.length) return true;
  let energy = 0, peak = 0;
  for (const sample of samples) { energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  return peak < 0.0001 && Math.sqrt(energy / samples.length) < 0.00001;
}

export function normalizeWhisperResult(output: any, duration: number): WhisperResult {
  const chunks: WhisperChunk[] = [];
  for (const item of Array.isArray(output?.chunks) ? output.chunks : []) {
    const start = item.timestamp?.[0], end = item.timestamp?.[1];
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start >= duration) continue;
    const boundedEnd = typeof end === 'number' && Number.isFinite(end) ? Math.min(duration, end) : null;
    if (boundedEnd !== null && boundedEnd <= start) continue;
    const text = String(item.text || '');
    if (!text.trim()) continue;
    const previous = chunks[chunks.length - 1];
    // Remove an exact repeated acoustic interval, retaining real repetitions at new times.
    if (previous && key(previous.text) === key(text) && Math.abs(previous.timestamp[0]! - start) < 0.02
      && previous.timestamp[1] !== null && boundedEnd !== null && Math.abs(previous.timestamp[1] - boundedEnd) < 0.02) continue;
    chunks.push({ text, timestamp: [start, boundedEnd] });
  }
  const text = chunks.map(chunk => chunk.text.trim()).join(' ');
  return { text, chunks, wordTimestamped: !!output?.wordTimestamped && chunks.every(chunk => chunk.timestamp[1] !== null) };
}

type Recognize = (audio: Float32Array, retry: boolean) => Promise<any>;

export async function recognizeWithQualityCheck(samples: Float32Array, recognize: Recognize,
  onRetry: (progress: number) => void = () => {}): Promise<WhisperResult> {
  if (isNearSilent(samples)) throw new Error('音軌沒有可辨識的聲音，原字幕保留。');
  const rate = 16000;
  const duration = samples.length / rate;
  const rawInitial = await recognize(samples, false);
  const initial = normalizeWhisperResult(rawInitial, duration);
  if (!hasRepetitionLoop(initial.text) && !hasRepetitionLoop(String(rawInitial?.text || ''))) {
    if (!initial.chunks.length) throw new Error('Whisper 未取得可用的語音時間軸，原字幕保留。');
    return initial;
  }
  // Independently re-decode shorter windows, with context on both sides and
  // midpoint ownership so words in the overlap are included exactly once.
  const chunks: WhisperChunk[] = [];
  let wordTimestamped = true;
  for (let start = 0; start < duration; start += 12) {
    onRetry(Math.round(100 * start / duration));
    const end = Math.min(duration, start + 12);
    const windowStart = Math.max(0, start - 2), windowEnd = Math.min(duration, end + 2);
    const audio = samples.subarray(Math.floor(windowStart * rate), Math.floor(windowEnd * rate));
    if (isNearSilent(samples.subarray(Math.floor(start * rate), Math.floor(end * rate)))) continue;
    const rawResult = await recognize(audio, true);
    const result = normalizeWhisperResult(rawResult, windowEnd - windowStart);
    if (hasRepetitionLoop(result.text) || hasRepetitionLoop(String(rawResult?.text || ''))) throw new Error('Whisper 持續產生疑似重複內容，未套用或保存。請改辨識較短的 A/B 片段，或以正確原文使用「同步音檔字幕」。');
    wordTimestamped = wordTimestamped && result.wordTimestamped;
    for (const chunk of result.chunks) {
      const from = windowStart + chunk.timestamp[0]!;
      const to = chunk.timestamp[1] === null ? null : windowStart + chunk.timestamp[1];
      const midpoint = to === null ? from : (from + to) / 2;
      if (midpoint >= start && (midpoint < end || (end === duration && midpoint <= end))) {
        chunks.push({ text: chunk.text, timestamp: [from, to] });
      }
    }
  }
  const result = normalizeWhisperResult({ chunks, wordTimestamped }, duration);
  if (!result.chunks.length || hasRepetitionLoop(result.text)) {
    throw new Error('分段重試後字幕仍不可靠，原字幕保留且不保存錯誤快取。請改辨識較短的 A/B 片段，或同步正確的原文字幕。');
  }
  return result;
}
