// Serve the fixed Whisper tiny q8 model through this website. Stream weights
// without buffering them in a Pages Function or bundling them into the app JS.
export async function onRequest(context) {
  if (!['GET', 'HEAD'].includes(context.request.method)) return new Response('Method not allowed', { status: 405 });
  const path = Array.isArray(context.params.path) ? context.params.path.join('/') : String(context.params.path || '');
  const match = path.match(/^onnx-community\/whisper-tiny\/resolve\/main\/([A-Za-z0-9_.-]+\.(?:json|txt)|onnx\/(?:encoder_model|decoder_model_merged)_quantized\.onnx)$/);
  if (!match) return new Response('Unknown model asset', { status: 404 });
  try {
    const response = await fetch(`https://huggingface.co/${path}`, {
      method: context.request.method,
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    if (!response.ok) return new Response('Model download unavailable', { status: response.status === 404 ? 404 : 502 });
    const headers = new Headers({
      'Content-Type': match[1].endsWith('.onnx') ? 'application/octet-stream' : 'application/json',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['Content-Length', 'ETag', 'Last-Modified']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(context.request.method === 'HEAD' ? null : response.body, { headers });
  } catch {
    return new Response('Model download unavailable', { status: 502 });
  }
}
