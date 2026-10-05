import { env, pipeline } from '@huggingface/transformers';

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
    const options = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
    let output;
    try {
      output = await transcriber(samples, { ...options, return_timestamps: 'word' });
      output.wordTimestamped = true;
    } catch {
      self.postMessage({ type: 'status', message: '逐字時間戳無法取得，改用整句字幕…' });
      output = await transcriber(samples, { ...options, return_timestamps: true });
      output.wordTimestamped = false;
    }
    self.postMessage({ type: 'result', output });
  } catch (error: any) {
    self.postMessage({
      type: event.data.type === 'prepare' ? 'model-error' : 'error',
      message: error?.message || 'Whisper 語音辨識失敗',
    });
  }
};

export {};
