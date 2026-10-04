export interface WordTiming {
  text: string;
  startTime: number;
  endTime: number;
}

const spokenText = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

// Match whole acoustic words only. Never divide a measured interval by character count.
export function attachWordTimings<T extends { word: string }>(words: T[], timings: WordTiming[] = []) {
  const measured = timings.filter(t => spokenText(t.text));
  let cursor = 0;
  return words.map(word => {
    const clean = { ...word, startTime: undefined as number | undefined, endTime: undefined as number | undefined };
    const target = spokenText(word.word || '');
    if (!target) return clean;
    let text = '';
    const start = cursor;
    while (cursor < measured.length && text.length < target.length) text += spokenText(measured[cursor++].text);
    if (text !== target) return clean;
    const first = measured[start];
    const last = measured[cursor - 1];
    if (!first || !last) return clean;
    return { ...clean, startTime: first.startTime, endTime: last.endTime };
  });
}

export function hasCompleteWordTimings(words: { word: string; startTime?: number; endTime?: number }[], start: number | null, end: number | null) {
  const spoken = words.filter(w => spokenText(w.word || ''));
  let previousEnd = -Infinity;
  return start !== null && end !== null && start >= 0 && end > start && spoken.length > 0 && spoken.every(w => {
    const valid = typeof w.startTime === 'number' && typeof w.endTime === 'number'
      && Number.isFinite(w.startTime) && Number.isFinite(w.endTime)
      && w.startTime >= start && w.endTime <= end && w.endTime > w.startTime
      && w.startTime >= previousEnd;
    previousEnd = w.endTime ?? Infinity;
    return valid;
  });
}
