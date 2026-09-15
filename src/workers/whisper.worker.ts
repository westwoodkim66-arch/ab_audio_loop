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
    const output = await transcriber(new Float32Array(event.data.audio), {
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ type: 'result', output });
  } catch (error: any) {
    self.postMessage({
      type: 'error',
      message: error?.message || 'Whisper 語音辨識失敗',
    });
  }
};

export {};
