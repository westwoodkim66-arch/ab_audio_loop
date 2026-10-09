import test from 'node:test';
import assert from 'node:assert/strict';
import { OptionalSubtitleAnalysis } from './optionalSubtitleAnalysis';

test('quota failure skips queued translations without changing measured subtitle data', async () => {
  const analysis = new OptionalSubtitleAnalysis();
  const source = { text: 'Hello there.', start: 1.2, end: 2.4, words: [{ text: 'Hello', start: 1.2, end: 1.8 }] };
  const snapshot = structuredClone(source);
  let requests = 0;
  assert.equal(await analysis.run(async () => { requests++; throw new Error('Quota exceeded'); }), undefined);
  assert.equal(await analysis.run(async () => { requests++; return source; }), undefined);
  assert.equal(requests, 1);
  assert.equal(analysis.unavailable, true);
  assert.deepEqual(source, snapshot);
});

test('successful optional translations remain available', async () => {
  const analysis = new OptionalSubtitleAnalysis();
  const lines = [{ originalText: 'Hello', translation: '你好', startTime: 1, endTime: 2 }];
  assert.equal(await analysis.run(async () => lines), lines);
  assert.equal(analysis.unavailable, false);
});

test('cancellation propagates so an old job cannot publish a fallback', async () => {
  const analysis = new OptionalSubtitleAnalysis();
  const cancellation = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(analysis.run(async () => { throw cancellation; }), { name: 'AbortError' });
  assert.equal(analysis.unavailable, false);
});
