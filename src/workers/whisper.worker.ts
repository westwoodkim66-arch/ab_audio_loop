import { env, pipeline } from '@huggingface/transformers';
import { recognizeWithQualityCheck } from '../utils/whisperRecognition';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Production serves only this model through the website's streaming endpoint.
if (!import.meta.env.DEV) env.remoteHost = `${self.location.origin}/api/whisper-model/`;

let transcriberPromise: Promise<any> | null = null;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny',
      {
        dtype: 'q8',
        device: 'wasm',
        // Avoid an ONNX Runtime QDQ weight optimization that rejects this model.
        session_options: { graphOptimizationLevel: 'disabled' },
        progress_callback: (progress: any) => {
          self.postMessage({ type: 'progress', progress });
        },
      },
    ).catch(error => {
      transcriberPromise = null; // A failed download must be retryable.
      throw error;
    });
  }
  return transcriberPromise;
}

self.onmessage = async (event: MessageEvent<{ type?: 'prepare'; audio?: ArrayBuffer }>) => {
  try {
    const transcriber = await getTranscriber();
    self.postMessage({ type: 'model-ready', cacheAvailable: typeof caches !== 'undefined' });
    if (event.data.type === 'prepare') return;
    if (!event.data.audio) throw new Error('沒有音訊資料');
    self.postMessage({ type: 'status', message: 'Whisper 正在辨識語音…' });
    const samples = new Float32Array(event.data.audio);
    const output = await recognizeWithQualityCheck(samples, async (audio, retry) => {
      // Strong repetition controls apply only to a flagged retry, so normal speech
      // can contain natural repeated words. Each retry is at most 16 seconds.
      const options = { task: 'transcribe', chunk_length_s: retry ? 0 : 30, stride_length_s: 5,
        ...(retry ? { repetition_penalty: 1.15, no_repeat_ngram_size: 10 } : {}) };
      try {
        const result = await transcriber(audio, { ...options, return_timestamps: 'word' });
        return { ...result, wordTimestamped: true };
      } catch {
        self.postMessage({ type: 'status', message: '逐字時間戳無法取得，改用整句字幕…' });
        const result = await transcriber(audio, { ...options, return_timestamps: true });
        return { ...result, wordTimestamped: false };
      }
    }, progress => self.postMessage({ type: 'status', message: `偵測到疑似重複字幕，正在以短片段重新辨識… ${progress}%` }));
    self.postMessage({ type: 'result', output });
  } catch (error: any) {
    self.postMessage({
      type: event.data.type === 'prepare' ? 'model-error' : 'error',
      message: error?.message || 'Whisper 語音辨識失敗',
    });
  }
};

export {};

