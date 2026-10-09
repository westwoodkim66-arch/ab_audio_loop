import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRepetitionLoop, normalizeWhisperResult, recognizeWithQualityCheck } from './whisperRecognition';
import { readTranscriptCache, writeTranscriptCache } from './transcriptCache';

const sentence = "Listen to me, it's not a problem.";
const loop = { text: Array(6).fill(sentence).join(' '), wordTimestamped: false,
  chunks: Array.from({ length: 6 }, (_, i) => ({ text: sentence, timestamp: [i, i + 0.9] })) };
const pcm = () => new Float32Array(30 * 16000).fill(0.01);

test('detects the screenshot loop while retaining normal short repetitions', () => {
  assert.equal(hasRepetitionLoop(loop.text), true);
  assert.equal(hasRepetitionLoop(Array(5).fill("listen to me it's not a problem").join(' ')), true);
  assert.equal(hasRepetitionLoop(`${sentence} ${sentence}`), false);
  assert.equal(hasRepetitionLoop('No, no, no, no, no, no! Very, very good.'), false);
});

test('keeps repeated speech at distinct times; removes only identical acoustic records', () => {
  const result = normalizeWhisperResult({ wordTimestamped: true, chunks: [
    { text: ' very', timestamp: [0, 0.2] }, { text: ' very', timestamp: [0, 0.2] },
    { text: ' very', timestamp: [0.2, 0.4] }, { text: ' good', timestamp: [0.4, 0.8] },
  ] }, 1);
  assert.equal(result.text, 'very very good');
  assert.equal(result.chunks.length, 3);
  assert.equal(result.wordTimestamped, true);
});

test('valid transcription is returned without re-running the model', async () => {
  let calls = 0;
  const result = await recognizeWithQualityCheck(pcm(), async () => {
    calls++;
    return { text: sentence, wordTimestamped: false, chunks: [{ text: sentence, timestamp: [0.5, 4] }] };
  });
  assert.equal(calls, 1);
  assert.equal(result.text, sentence);
});

test('flagged result is re-decoded in bounded windows with absolute timestamps', async () => {
  let retries = 0;
  const progress: number[] = [];
  const result = await recognizeWithQualityCheck(pcm(), async (audio, retry) => {
    if (!retry) return loop;
    assert.ok(audio.length <= 16 * 16000);
    return { text: `Phrase ${retries++}.`, wordTimestamped: true,
      chunks: [{ text: `Phrase ${retries}.`, timestamp: [3, 4] }] };
  }, value => progress.push(value));
  assert.equal(retries, 3);
  assert.deepEqual(result.chunks.map(chunk => chunk.timestamp), [[3, 4], [13, 14], [25, 26]]);
  assert.equal(result.wordTimestamped, true);
  assert.deepEqual(progress, [0, 40, 80]);
});

test('persistent hallucination rejects the entire result instead of returning deduplicated fiction', async () => {
  await assert.rejects(recognizeWithQualityCheck(pcm(), async () => loop), /未套用或保存/);
});

test('silence does not run recognition; quiet audible speech still does', async () => {
  let calls = 0;
  const recognize = async () => { calls++; return { chunks: [{ text: 'Quiet speech.', timestamp: [0, 0.5] }] }; };
  await assert.rejects(recognizeWithQualityCheck(new Float32Array(16000), recognize), /沒有可辨識的聲音/);
  assert.equal(calls, 0);
  await recognizeWithQualityCheck(new Float32Array(16000).fill(0.0002), recognize);
  assert.equal(calls, 1);
});

test('missing word end times cannot claim complete measured word timestamps', () => {
  assert.equal(normalizeWhisperResult({ wordTimestamped: true,
    chunks: [{ text: 'Hello', timestamp: [0, null] }] }, 1).wordTimestamped, false);
});

test('old generated cache is rejected; native cache and new validated results remain usable', async () => {
  const entries: any[] = [
    { key: '[2,old]', media: 'video', mode: 'generate', requestedLanguage: 'auto', language: 'en',
      raw: [{ originalText: loop.text }], savedAt: 1, segmentationVersion: 3 },
    { key: '[2,native]', media: 'video', mode: 'native', requestedLanguage: 'auto', language: 'en',
      raw: [{ originalText: 'Actual caption.' }], savedAt: 1, segmentationVersion: 3 },
  ];
  const original = globalThis.indexedDB;
  const makeRequest = () => {
    const request: any = { result: entries };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  const db = { close() {}, transaction() {
    const tx: any = { objectStore: () => ({
      getAll: makeRequest, put: (entry: any) => { entries.push(entry); queueMicrotask(() => tx.oncomplete?.()); },
      delete() {},
    }) };
    return tx;
  } };
  globalThis.indexedDB = { open: () => {
    const request: any = { result: db };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } } as any;
  try {
    assert.equal(await readTranscriptCache('video', 'generate'), null);
    assert.equal((await readTranscriptCache('video', 'native'))?.raw[0].originalText, 'Actual caption.');
    await writeTranscriptCache({ media: 'video', mode: 'generate', language: 'en', requestedLanguage: 'auto',
      raw: [{ originalText: 'Recovered speech.' }], placeholderCount: 0 });
    assert.equal((await readTranscriptCache('video', 'generate'))?.raw[0].originalText, 'Recovered speech.');
  } finally { globalThis.indexedDB = original; }
});
