import React, { useState, useRef, useEffect } from 'react';
import { Type } from "@google/genai";
import { Copy, Upload, Youtube, Image as ImageIcon, FileText, Loader2, PlayCircle, Settings2, AudioLines, RotateCcw } from 'lucide-react';
import { resegmentTimedTranscript, prepareReadableTranscript, needsReadableSegmentation } from '../utils/transcriptSegmentation';
import { attachWordTimings, hasCompleteWordTimings, alignSuppliedTranscript } from '../utils/wordTiming';
import { readTranscriptCache, writeTranscriptCache, transcriptMediaKey, resolveTranscriptMediaKey, type TranscriptMode } from '../utils/transcriptCache';
import { resampleAudioRegion, mergeRegionLines, type AudioRegion } from '../utils/whisperRegion';

export interface SubtitleWord {
  word: string;
  furigana: string;
  romaji: string;
  startTime?: number;
  endTime?: number;
}

export interface SubtitleLine {
  id: string;
  startTime: number | null;
  endTime: number | null;
  originalText: string;
  translation: string;
  words: SubtitleWord[];
}

export interface TranscriptPanelProps {
  playerRef: React.RefObject<any>;
  audioUrl: string;
  currentTime: number;
  initialLines?: SubtitleLine[];
  onLinesChange?: (lines: SubtitleLine[]) => void;
  subtitleOffset?: number;
  onSubtitleOffsetChange?: (offset: number) => void;
  onLoopLine?: (line: SubtitleLine) => void;
  loopStart?: number | null;
  loopEnd?: number | null;
  loopEnabled?: boolean;
  pointA?: number | null;
  pointB?: number | null;
}

const PLACEHOLDER_CAPTION = /^[\s♪♫♬]*[\[\(（【]?\s*(?:音楽|音樂|音乐|music|instrumental|applause|掌聲|掌声|拍手)\s*[\]\)）】]?[\s♪♫♬]*$/i;

type SubtitleJob = { controller: AbortController; media: string };

function plainSubtitleWords(text: string): SubtitleWord[] {
  return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu) || [])
    .map(word => ({ word, furigana: '', romaji: '' }));
}

function normalizeTimedTranscript(items: any[]) {
  const sorted = items
    .map((item, index) => ({ ...item, _order: index }))
    .filter(item => Number.isFinite(Number(item.startTime)))
    .sort((a, b) => Number(a.startTime) - Number(b.startTime) || a._order - b._order);

  return sorted.map((item, index) => {
    const start = Math.max(0, Number(item.startTime));
    const nextStart = index + 1 < sorted.length ? Number(sorted[index + 1].startTime) : null;
    const suppliedEnd = Number(item.endTime);
    let end = Number.isFinite(suppliedEnd) && suppliedEnd > start ? suppliedEnd : start + 3;
    // YouTube/Supadata durations occasionally overlap the next cue. Never let an older cue win that overlap.
    if (nextStart !== null && Number.isFinite(nextStart)) end = Math.min(end, Math.max(start + 0.08, nextStart));
    return { ...item, startTime: start, endTime: end, _order: undefined };
  });
}

const WORD_STYLES = "bg-[#94a1b2]/10 text-[#94a1b2] border-b border-[#94a1b2]/30 px-1.5 py-0.5 rounded-md";

export default function TranscriptPanel({ playerRef, audioUrl, currentTime, initialLines = [], onLinesChange, subtitleOffset = 0, onSubtitleOffsetChange, onLoopLine, loopStart, loopEnd, loopEnabled, pointA, pointB }: TranscriptPanelProps) {
  const [lines, setLines] = useState<SubtitleLine[]>(initialLines);
  const publishedLinesRef = useRef(new WeakSet<SubtitleLine[]>());
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [inputText, setInputText] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showCopyPasteGuide, setShowCopyPasteGuide] = useState(false);
  const [placeholderCount, setPlaceholderCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const whisperWorkerRef = useRef<Worker | null>(null);
  const [lastTranscriptMode, setLastTranscriptMode] = useState<TranscriptMode>('native');
  const [subtitleFontSize, setSubtitleFontSize] = useState(() => {
    try { const saved = Number(localStorage.getItem('ab_subtitle_font_size')); return saved >= 14 && saved <= 28 ? saved : 17; }
    catch { return 17; }
  });
  useEffect(() => {
    try { localStorage.setItem('ab_subtitle_font_size', String(subtitleFontSize)); } catch {}
  }, [subtitleFontSize]);
  const [mediaKey, setMediaKey] = useState<string | null>(() => transcriptMediaKey(audioUrl));
  const [cacheCheckedMedia, setCacheCheckedMedia] = useState('');
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [modelFiles, setModelFiles] = useState<Record<string, { percent?: number; loaded?: number; total?: number }>>({});
  const modelPreparedMediaRef = useRef('');
  const [modelError, setModelError] = useState('');
  const [modelCacheAvailable, setModelCacheAvailable] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setMediaKey(transcriptMediaKey(audioUrl));
    setCacheCheckedMedia('');
    if (audioUrl.startsWith('blob:')) void resolveTranscriptMediaKey(audioUrl, controller.signal).then(key => {
      if (!controller.signal.aborted) setMediaKey(key);
    });
    return () => controller.abort();
  }, [audioUrl]);
  const ensureWhisperWorker = () => {
    if (whisperWorkerRef.current) return whisperWorkerRef.current;
    const worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });
    whisperWorkerRef.current = worker;
    worker.addEventListener('message', event => {
      if (whisperWorkerRef.current !== worker) return;
      const message = event.data;
      if (message.type === 'progress') {
        setModelState('loading');
        const progress = message.progress;
        if (progress?.file) setModelFiles(previous => ({ ...previous, [progress.file]: {
          percent: progress.status === 'done' ? 100 : Number.isFinite(progress.progress) ? progress.progress : previous[progress.file]?.percent,
          loaded: progress.loaded ?? previous[progress.file]?.loaded,
          total: progress.total ?? previous[progress.file]?.total,
        } }));
      } else if (message.type === 'model-ready') {
        setModelState('ready');
        setModelCacheAvailable(message.cacheAvailable);
      } else if (message.type === 'model-error') {
        setModelState('error'); setModelError(message.message);
      }
    });
    worker.addEventListener('error', () => {
      if (whisperWorkerRef.current !== worker) return;
      worker.terminate(); whisperWorkerRef.current = null;
      setModelState('error'); setModelError('模型載入中斷，請重試。');
    });
    return worker;
  };
  const prepareWhisperModel = () => {
    modelPreparedMediaRef.current = audioUrl;
    setModelState('loading'); setModelError(''); setModelFiles({});
    ensureWhisperWorker().postMessage({ type: 'prepare' });
  };
  const requestedLanguage = 'auto';
  const transcriptRequestRef = useRef(0);
  const previousCacheMediaRef = useRef<string | null>(null);
  const activeJobRef = useRef<SubtitleJob | null>(null);
  const currentMediaRef = useRef(audioUrl);
  currentMediaRef.current = audioUrl;
  const lastJobMediaRef = useRef(audioUrl);

  const beginJob = (): SubtitleJob => {
    activeJobRef.current?.controller.abort();
    ++transcriptRequestRef.current;
    const job = { controller: new AbortController(), media: audioUrl };
    activeJobRef.current = job;
    return job;
  };
  const isCurrentJob = (job: SubtitleJob) => activeJobRef.current === job
    && !job.controller.signal.aborted && currentMediaRef.current === job.media;
  const checkJob = (job: SubtitleJob) => {
    if (!isCurrentJob(job)) throw new DOMException('字幕工作已取消', 'AbortError');
  };
  const cancelJob = () => {
    activeJobRef.current?.controller.abort();
    ++transcriptRequestRef.current;
    setIsProcessing(false);
    setStatusText('已取消字幕處理，已載入的內容保留。');
  };
  const waitForPoll = (job: SubtitleJob) => new Promise<void>((resolve, reject) => {
    checkJob(job);
    const signal = job.controller.signal;
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
    signal.addEventListener('abort', abort, { once: true });
  });
  useEffect(() => {
    if (lastJobMediaRef.current === audioUrl) return;
    lastJobMediaRef.current = audioUrl;
    activeJobRef.current?.controller.abort();
    setIsProcessing(false);
    setStatusText('');
    setLines([]);
    setPlaceholderCount(0);
    setActiveIndex(-1);
    setShowCopyPasteGuide(false);
  }, [audioUrl]);

  useEffect(() => {
    const request = ++transcriptRequestRef.current;
    const firstMedia = previousCacheMediaRef.current === null;
    previousCacheMediaRef.current = mediaKey;
    if (!mediaKey || (firstMedia && initialLines.length > 0)) { if (!audioUrl.startsWith('blob:')) setCacheCheckedMedia(audioUrl); return; }
    void readTranscriptCache(mediaKey).then(async cached => {
      if (request !== transcriptRequestRef.current) return;
      setCacheCheckedMedia(audioUrl);
      if (!cached) return;
      setPlaceholderCount(cached.placeholderCount);
      setLastTranscriptMode(cached.mode);
      if (!cached.lines?.length) {
        const job = beginJob();
        const completed = await processTextWithGemini('', cached.raw, job);
        if (completed?.length && isCurrentJob(job)) await writeTranscriptCache({ ...cached, lines: completed });
        return;
      }
      setLines(cached.lines);
      setStatusText(`已直接載入已保存的 ${cached.language === 'und' ? '' : cached.language + ' '}字幕`);
    });
    return () => { ++transcriptRequestRef.current; };
  }, [mediaKey]);

  const getActiveWordIndex = (line: SubtitleLine, currentTime: number): number => {
    if (line.startTime === null || line.endTime === null || line.startTime === -1 || line.endTime === -1) return -1;
    if (currentTime < line.startTime || currentTime >= line.endTime) return -1;
    
    if (!hasCompleteWordTimings(line.words, line.startTime, line.endTime)) return -1;
    return line.words.findIndex(word => word.startTime !== undefined && word.endTime !== undefined
      && currentTime >= word.startTime && currentTime < word.endTime);
  };

  // Sync with initialLines if it changes
  useEffect(() => {
    // Parent echoes must not feed old child results back into the panel.
    if (initialLines === lines || publishedLinesRef.current.has(initialLines)) return;
    if (initialLines.length > 0) {
      if (initialLines.some(line => needsReadableSegmentation(line.originalText))) {
        void processTextWithGemini('', initialLines);
      } else setLines(initialLines);
    }
  }, [initialLines]);

  // Notify parent when lines change
  useEffect(() => {
    publishedLinesRef.current.add(lines);
    if (onLinesChange && initialLines !== lines) {
      onLinesChange(lines);
    }
  }, [lines, onLinesChange]);

  // Update active index
  useEffect(() => {
    if (lines.length === 0) return;
    
    // Choose the newest cue that has started. This prevents an older overlapping cue from winning.
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const start = lines[i].startTime;
      if (start !== null && start !== undefined && start !== -1 && currentTime >= start) idx = i;
      else if (start !== null && start !== undefined && start > currentTime) break;
    }
    // Do not keep stale subtitles visible through a silent gap.
    if (idx !== -1) {
      const end = lines[idx].endTime;
      if (end === null || end === undefined || end === -1 || currentTime >= end) idx = -1;
    }

    if (idx !== activeIndex) {
        setActiveIndex(idx);
    }
  }, [currentTime, lines, activeIndex]);

  // Scroll when index changes
  useEffect(() => {
    if (autoScroll && activeIndex !== -1 && scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const activeElement = container.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement;
        if (activeElement) {
            const elementRect = activeElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // Calculate distance to move element to the vertical center of the container
            const distanceY = (elementRect.top + elementRect.height / 2) - (containerRect.top + containerRect.height / 2);
            
            container.scrollBy({
                top: distanceY,
                behavior: 'smooth'
            });
        }
    }
  }, [activeIndex, autoScroll]);

  useEffect(() => () => {
    activeJobRef.current?.controller.abort();
    whisperWorkerRef.current?.terminate();
  }, []);

  const fetchGemini = async (options: any, job: SubtitleJob) => {
    try {
        checkJob(job);
        const res = await fetch("/api/gemini/generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(options),
          signal: job.controller.signal
        });
        
        const textResponse = await res.text();
        checkJob(job);
        
        let data;
        try {
            data = JSON.parse(textResponse);
        } catch (e) {
            // Check for AI Studio specific Nginx / Cookie intercept issues
            if (res.status === 404) {
               throw new Error("API 端點不存在 (404)，請確認 functions/ 資料夾已正確部署。");
            }
            if (res.status === 500 && textResponse.includes("GEMINI_API_KEY")) {
               throw new Error("請至 Cloudflare Pages → Settings → Environment variables 新增 GEMINI_API_KEY。");
            }
            if (res.status === 405) {
               throw new Error("HTTP 405，請確認 Cloudflare Pages Functions 已啟用。");
            }
            if (res.status === 413 || textResponse.includes("413")) {
                throw new Error("圖片檔案過大 (Status 413)。請嘗試上傳較小的圖片。");
            }
            throw new Error(`伺服器回傳無效的資料格式 (Status ${res.status}): ${textResponse.substring(0, 50)}...`);
        }

        if (!res.ok) {
            throw new Error(data.error || `Generation failed: ${res.statusText}`);
        }
        return { text: data.text };
    } catch (e: any) {
        if (e?.name !== 'AbortError') console.error("fetchGemini Error:", e);
        throw e;
    }
  };

  const processTextWithGemini = async (text: string, existingLines?: any[], job = beginJob(), region?: AudioRegion) => {
    try {
      checkJob(job);
      setIsProcessing(true);
      const previousLines = [...lines];
      const publish = (next: SubtitleLine[]) => setLines(region ? mergeRegionLines(previousLines, next, region) : next);
      // Apply the same short sentence boundaries to remote captions, pasted text,
      // imports, shared links and old recognition caches before asking for translation.
      const input = existingLines || text.split(/\r?\n/).filter(t => t.trim()).map((t, i) => ({
        id: `manual_${Date.now()}_${i}`, originalText: t.trim(), startTime: -1, endTime: -1
      }));
      const rawData = prepareReadableTranscript(input);

      const CHUNK_SIZE = 12;
      const MAX_CONCURRENT_CHUNKS = 3;
      const chunks = Array.from({ length: Math.ceil(rawData.length / CHUNK_SIZE) }, (_, index) =>
        rawData.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
      );
      const placeholderChunks: SubtitleLine[][] = chunks.map((chunk, chunkIndex) =>
        chunk.map((item: any, itemIndex: number) => ({
          id: item.id || `pending_${chunkIndex}_${itemIndex}`,
          originalText: item.originalText || "",
          translation: item.providedTranslation || "分析中…",
          startTime: item.startTime ?? -1,
          endTime: item.endTime ?? -1,
          words: attachWordTimings(plainSubtitleWords(item.originalText || ''), item.wordTimings)
        }))
      );
      const processedChunks: SubtitleLine[][] = new Array(chunks.length);
      let completedChunks = 0;

      // 先顯示原始字幕；翻譯與讀音在背景並行補上。
      publish(placeholderChunks.flat());
      setStatusText(`字幕已載入，正在並行分析 ${chunks.length} 批內容...`);

      const processChunk = async (chunk: any[], chunkIndex: number) => {
        const i = chunkIndex * CHUNK_SIZE;
        
        const prompt = `You are an expert linguist. The user will provide a transcript segment that might be in Japanese, English, or a mix. 
Analyze each already-segmented subtitle line without changing its boundaries.
CRITICAL RULES:
- Output ONLY valid JSON array.
- Return EXACTLY ONE output object for EACH input object, in the SAME ORDER. Never merge two inputs and never split one input.
- Preserve every input "id", "originalText", "startTime", and "endTime" exactly. Only add translation and pronunciation support.
- "originalText" MUST match the input snippet EXACTLY in its original language. DO NOT translate "originalText". If it's English, keep it English.
- "translation" should be the Traditional Chinese (繁體中文) translation of the original text. If the input object contains a "providedTranslation" that is NOT empty, USE IT EXACTLY as the "translation" value.
- Keep each subtitle line concise and translate ONLY its matching line. Do not combine neighboring lines or turn several sentences into one Chinese paragraph.

For each chunk:
1. Tokenize the "originalText" into granular units:
   - If the text is Japanese: Separate Kanji from Okurigana (trailing kana). For example, "呼び方" MUST be split into 3 tokens: ["呼", "び", "方"]. "伝わりました" MUST be split into ["伝", "わりました"]. If inline furigana in parentheses exists like "日本(にほん)", strip parentheses and put "にほん" into 'furigana'.
   - If the text is English: Split by words and punctuation normally.
2. For each token, extract the following fields strictly:
   - "word": The original token (e.g., "台湾", "私", "apple", "running", "."). This MUST NEVER be empty.
   - "furigana": For Japanese, the reading in Hiragana (output "" if already Kana). For English, output "".
   - "romaji": For Japanese, the rōmaji reading. For English, output "".

Respond strictly as a JSON array of line objects.
Each line object should have:
- "id": string (preserve from input)
- "originalText": string (preserve exactly)
- "translation": string
- "startTime": number (preserve)
- "endTime": number (preserve)
- "words": array of word objects

Input data:
${JSON.stringify(chunk)}
`;

        const response = await fetchGemini({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  originalText: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  startTime: { type: Type.NUMBER },
                  endTime: { type: Type.NUMBER },
                  words: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        word: { type: Type.STRING },
                        furigana: { type: Type.STRING },
                        romaji: { type: Type.STRING },
                      }
                    }
                  }
                }
              }
            }
          }
        }, job);
        checkJob(job);
        let resText = response.text || "[]";
        if(resText.startsWith("\`\`\`json")) {
          resText = resText.replace(/^\`\`\`json\n/, "").replace(/\n\`\`\`$/, "");
        }
        
        const parsed = JSON.parse(resText);
        const parsedById = new Map((Array.isArray(parsed) ? parsed : []).map((item: any) => [String(item?.id || ''), item]));
        // Programmatically enforce one output per prepared sentence even if the model ignores instructions.
        const uniqueParsed = chunk.map((source: any, pIdx: number) => {
          const analyzed: any = parsedById.get(String(source.id || '')) || (Array.isArray(parsed) ? parsed[pIdx] : null) || {};
          const normalized = (value: string) => value.normalize('NFKC').replace(/\s/gu, '');
          const validWords = Array.isArray(analyzed.words) && analyzed.words.length > 0
            && !analyzed.words.some((word: any) => /[A-Za-z]/.test(word.word || '') && /\s/.test(String(word.word || '').trim()))
            && normalized(analyzed.words.map((word: any) => word.word || '').join('')) === normalized(source.originalText || '');
          const words = validWords ? analyzed.words.map(({ pos: _pos, ...word }: any) => word) : plainSubtitleWords(source.originalText || '');
          return {
            ...analyzed,
            id: `${source.id || `line_${Date.now()}`}_${i}_${pIdx}`,
            originalText: source.originalText || '',
            translation: analyzed.translation || source.providedTranslation || '',
            startTime: source.startTime ?? -1,
            endTime: source.endTime ?? -1,
            words: attachWordTimings(words, source.wordTimings),
          };
        });
        
        processedChunks[chunkIndex] = uniqueParsed;
        completedChunks += 1;
        publish(processedChunks.flatMap((processed, index) => processed || placeholderChunks[index]));
        setStatusText(`已完成 ${completedChunks}/${chunks.length} 批，字幕可先開始點讀...`);
      };

      let nextChunkIndex = 0;
      const worker = async () => {
        while (nextChunkIndex < chunks.length) {
          checkJob(job);
          const chunkIndex = nextChunkIndex++;
          await processChunk(chunks[chunkIndex], chunkIndex);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, chunks.length) }, () => worker())
      );
      checkJob(job);
      
      setStatusText("所有文稿處理完成！");
      setTimeout(() => { if (isCurrentJob(job)) setStatusText(""); }, 3000);
      setIsProcessing(false);
      return processedChunks.flat();
    } catch (e: any) {
      if (!isCurrentJob(job)) return;
      job.controller.abort();
      setStatusText(`處理中斷: ${e.message}`);
      console.error(e);
    }
    setIsProcessing(false);
  };

  // Helper to parse pasted YouTube transcript text with timestamps
  const parsePastedCoordinates = (text: string) => {
    const rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const result: any[] = [];
    const timeRegex = /^(?:\d{1,2}:)?\d{1,2}:\d{2}$/; // e.g. "0:06", "1:23", "01:23:45"
    
    // Quick scan to detect alternating YouTube format
    let timeCount = 0;
    for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
      if (timeRegex.test(rawLines[i])) timeCount++;
    }
    
    if (timeCount >= 2) {
      let currentTimeVal = -1;
      let currentTextStr = "";
      
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (timeRegex.test(line)) {
          if (currentTimeVal !== -1 && currentTextStr.trim()) {
            result.push({
              id: `pasted_${Date.now()}_${result.length}`,
              originalText: currentTextStr.trim(),
              startTime: currentTimeVal,
              endTime: -1
            });
            currentTextStr = "";
          }
          currentTimeVal = parseVttTime(line);
        } else {
          currentTextStr += (currentTextStr ? " " : "") + line;
        }
      }
      if (currentTimeVal !== -1 && currentTextStr.trim()) {
        result.push({
          id: `pasted_${Date.now()}_${result.length}`,
          originalText: currentTextStr.trim(),
          startTime: currentTimeVal,
          endTime: -1
        });
      }
    } else {
      // Inline coordinates bracket format: e.g. "[00:12.34] Hello World"
      const inlineTimeRegex = /^[\[\(]([\d:.,]+)[\]\)]\s*(.*)$/;
      for (const line of rawLines) {
        const match = line.match(inlineTimeRegex);
        if (match) {
          const timeVal = parseVttTime(match[1]);
          result.push({
            id: `pasted_${Date.now()}_${result.length}`,
            originalText: match[2].trim(),
            startTime: timeVal,
            endTime: -1
          });
        }
      }
    }
    
    // Post-process to calculate endTimes
    for (let i = 0; i < result.length; i++) {
      if (result[i].endTime === -1) {
        if (i < result.length - 1) {
          result[i].endTime = result[i + 1].startTime;
        } else {
          result[i].endTime = result[i].startTime + 3; // default last line duration 3s
        }
      }
    }
    return result;
  };

  const decodeAudioTo16kMono = async (url: string, job: SubtitleJob, region?: AudioRegion) => {
    const source = /^https?:/i.test(url) ? `/api/media-proxy?url=${encodeURIComponent(url)}` : url;
    let response = await fetch(source, { signal: job.controller.signal });
    if (!response.ok && source !== url) response = await fetch(url, { signal: job.controller.signal });
    if (!response.ok) throw new Error(`無法讀取音檔（HTTP ${response.status}）`);
    const encoded = await response.arrayBuffer();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const context = new AudioContextClass();
    try {
      const decoded: AudioBuffer = await context.decodeAudioData(encoded);
      checkJob(job);
      if (decoded.duration > 60 * 60) throw new Error("瀏覽器版 Whisper 目前支援最長 60 分鐘的音檔");
      return resampleAudioRegion(decoded, region);
    } finally {
      await context.close();
    }
  };

  const transcribeLocalWithWhisper = async (job: SubtitleJob, region?: AudioRegion, referenceLines?: any[], refresh = false) => {
    setLastTranscriptMode('generate');
    setIsProcessing(true);
    setStatusText(region ? `正在準備 A/B 片段（${(region.end - region.start).toFixed(1)} 秒）…` : "正在解碼本機音檔…");
    setShowCopyPasteGuide(false);
    try {
      const stableKey = mediaKey || await resolveTranscriptMediaKey(audioUrl, job.controller.signal);
      checkJob(job);
      const cacheMedia = stableKey && region ? `${stableKey}|whisper:${region.start}:${region.end}` : stableKey;
      if (cacheMedia && !referenceLines && !refresh) {
        const cached = await readTranscriptCache(cacheMedia, 'generate', requestedLanguage);
        checkJob(job);
        if (cached) {
          if (cached.lines?.length) {
            setLines(region ? mergeRegionLines(lines, cached.lines, region) : cached.lines);
            setStatusText('已直接載入字幕與逐字時間戳，無需再次執行 Whisper。');
            setIsProcessing(false);
          } else {
            const completed = await processTextWithGemini('', cached.raw, job, region);
            if (completed?.length && isCurrentJob(job)) await writeTranscriptCache({ ...cached, lines: completed });
          }
          return;
        }
      }
      const { samples, start, end } = await decodeAudioTo16kMono(audioUrl, job, region);
      checkJob(job);
      setStatusText("正在載入免費 Whisper 模型（首次使用時間較長）…");
      const worker = ensureWhisperWorker();
      const output: any = await new Promise((resolve, reject) => {
        const cleanup = () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          job.controller.signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          cleanup();
          worker.terminate();
          if (whisperWorkerRef.current === worker) { whisperWorkerRef.current = null; setModelState('idle'); }
          reject(new DOMException('已取消', 'AbortError'));
        };
        const onError = () => { cleanup(); reject(new Error('Whisper 工作中斷')); };
        const onMessage = (event: MessageEvent<any>) => {
          if (!isCurrentJob(job)) { onAbort(); return; }
          const message = event.data;
          if (message.type === 'progress') {
            const percent = Number(message.progress?.progress);
            const file = message.progress?.file || "模型";
            setStatusText(Number.isFinite(percent) ? `正在下載 ${file}… ${Math.round(percent)}%` : "正在準備 Whisper 模型…");
          } else if (message.type === 'status') {
            setStatusText(message.message);
          } else if (message.type === 'result') {
            cleanup();
            resolve(message.output);
          } else if (message.type === 'error') {
            cleanup();
            reject(new Error(message.message));
          }
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        job.controller.signal.addEventListener('abort', onAbort, { once: true });
        checkJob(job);
        worker.postMessage({ audio: samples.buffer }, [samples.buffer]);
      });
      checkJob(job);

      const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
      if (referenceLines) {
        if (!output.wordTimestamped) throw new Error('Whisper 未能取得逐字時間戳，原字幕保留；請改用 AI 語音辨識取得整句字幕。');
        const measured = chunks.map((chunk: any) => ({ text: String(chunk.text || ''),
          startTime: Number(chunk.timestamp?.[0]), endTime: Number(chunk.timestamp?.[1]) }));
        const aligned = alignSuppliedTranscript(prepareReadableTranscript(referenceLines), measured);
        checkJob(job);
        if (stableKey) await writeTranscriptCache({ media: stableKey, language: 'und', requestedLanguage, mode: 'generate', raw: aligned, placeholderCount: 0 });
        checkJob(job);
        const completed = await processTextWithGemini('', aligned, job);
        if (stableKey && completed?.length && isCurrentJob(job)) {
          await writeTranscriptCache({ media: stableKey, language: 'und', requestedLanguage,
            mode: 'generate', raw: aligned, lines: completed, placeholderCount: 0 });
        }
        if (isCurrentJob(job)) setStatusText('字幕已對上語音時間：有完整時間的句子逐字提示，其餘以整句提示。');
        return;
      }

      const mapped = resegmentTimedTranscript(normalizeTimedTranscript(chunks.map((chunk: any, index: number) => ({
        id: `whisper_${start}_${index}`,
        originalText: String(chunk.text || '').trim(),
        startTime: Math.min(end, start + Number(chunk.timestamp?.[0] ?? 0)),
        endTime: Math.min(end, start + Number(chunk.timestamp?.[1] ?? (Number(chunk.timestamp?.[0] ?? 0) + 3))),
        ...(output.wordTimestamped ? { wordTimings: chunk.timestamp?.[0] != null && chunk.timestamp?.[1] != null
          ? [{ text: String(chunk.text || ''), startTime: Math.min(end, start + Number(chunk.timestamp[0])), endTime: Math.min(end, start + Number(chunk.timestamp[1])) }]
          : [] } : {}),
      })).filter((line: any) => line.originalText && line.endTime > line.startTime)));
      if (mapped.length === 0) throw new Error("Whisper 未辨識出可用語音");
      if (!region) setPlaceholderCount(0);
      setStatusText(`Whisper 已辨識 ${mapped.length} 段，正在分析與翻譯…`);
      const entry = { media: cacheMedia || '', language: 'und', requestedLanguage, mode: 'generate' as const, raw: mapped, placeholderCount: 0 };
      if (cacheMedia) await writeTranscriptCache(entry);
      checkJob(job);
      const completed = await processTextWithGemini("", mapped, job, region ? { start, end } : undefined);
      if (cacheMedia && completed?.length && isCurrentJob(job)) await writeTranscriptCache({ ...entry, lines: completed });
    } catch (error: any) {
      if (!isCurrentJob(job)) return;
      setStatusText(`AI 語音辨識失敗：${error.message}`);
      setIsProcessing(false);
    }
  };

  const loadRemoteTranscript = async (mode: TranscriptMode, refresh = false) => {
    const job = beginJob();
    setLastTranscriptMode(mode);
    const isYoutube = /(?:youtube\.com|youtu\.be)/i.test(audioUrl);
    if (!audioUrl || (mode === 'native' && !isYoutube)) {
      setStatusText(mode === 'native' ? "原生字幕只支援 YouTube 網址。" : "請先載入影片或音檔網址！");
      setTimeout(() => { if (isCurrentJob(job)) setStatusText(""); }, 3000);
      return;
    }
    if (mode === 'generate' && audioUrl.startsWith('blob:')) {
      await transcribeLocalWithWhisper(job, undefined, undefined, refresh);
      return;
    }
    if (!/^https?:\/\//i.test(audioUrl)) {
      setStatusText("AI 語音辨識需要公開網址，或從電腦重新上傳音檔。");
      return;
    }
    setIsProcessing(true);
    setStatusText(mode === 'native' ? "正在讀取 YouTube 原生字幕…" : "AI 正在聆聽並產生字幕，時間會比原生字幕久…");
    setShowCopyPasteGuide(false);
    
    try {
      if (mediaKey && !refresh) {
        const cached = await readTranscriptCache(mediaKey, mode, requestedLanguage);
        checkJob(job);
        if (cached) {
          setPlaceholderCount(cached.placeholderCount);
          if (cached.lines?.length) {
            setLines(cached.lines);
            setStatusText(`已從快取載入 ${cached.language === 'und' ? '' : cached.language + ' '}字幕，無需重新辨識與翻譯。`);
            setIsProcessing(false);
            return;
          }
          setStatusText('已從快取載入原文，正在補上分析與翻譯…');
          const completed = await processTextWithGemini('', cached.raw, job);
          if (completed?.length && isCurrentJob(job)) await writeTranscriptCache({ ...cached, lines: completed });
          return;
        }
      }
      const parseResponse = async (res: Response) => {
        const payload = await res.json().catch(() => ({}));
        checkJob(job);
        if (!res.ok && res.status !== 202) {
          throw new Error(payload.message || payload.error || "無可用字幕或發生錯誤");
        }
        return payload;
      };

      let res = await fetch(`/api/yt-transcript?url=${encodeURIComponent(audioUrl)}&mode=${mode}`, { signal: job.controller.signal });
      let data = await parseResponse(res);

      if (res.status === 202) {
        const jobId = data.jobId;
        if (!jobId) throw new Error("字幕服務已接受請求，但未回傳工作編號");

        let completed = false;
        for (let attempt = 1; attempt <= 40; attempt++) {
          setStatusText(`${mode === 'generate' ? 'AI 語音辨識' : '字幕'}處理中…（${attempt}/40）`);
          await waitForPoll(job);
          checkJob(job);
          res = await fetch(`/api/yt-transcript?jobId=${encodeURIComponent(jobId)}`, { signal: job.controller.signal });
          data = await parseResponse(res);
          if (res.status !== 202) {
            completed = true;
            break;
          }
        }
        if (!completed) throw new Error("AI 處理時間較長，請稍後再試一次");
      }

      const transcript = Array.isArray(data) ? data : (data.transcript || data.content);
      if (!Array.isArray(transcript) || transcript.length === 0) {
        throw new Error("這部影片沒有可用的 YouTube 字幕");
      }
      
      // format to match prompt mapping
      const mapped = resegmentTimedTranscript(normalizeTimedTranscript(transcript.map((d: any, idx: number) => ({
        id: `${mode === 'generate' ? 'ai' : 'yt'}_${idx}`,
        originalText: d.text,
        startTime: d.offset / 1000,
        endTime: (d.offset + d.duration) / 1000
      }))));

      const musicMarkers = mapped.filter((line: any) => PLACEHOLDER_CAPTION.test(line.originalText)).length;
      setPlaceholderCount(mode === 'native' ? musicMarkers : 0);
      
      const detectedLanguage = data.language || transcript[0]?.lang;
      const entry = { media: mediaKey || '', language: detectedLanguage || 'und', requestedLanguage, mode, raw: mapped, placeholderCount: mode === 'native' ? musicMarkers : 0 };
      if (mediaKey) await writeTranscriptCache(entry);
      checkJob(job);
      setStatusText(detectedLanguage ? `已取得 ${detectedLanguage} ${mode === 'generate' ? 'AI' : '原生'}字幕，正在分析與翻譯…` : "正在進行語言分析與翻譯…");
      const completed = await processTextWithGemini("", mapped, job);
      if (mediaKey && completed?.length && isCurrentJob(job)) await writeTranscriptCache({ ...entry, lines: completed });
      
    } catch(e: any) {
      if (!isCurrentJob(job)) return;
      setStatusText(`${mode === 'generate' ? 'AI 語音辨識' : '讀取'}失敗：${e.message}`);
      setIsProcessing(false);
      setShowCopyPasteGuide(mode === 'native');
    }
  };

  const loadYoutubeTranscript = () => loadRemoteTranscript('native');
  const loadAiTranscript = () => loadRemoteTranscript('generate');
  const validRegion = typeof pointA === 'number' && typeof pointB === 'number'
    && Number.isFinite(pointA) && Number.isFinite(pointB) && pointA >= 0 && pointB > pointA;
  const embeddedMedia = /(?:youtube\.com|youtu\.be|dailymotion\.com|dai\.ly|vimeo\.com)/i.test(audioUrl);
  const canReadAudio = !!audioUrl && !embeddedMedia;
  useEffect(() => {
    // Check the subtitle cache first: revisiting an already recognized file should
    // not download or initialize Whisper at all.
    if (canReadAudio && cacheCheckedMedia === audioUrl && !lines.length && modelState === 'idle' && modelPreparedMediaRef.current !== audioUrl) prepareWhisperModel();
  }, [audioUrl, cacheCheckedMedia, canReadAudio, lines.length, modelState]);
  const loadWhisperRegion = () => {
    if (!validRegion || !canReadAudio) return;
    void transcribeLocalWithWhisper(beginJob(), { start: pointA!, end: pointB! });
  };

  const handleManualInput = () => {
    if(!inputText.trim()) return;
    setIsProcessing(true);
    setStatusText("正在進行語言分析與翻譯...");
    
    const coordinated = parsePastedCoordinates(inputText);
    if (coordinated.length > 0) {
      processTextWithGemini("", coordinated);
    } else if (canReadAudio) {
      void transcribeLocalWithWhisper(beginJob(), undefined, [{ id: `supplied_${Date.now()}`,
        originalText: inputText, startTime: -1, endTime: -1 }]);
    } else {
      processTextWithGemini(inputText);
    }
  };

  const synchronizeSuppliedSubtitles = () => {
    if (!canReadAudio || !lines.length) return;
    const reference = lines.map(line => ({ ...line, startTime: line.startTime ?? -1,
      endTime: line.endTime ?? -1, providedTranslation: line.translation,
      wordTimings: undefined, words: undefined }));
    void transcribeLocalWithWhisper(beginJob(), undefined, reference);
  };

  const [isPanelDragging, setIsPanelDragging] = useState(false);

  const parseVttTime = (timeStr: string) => {
    if (!timeStr) return -1;
    const parts = timeStr.trim().replace(',', '.').split(':');
    let secs = 0;
    if (parts.length === 3) {
        secs += parseFloat(parts[0]) * 3600;
        secs += parseFloat(parts[1]) * 60;
        secs += parseFloat(parts[2]);
    } else if (parts.length === 2) {
        secs += parseFloat(parts[0]) * 60;
        secs += parseFloat(parts[1]);
    }
    return secs;
  };

  const parseSubtitles = (content: string, filename: string) => {
    const lines: any[] = [];
    const isVtt = filename.toLowerCase().endsWith('.vtt');
    const isSrt = filename.toLowerCase().endsWith('.srt');
    
    if (isVtt || isSrt) {
        const blocks = content.split(/\r?\n\r?\n/);
        for (const block of blocks) {
            const linesSplit = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
            if (linesSplit.length === 0) continue;
            if (isVtt && linesSplit[0] === 'WEBVTT') continue;
            
            const timecodeLine = linesSplit.find(l => l.includes('-->'));
            if (!timecodeLine) continue;
            
            const timecodes = timecodeLine.split('-->').map(s => s.trim());
            const startTime = parseVttTime(timecodes[0]);
            const endTime = parseVttTime(timecodes[1]);
            const textIndex = linesSplit.indexOf(timecodeLine) + 1;
            const text = linesSplit.slice(textIndex).join('\n').replace(/<[^>]+>/g, '').trim();
            
            if (text) {
                lines.push({
                    id: `sub_${Date.now()}_${lines.length}`,
                    originalText: text,
                    startTime,
                    endTime
                });
            }
        }
    }
    return lines;
  };

  const parseImageToMappedLines = (file: File, job: SubtitleJob): Promise<any[]> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const maxDim = 1024;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        } else {
                            width = Math.round((width * maxDim) / height);
                            height = maxDim;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return resolve([]);
                    ctx.drawImage(img, 0, 0, width, height);
                    const resizedBase64 = canvas.toDataURL(file.type || 'image/jpeg', 0.8).split(',')[1];
                    
                    if(resizedBase64) {
                        try {
                            const response = await fetchGemini({
                                model: "gemini-2.5-flash",
                                contents: [
                                    {
                                        role: "user",
                                        parts: [
                                            { text: `Extract ALL text from this image completely and accurately. DO NOT OMIT ANY TEXT. Be extremely careful to include the very last words and sentences (e.g. sentence endings).
CRITICAL INSTRUCTION:
Return ONLY a raw valid JSON array of objects (no markdown, no backticks).
Analyze the layout. If the image contains foreign language text (English or Japanese) accompanied by Chinese translation, pair them together accurately paragraph by paragraph.
Each object MUST have:
- "originalText": "The foreign text completely transcribed without truncation."
- "providedTranslation": "The Chinese translation found in the image. Leave empty if none exists."` },
                                            { inlineData: { data: resizedBase64, mimeType: file.type || 'image/jpeg' } }
                                        ]
                                    }
                                ]
                            }, job);
                            checkJob(job);
                            
                            let resText = (response?.text || "[]").trim();
                            if(resText.startsWith("```json")) {
                                resText = resText.replace(/^```json\n?/, "").replace(/\n?```$/, "");
                            }
                            
                            try {
                                const parsedImageLines = JSON.parse(resText);
                                const mappedLines = parsedImageLines.map((line: any, idx: number) => ({
                                    id: `img_${Date.now()}_${idx}`,
                                    originalText: line.originalText,
                                    providedTranslation: line.providedTranslation || "",
                                    startTime: -1,
                                    endTime: -1
                                })).filter((L: any) => L.originalText.trim() !== "");
                                resolve(mappedLines);
                            } catch(err) {
                                resolve([{ id: `img_${Date.now()}`, originalText: resText, providedTranslation: "", startTime: -1, endTime: -1 }]);
                            }
                        } catch (e) {
                            resolve([]);
                        }
                    } else {
                        resolve([]);
                    }
                };
                img.onerror = () => resolve([]);
                img.src = event.target?.result as string;
            } catch(err) {
                resolve([]);
            }
        };
        reader.onerror = () => resolve([]);
        reader.readAsDataURL(file);
    });
  };

  const processMultipleFiles = async (files: FileList | File[]) => {
    const job = beginJob();
    setIsProcessing(true);
    let allMappedLines: any[] = [];
    let combinedText = "";
    
    for (let i = 0; i < files.length; i++) {
        if (!isCurrentJob(job)) return;
        const file = files[i];
        setStatusText(`正在處理檔案 ${i + 1}/${files.length}: ${file.name}...`);
        
        if (file.type.startsWith('image/')) {
            const lines = await parseImageToMappedLines(file, job);
            if (!isCurrentJob(job)) return;
            if (lines.length > 0) allMappedLines.push(...lines);
        } else {
            const text = await file.text();
            if (!isCurrentJob(job)) return;
            if (file.name.toLowerCase().endsWith('.srt') || file.name.toLowerCase().endsWith('.vtt')) {
                const lines = parseSubtitles(text, file.name);
                if (lines.length > 0) allMappedLines.push(...lines);
            } else {
                combinedText += text + "\n";
            }
        }
    }
    
    if (allMappedLines.length > 0 && combinedText.trim()) {
        const extraLines = combinedText.split(/[。\n!?.?;,，]/).filter(t => t.trim().length > 0).map((t, i) => ({ id: `manual_${Date.now()}_${i}`, originalText: t.trim(), startTime: -1, endTime: -1 }));
        allMappedLines.push(...extraLines);
    } else if (combinedText.trim() && allMappedLines.length === 0) {
        setInputText(combinedText);
        setStatusText("檔案載入完成，請點擊「分析文稿」!");
        setIsProcessing(false);
        return;
    }

    if (allMappedLines.length > 0) {
        setStatusText("所有檔案解析完成，正在進行語言分析與翻譯...");
        await processTextWithGemini("", allMappedLines, job);
    } else {
        setStatusText("無法解析任何內容。");
        setIsProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processMultipleFiles(files);
  };

  const handlePanelDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsPanelDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processMultipleFiles(e.dataTransfer.files);
    }
  };

  const translateToLanguage = async (targetLanguage: string) => {
    if (lines.length === 0) return;
    const job = beginJob();
    setIsProcessing(true);
    setStatusText(`正在翻譯至 ${targetLanguage}...`);

    try {
        const CHUNK_SIZE = 20;
        let translatedLines = [...lines];

        for (let i = 0; i < translatedLines.length; i += CHUNK_SIZE) {
            const chunk = translatedLines.slice(i, i + CHUNK_SIZE);
            setStatusText(`正在翻譯第 ${i + 1} ~ ${Math.min(i + CHUNK_SIZE, translatedLines.length)} 句 (${targetLanguage})...`);

            const prompt = `Translate the following JSON array of subtitle objects into ${targetLanguage}.
You MUST return the exact same JSON structure, updating ONLY the "translation" field with the translated text.

Input JSON:
${JSON.stringify(chunk.map((c) => ({ id: c.id, text: c.originalText })))}

Return ONLY a valid JSON array of objects, containing "id" and "translation" fields. No markdown, no backticks.
`;

            const response = await fetchGemini({
              model: "gemini-2.5-flash",
              contents: prompt,
              config: {
                 responseMimeType: "application/json",
                 responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            translation: { type: Type.STRING }
                        }
                    }
                 }
              }
            }, job);
            checkJob(job);
            let resText = response.text || "[]";
             if(resText.startsWith("```json")) {
               resText = resText.replace(/^```json\n?/, "").replace(/\n?```$/, "");
             }
            const parsedTranslations = JSON.parse(resText);
            
            parsedTranslations.forEach((pt: any) => {
                const lineIndex = translatedLines.findIndex(l => l.id === pt.id);
                if (lineIndex !== -1) {
                    translatedLines[lineIndex] = { ...translatedLines[lineIndex], translation: pt.translation };
                }
            });
            setLines([...translatedLines]);
        }
        setStatusText("翻譯完成！");
        setTimeout(() => { if (isCurrentJob(job)) setStatusText(""); }, 3000);
    } catch(e: any) {
        if (!isCurrentJob(job)) return;
        setStatusText(`翻譯失敗: ${e.message}`);
        console.error(e);
    }
    setIsProcessing(false);
  };

  const seekToLine = (time: number | undefined | null) => {
    if (time !== undefined && time !== null && time !== -1 && playerRef.current) {
        playerRef.current.seekTo(time, 'seconds');
    }
  };

  return (
    <div className="transcript-panel w-full mt-6 bg-[#16161a] border border-[#010101] shadow-2xl rounded-2xl overflow-hidden font-sans">
      <div className="p-4 border-b border-[#010101]/20 flex flex-wrap gap-4 items-center justify-between">
        <h2 className="text-xl font-bold text-[#fffffe] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#7f5af0]" />
            智慧雙語點讀字幕
        </h2>
        <label className="flex items-center gap-2 text-sm text-white">
          字體大小
          <select aria-label="字幕字體大小" value={subtitleFontSize} onChange={event => setSubtitleFontSize(Number(event.target.value))} className="bg-[#242629] border border-white/20 rounded-lg px-2 py-2">
            {[14, 15, 17, 19, 21, 24, 28].map(size => <option key={size} value={size}>{size}px</option>)}
          </select>
        </label>
        {isProcessing && <button type="button" onClick={cancelJob} className="px-3 py-2 rounded-lg border border-red-400/50 text-red-300 text-sm font-bold">取消字幕處理</button>}
        
        <div className="secondary-tool flex flex-wrap gap-2 items-center">
            {onSubtitleOffsetChange && (
              <div className="flex items-center rounded-lg border border-white/10 bg-black/20 overflow-hidden text-xs font-bold text-white" title="說話比字幕早：按「字幕提前」；說話比字幕晚：按「字幕延後」">
                <button
                  type="button"
                  onClick={() => onSubtitleOffsetChange(Math.max(-5, Number((subtitleOffset - 0.25).toFixed(2))))}
                  className="px-2.5 py-1.5 hover:bg-white/10 transition-colors"
                >字幕延後</button>
                <span className="min-w-[58px] text-center text-[#e2b714] border-x border-white/10">{subtitleOffset >= 0 ? '+' : ''}{subtitleOffset.toFixed(2)}s</span>
                <button
                  type="button"
                  onClick={() => onSubtitleOffsetChange(Math.min(5, Number((subtitleOffset + 0.25).toFixed(2))))}
                  className="px-2.5 py-1.5 hover:bg-white/10 transition-colors"
                >字幕提前</button>
                <button
                  type="button"
                  aria-label="重設字幕同步"
                  title="重設字幕同步"
                  onClick={() => onSubtitleOffsetChange(0)}
                  className="px-2 py-1.5 hover:bg-white/10 transition-colors border-l border-white/10"
                ><RotateCcw className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm font-bold text-[#fffffe] bg-black/20 px-3 py-1.5 rounded-lg border border-white/10 cursor-pointer hover:bg-black/40 transition-colors">
               <input 
                 type="checkbox" 
                 checked={autoScroll} 
                 onChange={(e) => setAutoScroll(e.target.checked)} 
                 className="accent-[#7f5af0] w-4 h-4"
               />
               自動捲動
            </label>
            <button 
               onClick={loadYoutubeTranscript}
               disabled={isProcessing}
               className="px-3 py-1.5 rounded-lg bg-[#2cb67d] text-white flex items-center gap-1.5 text-sm font-bold opacity-90 hover:opacity-100 disabled:opacity-50 transition-all">
                <Youtube className="w-4 h-4" />
                讀取 YT 原生字幕
            </button>
            <button
               onClick={loadAiTranscript}
               disabled={isProcessing || !audioUrl}
               title="YouTube／公開媒體網址由雲端 AI 聽寫；本機音檔使用瀏覽器內免費 Whisper"
               className="px-3 py-1.5 rounded-lg bg-[#7f5af0] text-white flex items-center gap-1.5 text-sm font-bold opacity-90 hover:opacity-100 disabled:opacity-50 transition-all">
                <AudioLines className="w-4 h-4" />
                AI 語音辨識
            </button>
            <button type="button" onClick={synchronizeSuppliedSubtitles}
               disabled={isProcessing || !canReadAudio || !lines.length}
               title="用免費 Whisper 取得實際語音時間，對齊已輸入的字幕；首次會下載模型"
               className="px-3 py-1.5 rounded-lg border border-[#7f5af0]/50 text-[#a78bfa] text-sm font-bold disabled:opacity-40 hover:bg-[#7f5af0]/10">
               同步音檔字幕
            </button>
            <button type="button" onClick={loadWhisperRegion}
               disabled={isProcessing || !validRegion || !canReadAudio}
               title={embeddedMedia ? '嵌入影片無法直接取得音訊，請上傳音檔後使用 Whisper' : !validRegion ? '請先設定有效的 A/B 區間' : '只辨識 A/B 片段，取代重疊字幕並保留其他句子；網路音檔需允許跨來源讀取'}
               className="px-3 py-1.5 rounded-lg border border-[#7f5af0]/50 text-[#a78bfa] flex items-center gap-1.5 text-sm font-bold disabled:opacity-40 hover:bg-[#7f5af0]/10">
               <AudioLines className="w-4 h-4" />Whisper 辨識 A/B
            </button>
            <button 
               onClick={() => fileInputRef.current?.click()}
               disabled={isProcessing}
               className="px-3 py-1.5 rounded-lg bg-[#72757e] text-white flex items-center gap-1.5 text-sm font-bold opacity-90 hover:opacity-100 disabled:opacity-50 transition-all">
                <Upload className="w-4 h-4" />
                上傳圖檔/字幕
            </button>
            <button
               type="button"
               onClick={() => loadRemoteTranscript(lastTranscriptMode, true)}
               disabled={isProcessing || !mediaKey}
               title="略過已保存的字幕，重新讀取並更新目前辨識模式的結果"
               className="px-3 py-1.5 rounded-lg border border-white/10 text-[#94a1b2] text-sm disabled:opacity-50 hover:text-white">
               重新讀取字幕
            </button>
            <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} accept="image/*,.srt,.vtt,.txt" className="hidden" />
        </div>
      </div>

      {modelState !== 'idle' && (
        <div className="mx-4 mt-3 p-3 rounded-xl border border-[#7f5af0]/30 bg-[#7f5af0]/5 text-sm text-[#fffffe]" role="status" aria-live="polite">
          <p>{modelState === 'loading' ? 'Whisper 正在背景準備模型，您可以繼續播放音檔。首次會下載，之後優先使用瀏覽器快取。'
            : modelState === 'ready' ? (modelCacheAvailable ? 'Whisper 模型已就緒；瀏覽器會快取模型，下次優先直接載入。' : 'Whisper 模型已就緒，但此瀏覽器無法保存模型快取。')
            : `Whisper 模型準備失敗：${modelError}`}</p>
          {modelState === 'loading' && (Object.entries(modelFiles) as [string, { percent?: number; loaded?: number }][]).map(([file, progress]) => (
            <div key={file} className="mt-2">
              <div className="flex justify-between gap-2 text-xs"><span className="truncate">{file}</span>
                <span>{progress.percent !== undefined ? `${Math.round(progress.percent)}%` : '準備中'}{progress.loaded ? ` · ${(progress.loaded / 1048576).toFixed(1)} MB` : ''}</span></div>
              <progress aria-label={`${file} 載入進度`} max={100} value={progress.percent} className="w-full h-2 accent-[#7f5af0]" />
            </div>
          ))}
          {modelState === 'error' && <button type="button" onClick={prepareWhisperModel} disabled={isProcessing} className="mt-2 px-3 py-1 rounded-lg border border-[#7f5af0]/50 disabled:opacity-40">重新下載模型</button>}
        </div>
      )}

      {placeholderCount > 0 && (
        <div className="mx-4 mt-4 p-3 rounded-xl bg-[#e2b714]/10 border border-[#e2b714]/30 text-sm text-[#fffffe] flex flex-wrap items-center justify-between gap-3">
          <span>偵測到 {placeholderCount} 段只有「音樂／Music」的原生字幕；可讓 AI 重新聆聽整段媒體來補足台詞。</span>
          <button
            type="button"
            onClick={loadAiTranscript}
            disabled={isProcessing}
            className="px-3 py-1.5 rounded-lg bg-[#e2b714] text-black font-bold disabled:opacity-50"
          >改用 AI 語音辨識</button>
        </div>
      )}

      {lines.length === 0 && (
        <p className="focus-empty-hint p-3 text-sm text-[#94a1b2]">尚未載入字幕，請按「展開其他工具」讀取或匯入字幕。</p>
      )}
      {lines.length === 0 && (
         <div 
            className="secondary-tool p-6 transition-all"
            onDragOver={(e) => { e.preventDefault(); setIsPanelDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsPanelDragging(false); }}
            onDrop={handlePanelDrop}
         >
            {showCopyPasteGuide && (
              <div className="mb-4 p-4 rounded-xl bg-[#e2b714]/10 border border-[#e2b714]/30 text-sm text-[#fffffe] flex flex-col gap-2">
                <div className="flex items-center justify-between font-bold text-[#e2b714]">
                  <span className="flex items-center gap-1.5 modal-title text-base">⚠️ 目前無法自動取得 YouTube 字幕</span>
                  <button onClick={() => setShowCopyPasteGuide(false)} className="text-white/40 hover:text-white transition-opacity">✕</button>
                </div>
                <p className="opacity-90 leading-relaxed text-xs">
                  可能是影片沒有字幕、字幕服務額度已用完，或服務暫時無法連線。您仍可透過以下步驟貼上 YouTube 官方字幕：
                </p>
                <div className="flex flex-col gap-2 scale-95 mt-1">
                  <div className="flex gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#e2b714] text-black text-xs font-bold leading-none shrink-0 mt-0.5">1</span>
                    <span className="opacity-95 text-xs text-white">在 YouTube 影片頁面下方點擊 <b>「...」（更多項目）</b> 按鈕。</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#e2b714] text-black text-xs font-bold leading-none shrink-0 mt-0.5">2</span>
                    <span className="opacity-95 text-xs text-white">選擇 <b>「顯示原始視窗 / 顯示字幕」(Show transcript)</b>。</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#e2b714] text-black text-xs font-bold leading-none shrink-0 mt-0.5">3</span>
                    <span className="opacity-95 text-xs text-white">全選並<b>「複製」</b>字幕文字（包含時間戳記），直接<b>「貼上」</b>到下方輸入框中，點擊<b>「分析文稿」</b>即可！</span>
                  </div>
                </div>
              </div>
            )}

            <div className={`rounded-xl p-4 border transition-all ${isPanelDragging ? 'bg-[#7f5af0]/10 border-[#7f5af0] scale-[1.02]' : 'bg-black/20 border-white/5 focus-within:border-[#7f5af0]/50'}`}>
                <textarea 
                   className="w-full h-32 bg-transparent text-[#fffffe] outline-none resize-none placeholder:text-white/20"
                   placeholder="手動輸入外語文稿（支援英文字幕、日文文章），或是直接貼上 / 拖曳上傳純文字內容及圖檔..."
                   value={inputText}
                   onChange={(e) => setInputText(e.target.value)}
                />
            </div>
            <div className="mt-4 flex justify-between items-center">
                <span className="text-sm text-[#2cb67d] animate-pulse">{statusText}</span>
                <button 
                  onClick={handleManualInput}
                  disabled={isProcessing || !inputText.trim()}
                  className="px-6 py-2 bg-[#7f5af0] text-white rounded-xl font-bold hover:shadow-lg disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
                  分析文稿
                </button>
            </div>
         </div>
      )}

      {lines.length > 0 && (
        <div ref={scrollContainerRef} className="transcript-scroll p-3 bg-[#16161a] rounded-b-2xl md:rounded-b-3xl w-full border-t border-white/5 relative z-10 transition-all max-h-[60dvh] overflow-y-auto styled-scrollbar">
            <div className="secondary-tool flex border-b border-white/5 pb-4 mb-4 gap-4 items-center">
              <div className="ml-auto flex items-center gap-3">
                 <select 
                    disabled={isProcessing}
                    onChange={(e) => {
                       if(e.target.value) translateToLanguage(e.target.value);
                       e.target.value = "";
                    }}
                    className="bg-[#2cb67d]/20 text-[#2cb67d] border border-[#2cb67d]/30 text-xs px-2 py-1 rounded-md outline-none cursor-pointer hover:bg-[#2cb67d]/30 transition-colors"
                 >
                    <option value="">翻譯為...</option>
                    <option value="繁體中文">繁體中文</option>
                    <option value="简体中文">简体中文</option>
                    <option value="English">English</option>
                    <option value="日本語">日本語</option>
                    <option value="한국어">한국어</option>
                    <option value="Español">Español</option>
                    <option value="Français">Français</option>
                 </select>
                 <button onClick={() => setLines([])} className="text-xs text-[#94a1b2] hover:text-red-400 transition-colors">清除分析</button>
              </div>
            </div>

            <div className="flex flex-col gap-1 w-full pb-24">
               {lines.map((line, lIdx) => {
                   const isActive = lIdx === activeIndex;
                   const hasWordTimings = hasCompleteWordTimings(line.words, line.startTime, line.endTime);
                   const activeWordIndex = isActive ? getActiveWordIndex(line, currentTime) : -1;
                   const lineHasBeenRead = line.endTime !== null && line.endTime >= 0 && currentTime >= line.endTime;
                   const canLoop = !!onLoopLine && typeof line.startTime === 'number' && typeof line.endTime === 'number'
                     && Number.isFinite(line.startTime) && Number.isFinite(line.endTime) && line.startTime >= 0 && line.endTime > line.startTime;
                   const isLoopSelected = canLoop && loopEnabled && loopStart !== null && loopStart !== undefined
                     && loopEnd !== null && loopEnd !== undefined
                     && Math.abs(loopStart - line.startTime!) < 0.02 && Math.abs(loopEnd - line.endTime!) < 0.02;
                   const hasFurigana = line.words.some(word => !!word.furigana);
                   const hasRomaji = line.words.some(word => word.romaji && word.romaji !== word.word);
                   
                   return (
                       <div 
                         key={line.id} 
                         data-index={lIdx}
                         data-highlight-mode={hasWordTimings ? 'word' : 'sentence'}
                         onClick={() => seekToLine(line.startTime)}
                         className={`w-full flex flex-col gap-1 px-2 py-2 rounded-xl transition-all duration-300 cursor-pointer ${isActive ? 'bg-[#7f5af0]/10 border border-[#7f5af0]/50 shadow-lg shadow-[#7f5af0]/20 z-10 opacity-100 relative' : 'bg-transparent border border-transparent opacity-70 hover:opacity-100 hover:bg-white/5'}`}
                       >
                            {isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1/2 bg-[#7f5af0] rounded-r-full shadow-[0_0_10px_#7f5af0] animate-pulse"></div>
                            )}
                            <div className="flex items-start gap-2 w-full">
                            {onLoopLine && <button
                              type="button"
                              disabled={!canLoop}
                              aria-label={`循環第 ${lIdx + 1} 句字幕`}
                              aria-pressed={!!isLoopSelected}
                              title={canLoop ? '將此句設為 A/B 並循環播放' : '這句字幕沒有有效起訖時間'}
                              onClick={event => { event.stopPropagation(); if (canLoop) onLoopLine(line); }}
                              className={`shrink-0 min-h-10 px-2 rounded-lg text-xs font-bold border flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed ${isLoopSelected ? 'bg-[#7f5af0] text-white border-[#7f5af0]' : 'text-[#a78bfa] border-[#7f5af0]/30 hover:bg-[#7f5af0]/20'}`}>
                              <RotateCcw className="w-4 h-4" />循環
                            </button>}
                            <div className="flex flex-wrap items-start gap-y-1 gap-x-1 flex-1 min-w-0">
                                {line.words.map((word, idx) => {
                                    const isWordActive = isActive && activeWordIndex === idx;
                                    const hasBeenRead = lineHasBeenRead || (hasWordTimings && word.endTime !== undefined && currentTime >= word.endTime);
                                    const displayWord = word.word || word.romaji || " ";
                                    const displayRomaji = (word.romaji && word.romaji !== word.word) ? word.romaji : "";
                                    
                                    const bottomLabel = displayRomaji;

                                    return (
                                        <div key={idx} className="grid justify-items-center items-center mx-[1px] leading-none shrink-0 group" style={{ gridTemplateRows: `${hasFurigana ? '12px ' : ''}${subtitleFontSize + 11}px${hasRomaji ? ' 12px' : ''}` }}>
                                            {hasFurigana && <span aria-hidden={!word.furigana} className={`text-[9px] font-medium whitespace-nowrap transition-colors ${isWordActive ? "text-[#fffffe]" : "text-[#94a1b2] opacity-90"}`}>{word.furigana || '\u00a0'}</span>}
                                            <span
                                                data-reading-state={isWordActive ? 'current' : hasBeenRead ? 'read' : 'upcoming'}
                                                aria-current={isWordActive ? 'true' : undefined}
                                                className={`text-[17px] leading-snug font-semibold ${WORD_STYLES} transition-colors duration-100 shadow-sm h-7 box-border flex items-center justify-center ${isWordActive ? "ring-2 ring-[#a78bfa] z-10" : ""}`}
                                                style={{ fontSize: subtitleFontSize, height: subtitleFontSize + 11, ...(isWordActive
                                                    ? { color: '#ffffff', backgroundColor: '#7f5af0', borderRadius: '6px', boxShadow: '0 0 10px rgba(127,90,240,0.35)' }
                                                    : hasBeenRead
                                                        ? { color: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)' }
                                                        : {}) }}
                                            >
                                                {displayWord}
                                            </span>
                                            {hasRomaji && <span aria-hidden={!bottomLabel} className={`text-[9px] whitespace-nowrap font-mono italic transition-opacity ${isWordActive ? "text-[#fffffe] opacity-100" : "text-[#94a1b2] opacity-80 group-hover:opacity-100"}`}>{bottomLabel || '\u00a0'}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                            </div>
                            <p style={{ fontSize: Math.max(13, subtitleFontSize - 2) }} className="text-[#fffffe] opacity-80 text-[15px] leading-snug border-t border-white/5 pt-1 mt-0.5 w-full">
                                {line.translation}
                            </p>
                       </div>
                   );
               })}
            </div>
            
            {statusText && <div className="text-center mt-4 text-[#7f5af0] font-bold text-sm animate-pulse">{statusText}</div>}
        </div>
      )}

    </div>
  );
}
