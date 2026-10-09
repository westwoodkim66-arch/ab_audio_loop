import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSuppliedTranscript, attachWordTimings, hasCompleteWordTimings } from './wordTiming';

test('supplied transcript receives measured timestamps while retaining text and translation', () => {
  const source = [{ originalText: 'Hello there.', translation: '你好。', startTime: -1, endTime: -1 }];
  const [aligned] = alignSuppliedTranscript(source, [
    { text: 'Hello', startTime: 2.1, endTime: 2.6 },
    { text: 'there.', startTime: 3.2, endTime: 3.7 },
  ]);
  assert.equal(aligned.originalText, source[0].originalText);
  assert.equal(aligned.translation, source[0].translation);
  assert.equal(aligned.startTime, 2.1);
  assert.equal(aligned.endTime, 3.7);
  const words = attachWordTimings([{ word: 'Hello' }, { word: 'there' }, { word: '.' }], aligned.wordTimings);
  assert.equal(words[1].startTime, 3.2); // Actual pause, not character-proportional interpolation.
  assert.equal(hasCompleteWordTimings(words, aligned.startTime, aligned.endTime), true);
  assert.equal(source[0].startTime, -1);
});

test('repeated sentences align to their separate occurrences in chronological order', () => {
  const aligned = alignSuppliedTranscript([
    { originalText: 'Hello there.', startTime: -1, endTime: -1 },
    { originalText: 'Hello there.', startTime: -1, endTime: -1 },
  ], [
    { text: 'Hello', startTime: 1, endTime: 1.2 }, { text: 'there', startTime: 1.3, endTime: 1.6 },
    { text: 'Hello', startTime: 5, endTime: 5.2 }, { text: 'there', startTime: 5.3, endTime: 5.6 },
  ]);
  assert.deepEqual(aligned.map(line => line.startTime), [1, 5]);
});

test('unmatched word is left untimed and whole-sentence highlighting is used', () => {
  const [aligned] = alignSuppliedTranscript([{ originalText: 'Hello dear friend.', startTime: -1, endTime: -1 }], [
    { text: 'Hello', startTime: 1, endTime: 1.2 }, { text: 'friend', startTime: 2, endTime: 2.3 },
  ]);
  const words = attachWordTimings([{ word: 'Hello' }, { word: 'dear' }, { word: 'friend' }], aligned.wordTimings);
  assert.equal(words[1].startTime, undefined);
  assert.equal(words[2].startTime, 2);
  assert.equal(hasCompleteWordTimings(words, aligned.startTime, aligned.endTime), false);
});

test('different audio content rejects alignment rather than inventing a timeline', () => {
  assert.throws(() => alignSuppliedTranscript([{ originalText: 'Hello there.', startTime: -1, endTime: -1 }], [
    { text: 'Goodbye', startTime: 1, endTime: 2 },
  ]), /不夠相符/);
});
