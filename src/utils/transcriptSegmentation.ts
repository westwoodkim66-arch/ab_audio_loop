export interface TimedTranscriptSegment {
  id?: string;
  originalText: string;
  startTime: number;
  endTime: number;
  [key: string]: unknown;
}

const TERMINAL_PUNCTUATION = /[.!?。！？…]["'”’」』】）)]*$/;
const CAPTION_MARKER = /^[\s♪♫♬]*[\[\(（【]?\s*(?:音楽|音樂|音乐|music|instrumental|applause|掌聲|掌声|拍手)\s*[\]\)）】]?[\s♪♫♬]*$/i;
const MAX_WORDS_PER_CUE = 20;
const MAX_CHARS_PER_CUE = 110;
const CLAUSE_START_WORDS = new Set(['and', 'but', 'so', 'because', 'while', 'although', 'which', 'who', 'that', 'if', 'when', 'from', 'for', 'with', 'in', 'on', 'at', 'to', 'of']);

function normalizedWords(text: string) { return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase(); }
function lexicalCount(text: string) {
  if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(text)) {
    return Array.from(text.replace(/[\s\p{P}\p{S}]/gu, '')).length;
  }
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length || 0;
}
function tooLong(text: string) { return lexicalCount(text) > MAX_WORDS_PER_CUE || text.length > MAX_CHARS_PER_CUE; }

function splitAtReadableLimits(sentence: string): string[] {
  const parts = sentence.match(/\S+\s*/gu) || [sentence];
  const groups: string[] = [];
  let current: string[] = [];
  for (const part of parts) {
    const candidate = [...current, part].join('');
    if (current.length && tooLong(candidate.trimEnd())) {
      // Prefer starting the next cue at a clause/prepositional boundary.
      let splitAt = -1;
      for (let i = current.length - 1; i >= Math.floor(current.length * 0.55); i--) {
        const firstWord = current[i].trim().split(/\s/, 1)[0].replace(/^[^a-z]+|[^a-z]+$/gi, '').toLowerCase();
        if (CLAUSE_START_WORDS.has(firstWord)) {
          splitAt = i;
          break;
        }
      }
      if (splitAt > 0 && lexicalCount(current.slice(0, splitAt).join('')) >= 6) {
        groups.push(current.slice(0, splitAt).join('').trim());
        current = [...current.slice(splitAt), part];
      } else {
        groups.push(current.join('').trim());
        current = [part];
      }
    } else current.push(part);
  }
  if (current.length) groups.push(current.join('').trim());
  return groups;
}

function splitMeasuredWords<T extends TimedTranscriptSegment>(item: T, text: string): T[] | null {
  const timings = (item as any).wordTimings;
  if (!Array.isArray(timings) || timings.length < 2 || !timings.every((t: any) => typeof t.text === 'string'
    && Number.isFinite(t.startTime) && Number.isFinite(t.endTime) && t.endTime > t.startTime)) return null;
  if (normalizedWords(timings.map((t: any) => t.text).join('')) !== normalizedWords(text)) return null;

  const groups: any[][] = [];
  let group: any[] = [];
  const flush = () => { if (group.length) groups.push(group); group = []; };
  for (const timing of timings) {
    const token = String(timing.text);
    const candidate = group.map(t => t.text).join('') + token;
    const incomingWord = token.trim().split(/\s/, 1)[0].replace(/^[^a-z]+|[^a-z]+$/gi, '').toLowerCase();
    if (group.length && CLAUSE_START_WORDS.has(incomingWord) && lexicalCount(group.map(t => t.text).join('')) >= 12) flush();
    else if (group.length && tooLong(candidate.trim())) {
      let splitAt = -1;
      for (let i = group.length - 1; i >= Math.floor(group.length * 0.55); i--) {
        const firstWord = String(group[i].text).trim().split(/\s/, 1)[0].replace(/^[^a-z]+|[^a-z]+$/gi, '').toLowerCase();
        if (CLAUSE_START_WORDS.has(firstWord)) { splitAt = i; break; }
      }
      if (splitAt > 0 && lexicalCount(group.slice(0, splitAt).map(t => t.text).join('')) >= 6) {
        groups.push(group.slice(0, splitAt));
        group = group.slice(splitAt);
      } else flush();
    }
    group.push(timing);
    if (/[.!?。！？…][\s"'”’」』】）)]*$/.test(token)) flush();
  }
  flush();
  if (groups.length === 0) return null;
  return groups.map((parts, index) => ({
    ...item,
    id: `${item.id || 'segment'}_timed_${index}`,
    originalText: parts.map(part => part.text).join('').trim(),
    startTime: Number(parts[0].startTime),
    endTime: Number(parts[parts.length - 1].endTime),
    wordTimings: parts,
    __forceSubtitleBoundary: index > 0,
  })) as T[];
}

function splitUntimedItem<T extends TimedTranscriptSegment>(item: T, text: string): T[] {
  const sentences = splitSentences(text).flatMap(splitAtReadableLimits);
  const duration = Math.max(0.08, Number(item.endTime) - Number(item.startTime));
  const totalWeight = Math.max(1, sentences.reduce((sum, sentence) => sum + sentence.length, 0));
  let consumedWeight = 0;
  return sentences.map((sentence, index) => {
    const startRatio = consumedWeight / totalWeight;
    consumedWeight += sentence.length;
    const endRatio = index === sentences.length - 1 ? 1 : consumedWeight / totalWeight;
    const { wordTimings: _discardUnalignedTimings, ...rest } = item as any;
    return {
      ...rest,
      id: `${item.id || 'segment'}_sentence_${index}`,
      originalText: sentence,
      startTime: Number(item.startTime) + duration * startRatio,
      endTime: Number(item.startTime) + duration * endRatio,
      __forceSubtitleBoundary: index > 0,
    } as T;
  });
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const Segmenter = (Intl as any).Segmenter;
    if (Segmenter) {
      const segments = Array.from(new Segmenter(undefined, { granularity: 'sentence' }).segment(trimmed))
        .map((entry: any) => String(entry.segment || '').trim())
        .filter(Boolean);
      if (segments.length > 0) return segments;
    }
  } catch {
    // Fall through to the punctuation-based splitter for older browsers.
  }

  return trimmed.match(/[^.!?。！？…]+(?:[.!?。！？…]+["'”’」』】）)]*|$)/g)?.map(part => part.trim()).filter(Boolean) || [trimmed];
}

function joinFragments(left: string, right: string) {
  if (!left) return right.trim();
  const cleanRight = right.trim();
  const needsSpace = /[A-Za-z0-9'”’)]$/.test(left) && /^[A-Za-z0-9'“‘(]/.test(cleanRight);
  return `${left}${needsSpace ? ' ' : ''}${cleanRight}`;
}

function beginsNewSpeaker(text: string) {
  return /^(?:[-–—]\s+|[A-Za-z][A-Za-z .'-]{0,24}:\s+)/.test(text.trim());
}

/**
 * Converts ASR-sized chunks into sentence-sized display cues.
 * Incomplete fragments separated by a short pause are joined; chunks containing multiple complete
 * sentences are split. Timestamps are proportionally distributed and then span the joined sentence.
 */
export function resegmentTimedTranscript<T extends TimedTranscriptSegment>(items: T[], maxJoinGapSeconds = 1.2): T[] {
  const pieces: T[] = [];

  for (const item of items) {
    const text = String(item.originalText || '').trim();
    if (!text) continue;
    if (CAPTION_MARKER.test(text)) {
      pieces.push({ ...item, originalText: text });
      continue;
    }

    const timedPieces = splitMeasuredWords(item, text);
    pieces.push(...(timedPieces || splitUntimedItem(item, text)));
  }

  const result: T[] = [];
  let pending: T | null = null;

  const flush = () => {
    if (pending) result.push(pending);
    pending = null;
  };

  for (const piece of pieces) {
    const text = piece.originalText.trim();
    if (CAPTION_MARKER.test(text)) {
      flush();
      result.push(piece);
      continue;
    }

    if (!pending) {
      pending = { ...piece };
    } else {
      const gap = Number(piece.startTime) - Number(pending.endTime);
      const canContinue = !(piece as any).__forceSubtitleBoundary
        && !TERMINAL_PUNCTUATION.test(pending.originalText.trim())
        && gap <= maxJoinGapSeconds
        && gap >= -0.35
        && !tooLong(joinFragments(pending.originalText, text))
        && !beginsNewSpeaker(text);
      if (canContinue) {
        pending = {
          ...pending,
          originalText: joinFragments(pending.originalText, text),
          endTime: Math.max(Number(pending.endTime), Number(piece.endTime)),
          ...(Array.isArray(pending.wordTimings) && Array.isArray(piece.wordTimings)
            ? { wordTimings: [...pending.wordTimings, ...piece.wordTimings] } : {}),
        };
      } else {
        flush();
        pending = { ...piece };
      }
    }

    if (pending && TERMINAL_PUNCTUATION.test(pending.originalText.trim())) flush();
  }
  flush();

  return result.map((item, index) => {
    const { __forceSubtitleBoundary: _forceBoundary, ...line } = item as any;
    return { ...line, id: `${item.id || 'segment'}_display_${index}` };
  });
}
