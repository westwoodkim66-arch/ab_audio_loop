export interface TimedTranscriptSegment {
  id?: string;
  originalText: string;
  startTime: number;
  endTime: number;
  [key: string]: unknown;
}

const TERMINAL_PUNCTUATION = /[.!?。！？…]["'”’」』】）)]*$/;
const CAPTION_MARKER = /^[\s♪♫♬]*[\[\(（【]?\s*(?:音楽|音樂|音乐|music|instrumental|applause|掌聲|掌声|拍手)\s*[\]\)）】]?[\s♪♫♬]*$/i;

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

    const sentences = splitSentences(text);
    const duration = Math.max(0.08, Number(item.endTime) - Number(item.startTime));
    const totalWeight = Math.max(1, sentences.reduce((sum, sentence) => sum + sentence.length, 0));
    let consumedWeight = 0;

    for (let index = 0; index < sentences.length; index++) {
      const sentence = sentences[index];
      const startRatio = consumedWeight / totalWeight;
      consumedWeight += sentence.length;
      const endRatio = index === sentences.length - 1 ? 1 : consumedWeight / totalWeight;
      pieces.push({
        ...item,
        id: `${item.id || 'segment'}_sentence_${index}`,
        originalText: sentence,
        startTime: Number(item.startTime) + duration * startRatio,
        endTime: Number(item.startTime) + duration * endRatio,
      });
    }
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
      const canContinue = !TERMINAL_PUNCTUATION.test(pending.originalText.trim())
        && gap <= maxJoinGapSeconds
        && gap >= -0.35
        && !beginsNewSpeaker(text);
      if (canContinue) {
        pending = {
          ...pending,
          originalText: joinFragments(pending.originalText, text),
          endTime: Math.max(Number(pending.endTime), Number(piece.endTime)),
        };
      } else {
        flush();
        pending = { ...piece };
      }
    }

    if (pending && TERMINAL_PUNCTUATION.test(pending.originalText.trim())) flush();
  }
  flush();

  return result.map((item, index) => ({ ...item, id: `${item.id || 'segment'}_display_${index}` }));
}
