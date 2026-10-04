import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

let transcriberPromise: Promise<any> | null = null;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny',
      {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (progress: any) => {
          self.postMessage({ type: 'progress', progress });
        },
      },
    );
  }
  return transcriberPromise;
}

self.onmessage = async (event: MessageEvent<{ audio: ArrayBuffer }>) => {
  try {
    const transcriber = await getTranscriber();
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
      type: 'error',
      message: error?.message || 'Whisper 語音辨識失敗',
    });
  }
};

export {};
