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
    if (text !== target) { cursor = start; return clean; }
    const first = measured[start];
    const last = measured[cursor - 1];
    if (!first || !last) return clean;
    return { ...clean, startTime: first.startTime, endTime: last.endTime };
  });
}

// Align supplied text to measured ASR words in sequence, retaining the supplied wording.
// A missing word receives no guessed interval; that cue falls back to sentence highlighting.
export function alignSuppliedTranscript<T extends { originalText: string; startTime: number; endTime: number }>(lines: T[], timings: WordTiming[]) {
  const source = lines.flatMap((line, lineIndex) => {
    const tokens = Array.from(line.originalText.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu));
    return tokens.map((token, index) => ({
      text: line.originalText.slice(index ? token.index : 0, tokens[index + 1]?.index ?? line.originalText.length),
      key: spokenText(token[0]), lineIndex,
    }));
  });
  const measured = timings.filter(t => spokenText(t.text) && Number.isFinite(t.startTime)
    && Number.isFinite(t.endTime) && t.startTime >= 0 && t.endTime > t.startTime);
  const n = source.length, m = measured.length;
  if (!n || !m) throw new Error('沒有可用的逐字語音時間，請改用 AI 語音辨識取得有時間的字幕。');
  if (n * m > 2_000_000) throw new Error('字幕過長，請分成較短音檔再進行逐字同步。');
  const keys = measured.map(word => spokenText(word.text));
  const decisions = new Uint8Array(n * m);
  let previous = new Uint32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    const row = new Uint32Array(m + 1);
    for (let j = 1; j <= m; j++) {
      if (source[i - 1].key === keys[j - 1]) {
        row[j] = previous[j - 1] + 1; decisions[(i - 1) * m + j - 1] = 1;
      } else if (previous[j] >= row[j - 1]) {
        row[j] = previous[j]; decisions[(i - 1) * m + j - 1] = 2;
      } else row[j] = row[j - 1];
    }
    previous = row;
  }
  if (previous[m] / n < 0.65) throw new Error('輸入字幕與音檔內容不夠相符，無法可靠同步；原字幕保留，請確認內容或改用 AI 語音辨識。');
  const matches = new Map<number, WordTiming>();
  let i = n, j = m;
  while (i && j) {
    const direction = decisions[(i - 1) * m + j - 1];
    if (direction === 1) { matches.set(i - 1, { ...measured[j - 1], text: source[i - 1].text }); i--; j--; }
    else if (direction === 2) i--;
    else j--;
  }
  const result = lines.map((line, lineIndex) => {
    const tokens = source.map((token, index) => ({ token, index })).filter(x => x.token.lineIndex === lineIndex);
    const words = tokens.flatMap(({ index }) => matches.has(index) ? [matches.get(index)!] : []);
    const reliable = words.length >= Math.min(2, tokens.length) && words.length / Math.max(1, tokens.length) >= 0.5;
    return { ...line, startTime: reliable ? words[0].startTime : -1,
      endTime: reliable ? words[words.length - 1].endTime : -1, wordTimings: reliable ? words : [] };
  });
  if (result.some(line => line.startTime < 0)) throw new Error('有部分句子無法對上語音，原字幕保留。請確認字幕是否包含音檔中未說出的內容。');
  return result;
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
