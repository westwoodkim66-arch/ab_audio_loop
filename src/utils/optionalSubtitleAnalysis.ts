/** Translation is optional: a failed cloud request must never discard ASR timings. */
export class OptionalSubtitleAnalysis {
  unavailable = false;

  async run<T>(analyze: () => Promise<T>): Promise<T | undefined> {
    if (this.unavailable) return undefined;
    try {
      return await analyze();
    } catch (error: any) {
      // Cancellation remains authoritative; switching media must not publish old lines.
      if (error?.name === 'AbortError') throw error;
      // Stop queued batches instead of consuming more quota or retrying a broken service.
      this.unavailable = true;
      return undefined;
    }
  }
}
