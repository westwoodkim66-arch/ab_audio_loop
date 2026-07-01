/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Keyboard, Play, Pause, RotateCcw, RotateCw, SkipBack, SkipForward, Settings2, Trash2, Volume2, Link as LinkIcon, Info, Upload, FileAudio, FileText, Share2, Minus, Plus, Bookmark as BookmarkIcon, Tag, Search, Video, Sparkles, Scissors, Download, Edit, X, Check, GripVertical, Mic } from 'lucide-react';
import ReactPlayer from 'react-player';
import LZString from 'lz-string';

import TranscriptPanel, { SubtitleLine } from './components/TranscriptPanel';
import { DailymotionPlayer } from './DailymotionPlayer';

// Web Audio API Audio Slicing Utility
function sliceAudioBuffer(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  start: number,
  end: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startOffset = Math.floor(start * sampleRate);
  const endOffset = Math.floor(end * sampleRate);
  const frameCount = Math.max(1, endOffset - startOffset);
  
  const slicedBuffer = audioCtx.createBuffer(
    buffer.numberOfChannels,
    frameCount,
    sampleRate
  );
  
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const originalData = buffer.getChannelData(channel);
    const slicedData = slicedBuffer.getChannelData(channel);
    if (startOffset >= originalData.length) {
      slicedData.fill(0);
    } else {
      for (let i = 0; i < frameCount; i++) {
        const srcIndex = startOffset + i;
        slicedData[i] = srcIndex < originalData.length ? originalData[srcIndex] : 0;
      }
    }
  }
  return slicedBuffer;
}

// Encode Web Audio API AudioBuffer to high-quality 16-bit PCM WAV format
function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // raw PCM
  const bitDepth = 16;
  
  const blockAlign = numOfChan * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const subChunk2Size = buffer.length * blockAlign;
  const chunkSize = 36 + subChunk2Size;
  
  const bufferArr = new ArrayBuffer(44 + subChunk2Size);
  const view = new DataView(bufferArr);
  const channels: Float32Array[] = [];
  
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  // Write WAV header
  setUint32(0x46464952); // "RIFF"
  setUint32(chunkSize);
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16);         // chunk length
  setUint16(format);
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(byteRate);
  setUint16(blockAlign);
  setUint16(bitDepth);

  setUint32(0x61746164); // "data" chunk
  setUint32(subChunk2Size);

  // Buffer channels data
  for (let i = 0; i < numOfChan; i++) {
    channels.push(buffer.getChannelData(i));
  }

  // Interleave and write PCM sample data
  const len = buffer.length;
  for (let offset = 0; offset < len; offset++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = channels[ch][offset];
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      const s = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(pos, s, true);
      pos += 2;
    }
  }

  return new Blob([bufferArr], { type: 'audio/wav' });
}

export default function App() {
  // 配色方案常量 (根據附圖)
  const colors = {
    background: '#16161a',
    headline: '#fffffe',
    paragraph: '#94a1b2',
    button: '#7f5af0',
    buttonText: '#fffffe',
    stroke: '#010101',
    main: '#fffffe',
    highlight: '#7f5af0',
    secondary: '#72757e',
    tertiary: '#2cb67d'
  };

  const bookmarkColors = useMemo(() => [
    { value: 'gray', label: '預設', bg: 'bg-white/10 hover:bg-white/15', border: 'border-white/15 hover:border-white/30', text: 'text-white/90', dot: '#ffffff', glow: 'shadow-[0_0_8px_rgba(255,255,255,0.4)]' },
    { value: 'red', label: '待加強', bg: 'bg-rose-500/15 hover:bg-rose-500/25', border: 'border-rose-500/25 hover:border-rose-500/40', text: 'text-rose-400 font-semibold', dot: '#ef4444', glow: 'shadow-[0_0_8px_rgba(239,68,68,0.5)]' },
    { value: 'green', label: '已掌握', bg: 'bg-emerald-500/15 hover:bg-emerald-500/25', border: 'border-emerald-500/25 hover:border-emerald-500/40', text: 'text-emerald-400 font-semibold', dot: '#2cb67d', glow: 'shadow-[0_0_8px_rgba(44,182,125,0.5)]' },
    { value: 'blue', label: '生字區', bg: 'bg-sky-500/15 hover:bg-sky-500/25', border: 'border-sky-500/25 hover:border-sky-500/40', text: 'text-sky-400 font-semibold', dot: '#3d8bff', glow: 'shadow-[0_0_8px_rgba(61,139,255,0.5)]' },
  ] as const, []);

  // 網址與本地儲存參數解析
  const getSearchParams = () => {
    if (typeof window === 'undefined') return { url: '', a: null, b: null, t: '' };
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    
    let urlParam = searchParams.get('url') || hashParams.get('url') || searchParams.get('u') || hashParams.get('u');
    const vParam = searchParams.get('v') || hashParams.get('v');
    const vmParam = searchParams.get('vm') || hashParams.get('vm');
    const dmParam = searchParams.get('dm') || hashParams.get('dm');
    
    if (vParam) {
      urlParam = `https://www.youtube.com/watch?v=${vParam}`;
    } else if (vmParam) {
      urlParam = `https://vimeo.com/${vmParam}`;
    } else if (dmParam) {
      urlParam = `https://www.dailymotion.com/video/${dmParam}`;
    }

    const aParam = searchParams.get('a') || hashParams.get('a');
    const bParam = searchParams.get('b') || hashParams.get('b');
    const tParam = searchParams.get('t') || hashParams.get('t') || '';

    return {
      url: urlParam || '',
      a: (aParam !== null && !isNaN(parseFloat(aParam))) ? parseFloat(aParam) : null,
      b: (bParam !== null && !isNaN(parseFloat(bParam))) ? parseFloat(bParam) : null,
      t: tParam
    };
  };

  const initialData = useMemo(() => {
    const params = getSearchParams();
    
    let finalUrl = params.url;
    let finalFileName = '';
    let finalPointA = params.a;
    let finalPointB = params.b;
    let autoPlay = !!params.url;

    if (!finalUrl && typeof localStorage !== 'undefined') {
      try {
        const lastUrl = localStorage.getItem('ab_repeat_last_url');
        const lastFileName = localStorage.getItem('ab_repeat_last_filename');
        if (lastUrl) {
          finalUrl = lastUrl;
        } else if (lastFileName) {
          finalFileName = lastFileName;
        }

        const mediaKey = lastUrl ? `url_${lastUrl}` : (lastFileName ? `local_file_${lastFileName}` : '');
        if (mediaKey) {
          const savedA = localStorage.getItem(`ab_repeat_pointA_${mediaKey}`);
          const savedB = localStorage.getItem(`ab_repeat_pointB_${mediaKey}`);
          
          if (finalPointA === null && savedA !== null) {
            finalPointA = parseFloat(savedA);
          }
          if (finalPointB === null && savedB !== null) {
            finalPointB = parseFloat(savedB);
          }
        }
      } catch (e) {
        console.warn('Failed to load initial states from localStorage', e);
      }
    } else if (finalUrl) {
      try {
        const mediaKey = `url_${finalUrl}`;
        const savedA = localStorage.getItem(`ab_repeat_pointA_${mediaKey}`);
        const savedB = localStorage.getItem(`ab_repeat_pointB_${mediaKey}`);
        if (finalPointA === null && savedA !== null) {
          finalPointA = parseFloat(savedA);
        }
        if (finalPointB === null && savedB !== null) {
          finalPointB = parseFloat(savedB);
        }
      } catch (e) {}
    }

    return {
      url: finalUrl,
      fileName: finalFileName,
      pointA: finalPointA,
      pointB: finalPointB,
      autoPlay
    };
  }, []);

  const [audioUrl, setAudioUrl] = useState(initialData.url);
  const [isPlaying, setIsPlaying] = useState(initialData.autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [activeVolume, setActiveVolume] = useState(1);
  const isFadingRef = useRef(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [pointA, setPointA] = useState<number | null>(initialData.pointA);
  const [pointB, setPointB] = useState<number | null>(initialData.pointB);
  const [inputA, setInputA] = useState('');
  const [inputB, setInputB] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  const [isRepeatEnabled, setIsRepeatEnabled] = useState(true);
  const [isLoopFadeEnabled, setIsLoopFadeEnabled] = useState(true);

  // Synchronize activeVolume with master volume state when not fading
  useEffect(() => {
    if (!isFadingRef.current) {
      setActiveVolume(volume);
    }
  }, [volume]);
  const [error, setError] = useState('');
  const lastLoadedUrl = useRef('');
  const [draggingMarker, setDraggingMarker] = useState<string | null>(null);
  const [fileName, setFileName] = useState(initialData.fileName);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
  // 新增 transcript state 讓 App 可存儲字串資料以便分享
  const [transcriptLines, setTranscriptLines] = useState<SubtitleLine[]>([]);

  // 書籤功能資料結構
  interface Bookmark {
    id: string;
    time: number;
    label: string;
    thumbnail?: string;
    color?: 'red' | 'green' | 'blue' | 'gray';
    pointA?: number;
    pointB?: number;
    isShadowing?: boolean;
    shadowingAudioUrl?: string;
  }

  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try {
      const saved = localStorage.getItem('ab_repeat_bookmarks');
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      return [];
    }
  });

  const [newBookmarkLabel, setNewBookmarkLabel] = useState('');
  const [selectedColorForNewBookmark, setSelectedColorForNewBookmark] = useState<'red' | 'green' | 'blue' | 'gray'>('gray');
  const [bookmarkColorFilter, setBookmarkColorFilter] = useState<string>('all');
  const [isGeneratingLabel, setIsGeneratingLabel] = useState(false);
  const [bookmarkSearchQuery, setBookmarkSearchQuery] = useState('');
  const [bookmarkSortBy, setBookmarkSortBy] = useState<'time-asc' | 'time-desc' | 'category' | 'manual'>('time-asc');
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // 靜態音訊快補與段落剪輯引擎 state
  const decodedAudioBufferRef = useRef<AudioBuffer | null>(null);

  // 清除快取的生命週期
  useEffect(() => {
    decodedAudioBufferRef.current = null;
  }, [uploadedFile, audioUrl]);

  interface GeneratedClip {
    blobUrl: string;
    duration: number;
    isSynthetic: boolean;
    start: number;
    end: number;
  }

  const [generatedClips, setGeneratedClips] = useState<Record<string, GeneratedClip>>({});
  const [generatingClipIds, setGeneratingClipIds] = useState<Record<string, boolean>>({});
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [hoveredTimelineB, setHoveredTimelineB] = useState<Bookmark | null>(null);
  
  // 編輯書籤互動式對話框相關 states
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editTime, setEditTime] = useState<number>(0);
  const [editPointA, setEditPointA] = useState<number | null>(null);
  const [editPointB, setEditPointB] = useState<number | null>(null);
  const [editColor, setEditColor] = useState<'red' | 'green' | 'blue' | 'gray'>('gray');
  
  // 分享與嵌入碼對話框相關 states
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharingUrl, setSharingUrl] = useState('');
  const [embedWidth, setEmbedWidth] = useState('100%');
  const [embedHeight, setEmbedHeight] = useState('600px');

  // 麥克風跟讀錄音狀態
  const [isRecordingShadow, setIsRecordingShadow] = useState(false);
  const [recordingShadowDuration, setRecordingShadowDuration] = useState(0);
  const [playingShadowId, setPlayingShadowId] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const shadowingTimeRef = useRef<number>(0);
  const shadowingPointARef = useRef<number | null>(null);
  const shadowingPointBRef = useRef<number | null>(null);
  const shadowAudioPlayerRef = useRef<HTMLAudioElement | null>(null);
  
  const clipAudioRef = useRef<HTMLAudioElement | null>(null);
  const [clipProgress, setClipProgress] = useState<Record<string, number>>({});

  // 頁面卸載時銷毀 Blob URLs 與執行中的 HTML5 Audio Player 以及錄音資源
  useEffect(() => {
    return () => {
      if (clipAudioRef.current) {
        clipAudioRef.current.pause();
        clipAudioRef.current.src = "";
      }
      if (shadowAudioPlayerRef.current) {
        shadowAudioPlayerRef.current.pause();
        shadowAudioPlayerRef.current.src = "";
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      Object.values(generatedClips).forEach((clip: any) => {
        try { URL.revokeObjectURL(clip.blobUrl); } catch (e) {}
      });
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ab_repeat_bookmarks', JSON.stringify(bookmarks));
    } catch (err) {
      console.warn('Failed to save bookmarks to localStorage', err);
    }
  }, [bookmarks]);

  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [isHoveringBar, setIsHoveringBar] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0.15); // 微調字幕同步

  const syncTime = useMemo(() => {
    // 依據不同播放速率（playbackRate）實行自動補償
    // 播放越快時，播放器輪詢（poll）落後的時間換算成媒體秒數越多，因此需要略微拉大位移
    // 播放越慢時則反之，收斂補償位移。
    const playbackRateMultiplier = playbackRate >= 1.0 
      ? 1 + (playbackRate - 1) * 0.4 
      : 1 - (1 - playbackRate) * 0.6;
    return Math.max(0, currentTime + (subtitleOffset * playbackRateMultiplier));
  }, [currentTime, subtitleOffset, playbackRate]);

  // --- Active Subtitle Overlay Logic ---
  const activeLineIndex = useMemo(() => {
    if (!transcriptLines || transcriptLines.length === 0) return -1;
    let idx = transcriptLines.findIndex(line => 
      line.startTime !== undefined && line.endTime !== undefined && 
      line.startTime !== -1 && line.endTime !== -1 &&
      syncTime >= line.startTime && syncTime <= line.endTime
    );
    // If we're strictly between lines, find the last active line (optional, but follows TranscriptPanel)
    if (idx === -1 && transcriptLines[0]?.startTime !== -1 && transcriptLines[0]?.startTime !== undefined) {
      for (let i = transcriptLines.length - 1; i >= 0; i--) {
        if (transcriptLines[i].startTime !== undefined && transcriptLines[i].startTime !== -1 && syncTime >= (transcriptLines[i].startTime as number)) {
          idx = i;
          break;
        }
      }
    }
    return idx;
  }, [syncTime, transcriptLines]);

  const activeWordIndex = useMemo(() => {
    if (activeLineIndex === -1 || !transcriptLines) return -1;
    const line = transcriptLines[activeLineIndex];
    if (line.startTime == null || line.endTime == null || line.startTime === -1 || line.endTime === -1) return -1;
    if (syncTime < line.startTime || syncTime > line.endTime) return -1;
    
    const duration = line.endTime - line.startTime;
    if (duration <= 0) return -1;
    
    // 計算初始線性進度，限定於 [0, 1] 之間
    let rawProgress = (syncTime - line.startTime) / duration;
    rawProgress = Math.max(0, Math.min(1, rawProgress));
    
    const totalChars = line.words.reduce((acc, w) => acc + (w.word || w.romaji || " ").length, 0);
    if (totalChars === 0) return -1;
    
    // --- 語速與播放速率對應之高亮補償與曲線平滑設計 ---
    // 利用非線性的 Hermite 內插（Smoothstep sCurve）對原始進度進行扭曲修正
    // 解決以下問題：
    //  - 句子開頭與結尾往往有音訊空白或起音延遲（起步稍慢、結尾收音慢、中間核心語音最密集）
    //  - 語速（speechRate = 字數 / 時間）低時，意即語速慢、停頓多，S 曲線的效果要越顯著以過濾首尾遲滯
    //  - 語速高時，講話緊湊、幾乎無縫，字詞渲染回歸線性
    const speechRate = totalChars / duration; // 每秒字元數 (或詞數)
    
    // 當語速極慢時 (比如 < 3)，sCurve 權重提高，過濾頭尾空白；
    // 當語速極快時，sCurve 權重調低，使高亮變連貫
    const warpStrength = Math.max(0.1, Math.min(0.85, 1.4 / (speechRate + 1.2)));
    
    const sCurve = 3 * Math.pow(rawProgress, 2) - 2 * Math.pow(rawProgress, 3);
    const progress = rawProgress * (1 - warpStrength) + sCurve * warpStrength;
    
    let currentChars = 0;
    for (let i = 0; i < line.words.length; i++) {
        const wordLen = (line.words[i].word || line.words[i].romaji || " ").length;
        currentChars += wordLen;
        
        const wordProgress = currentChars / totalChars;
        if (progress <= wordProgress) {
            return i;
        }
    }
    return line.words.length - 1;
  }, [activeLineIndex, syncTime, transcriptLines, playbackRate]);

  const activeLine = activeLineIndex !== -1 ? transcriptLines[activeLineIndex] : null;

  const playerRef = useRef<any>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isVideo = useMemo(() => {
    if (!audioUrl) return false;
    return audioUrl.includes('youtube.com') || 
           audioUrl.includes('youtu.be') || 
           audioUrl.includes('vimeo.com') ||
           audioUrl.includes('dailymotion.com') ||
           audioUrl.includes('dai.ly') ||
           audioUrl.includes('twitch.tv') ||
           audioUrl.includes('facebook.com') ||
            audioUrl.includes('.mp4');
  }, [audioUrl]);

  const isDailymotion = useMemo(() => {
    if (!audioUrl) return false;
    return audioUrl.includes('dailymotion.com') || audioUrl.includes('dai.ly');
  }, [audioUrl]);

  const dmVideoId = useMemo(() => {
    if (!audioUrl) return null;
    const match = audioUrl.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([^&?]+)/);
    return match ? match[1] : null;
  }, [audioUrl]);

  // 計算 A/B 循環區間對應的字幕名稱（自動建議）
  const currentLoopName = useMemo(() => {
    if (pointA === null || pointB === null || !transcriptLines || transcriptLines.length === 0) return '';
    
    let bestLine = null;
    let maxOverlap = 0;
    
    const midPoint = (pointA + pointB) / 2;
    
    for (const line of transcriptLines) {
      if (line.startTime === null || line.endTime === null || line.startTime === -1 || line.endTime === -1) continue;
      
      const start = line.startTime;
      const end = line.endTime;
      
      const intersectStart = Math.max(pointA, start);
      const intersectEnd = Math.min(pointB, end);
      const overlap = Math.max(0, intersectEnd - intersectStart);
      
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestLine = line;
      }
      
      if (overlap === 0 && midPoint >= start && midPoint <= end) {
        bestLine = line;
      }
    }
    
    return bestLine ? bestLine.originalText : '';
  }, [pointA, pointB, transcriptLines]);

  const currentLoopTranslation = useMemo(() => {
    if (pointA === null || pointB === null || !transcriptLines || transcriptLines.length === 0) return '';
    
    let bestLine = null;
    let maxOverlap = 0;
    
    const midPoint = (pointA + pointB) / 2;
    
    for (const line of transcriptLines) {
      if (line.startTime === null || line.endTime === null || line.startTime === -1 || line.endTime === -1) continue;
      
      const start = line.startTime;
      const end = line.endTime;
      
      const intersectStart = Math.max(pointA, start);
      const intersectEnd = Math.min(pointB, end);
      const overlap = Math.max(0, intersectEnd - intersectStart);
      
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestLine = line;
      }
      
      if (overlap === 0 && midPoint >= start && midPoint <= end) {
        bestLine = line;
      }
    }
    
    return bestLine ? bestLine.translation : '';
  }, [pointA, pointB, transcriptLines]);

  // 用來在長按 interval 或鍵盤監聽中取得最新狀態，避免閉包問題
  const stateRef = useRef({ pointA, pointB, currentTime, duration, isRepeatEnabled, audioUrl, isPlaying, volume, playbackRate, activeLine });
  useEffect(() => {
    stateRef.current = { pointA, pointB, currentTime, duration, isRepeatEnabled, audioUrl, isPlaying, volume, playbackRate, activeLine };
  }, [pointA, pointB, currentTime, duration, isRepeatEnabled, audioUrl, isPlaying, volume, playbackRate, activeLine]);

  const targetSeekRef = useRef<number | null>(null);
  const seekClearTimer = useRef<NodeJS.Timeout | null>(null);

  // 鍵盤快捷鍵處理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果正在輸入框、或是按下組合鍵（如 Ctrl+S），則不觸發
      const activeElement = document.activeElement;
      const isInput = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || (activeElement as HTMLElement).isContentEditable);
      if (isInput) return;

      const { audioUrl: currentUrl, currentTime: currentPos, volume: currentVolume, activeLine, pointA, pointB } = stateRef.current;

      if (e.code === 'Space') {
        // 空白鍵：暫停/播放
        if (!currentUrl) return;
        e.preventDefault();
        setIsPlaying(prev => !prev);
      } else if (e.code === 'KeyA' || e.key === 'a' || e.key === 'A') {
        if (!currentUrl) return;
        e.preventDefault();
        const targetA = (activeLine && activeLine.startTime !== undefined && activeLine.startTime !== -1) 
          ? activeLine.startTime 
          : currentPos;
        setPointA(targetA);
        jumpToAndPlay(targetA);
      } else if (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') {
        if (!currentUrl) return;
        e.preventDefault();
        const targetB = (activeLine && activeLine.endTime !== undefined && activeLine.endTime !== -1) 
          ? activeLine.endTime 
          : currentPos;
        if (pointA !== null && targetB <= pointA) {
          setError('點 B 必須在點 A 之後');
          setTimeout(() => setError(''), 3000);
          return;
        }
        setPointB(targetB);
        jumpToAndPlay(Math.max(0, targetB - 5));
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        // 左/右鍵：倒退或快轉 5 秒
        e.preventDefault();
        if (playerRef.current) {
          const delta = e.code === 'ArrowLeft' ? -5 : 5;
          const baseTime = targetSeekRef.current !== null ? targetSeekRef.current : currentPos;
          let newTime = Math.max(0, baseTime + delta);
          if (stateRef.current.duration) {
            newTime = Math.min(newTime, stateRef.current.duration);
          }
          targetSeekRef.current = newTime;
          playerRef.current.seekTo(newTime, 'seconds');
          
          if (seekClearTimer.current) clearTimeout(seekClearTimer.current);
          seekClearTimer.current = setTimeout(() => {
            targetSeekRef.current = null;
          }, 500);
        }
      } else if (e.code === 'ArrowUp') {
        // 上鍵：增加音量
        e.preventDefault();
        setVolume(Math.min(1, currentVolume + 0.05));
      } else if (e.code === 'ArrowDown') {
        // 下鍵：減少音量
        e.preventDefault();
        setVolume(Math.max(0, currentVolume - 0.05));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const holdInterval = useRef<NodeJS.Timeout | null>(null);

  // 取得 localStorage 的 media 專屬 key
  const getStorageKeyBase = useCallback((url: string, name: string) => {
    if (!url) return '';
    if (url.startsWith('blob:')) {
      return name ? `local_file_${name}` : '';
    }
    return `url_${url}`;
  }, []);

  // 當 A 點, B 點或媒體改變時，自動儲存至 localStorage
  useEffect(() => {
    if (!audioUrl) return;
    const mediaKey = getStorageKeyBase(audioUrl, fileName);
    if (!mediaKey) return;

    try {
      if (pointA !== null) {
        localStorage.setItem(`ab_repeat_pointA_${mediaKey}`, pointA.toString());
      } else {
        localStorage.removeItem(`ab_repeat_pointA_${mediaKey}`);
      }

      if (pointB !== null) {
        localStorage.setItem(`ab_repeat_pointB_${mediaKey}`, pointB.toString());
      } else {
        localStorage.removeItem(`ab_repeat_pointB_${mediaKey}`);
      }

      // 紀錄最後練習的媒體與檔案資訊，方便重載時自動恢復
      localStorage.setItem('ab_repeat_last_media_key', mediaKey);
      if (!audioUrl.startsWith('blob:')) {
        localStorage.setItem('ab_repeat_last_url', audioUrl);
        localStorage.removeItem('ab_repeat_last_filename');
      } else {
        localStorage.removeItem('ab_repeat_last_url');
        localStorage.setItem('ab_repeat_last_filename', fileName);
      }
    } catch (e) {
      console.warn('Failed to save state to localStorage:', e);
    }
  }, [audioUrl, fileName, pointA, pointB, getStorageKeyBase]);

  // 初始化：網頁載入時僅讀取需要額外解壓或載入的分享參數（如字幕 tParam）
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const tParam = searchParams.get('t') || hashParams.get('t');

    if (tParam) {
      try {
        const decompressed = LZString.decompressFromEncodedURIComponent(tParam);
        if (decompressed) {
          const lines = JSON.parse(decompressed);
          setTranscriptLines(lines);
        }
      } catch (err) {
        console.error("Failed to parse transcript lines from URL", err);
      }
    }
  }, []);

  const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00';
    const mins = Math.floor(time / 60);
    const secs = (time % 60).toFixed(1);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(4, '0')}`;
  };

  const formatForInput = (time: number | null) => {
    if (time === null || time === undefined || isNaN(time)) return '';
    const mins = Math.floor(time / 60);
    const secs = (time % 60).toFixed(1);
    return `${mins.toString().padStart(2, '0')}:${secs.padStart(4, '0')}`;
  };

  const parseTimeInput = (val: string) => {
    if (!val) return null;
    const parts = val.toString().split(':');
    if (parts.length === 2) {
      return parseInt(parts[0] || '0') * 60 + parseFloat(parts[1] || '0');
    }
    return parseFloat(val);
  };

  useEffect(() => {
    return () => {
      if (audioUrl && audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const parseVttTimeForImport = (timeStr: string) => {
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

  const generateWordsForLine = (text: string) => {
    const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(text);
    if (hasCJK) {
      return text.split('').map(char => ({
        word: char,
        furigana: '',
        romaji: '',
        pos: 'misc'
      }));
    } else {
      return text.split(/(\s+)/).filter(p => p.length > 0).map(part => {
        if (/\s+/.test(part)) {
          return {
            word: part,
            furigana: '',
            romaji: '',
            pos: 'punctuation'
          };
        }
        return {
          word: part,
          furigana: '',
          romaji: '',
          pos: 'misc'
        };
      });
    }
  };

  const handleFile = async (file: File) => {
    if (!file) return;

    const isSubtitle = /\.(srt|vtt)$/i.test(file.name);
    if (isSubtitle) {
      try {
        const text = await file.text();
        const loadedLines: SubtitleLine[] = [];
        const isVtt = file.name.toLowerCase().endsWith('.vtt');
        // Normalize different line ending styles to match blocks split
        const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\n+/);

        for (const block of blocks) {
          const linesSplit = block.split('\n').map(l => l.trim()).filter(l => l !== '');
          if (linesSplit.length === 0) continue;
          if (isVtt && linesSplit[0] === 'WEBVTT') continue;

          const timecodeLine = linesSplit.find(l => l.includes('-->'));
          if (!timecodeLine) continue;

          const timecodes = timecodeLine.split('-->').map(s => s.trim());
          const startTime = parseVttTimeForImport(timecodes[0]);
          const endTime = parseVttTimeForImport(timecodes[1]);
          const textIndex = linesSplit.indexOf(timecodeLine) + 1;
          
          const linesContent = linesSplit.slice(textIndex);
          let originalText = '';
          let translation = '';
          
          if (linesContent.length >= 2) {
            const line0 = linesContent[0].replace(/<[^>]+>/g, '').trim();
            const line1 = linesContent[1].replace(/<[^>]+>/g, '').trim();
            const line1HasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(line1);
            const line0HasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(line0);
            
            if (line1HasCJK && !line0HasCJK) {
              originalText = line0;
              translation = line1;
            } else {
              originalText = linesContent.join('\n').replace(/<[^>]+>/g, '').trim();
            }
          } else if (linesContent.length === 1) {
            originalText = linesContent[0].replace(/<[^>]+>/g, '').trim();
          }

          if (originalText) {
            loadedLines.push({
              id: `sub_import_${Date.now()}_${loadedLines.length}`,
              startTime: startTime >= 0 ? startTime : null,
              endTime: endTime >= 0 ? endTime : null,
              originalText,
              translation,
              words: generateWordsForLine(originalText)
            });
          }
        }

        if (loadedLines.length > 0) {
          setTranscriptLines(loadedLines);
          setSuccessMessage(`成功匯入 ${loadedLines.length} 句自訂字幕！`);
          setTimeout(() => setSuccessMessage(''), 3000);
          setError('');
        } else {
          setError('未能成功解析字幕內容，請確保檔案格式正確 (.srt / .vtt)。');
          setTimeout(() => setError(''), 4000);
        }
      } catch (err: any) {
        console.error(err);
        setError(`匯入失敗: ${err.message || '未知錯誤'}`);
        setTimeout(() => setError(''), 4000);
      }
    } else {
      const isValidAudio = file.type.startsWith('audio/') || /\.(m4a|aac|mp3|wav|ogg|flac)$/i.test(file.name);
      if (!isValidAudio) {
        setError('請上傳有效的音檔或字幕格式 (支援 MP3, WAV, M4A, AAC, SRT, VTT)');
        return;
      }
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setFileName(file.name);
      setUploadedFile(file);
      setError('');
      setSuccessMessage('音檔上傳成功！');
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  useEffect(() => { setInputA(formatForInput(pointA)); }, [pointA]);
  useEffect(() => { setInputB(formatForInput(pointB)); }, [pointB]);

  useEffect(() => {
    if (duration > 0) {
      setPointA(prev => (prev !== null && prev > duration) ? duration : prev);
      setPointB(prev => (prev !== null && prev > duration) ? duration : prev);
    }
  }, [duration]);

  const jumpToAndPlay = (targetTime: number | null) => {
    if (targetTime !== null && playerRef.current) {
      playerRef.current.seekTo(targetTime, 'seconds');
      setIsPlaying(true);
    }
  };

  const captureScreenshot = (): string | undefined => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;

      // 1. Try to find the HTML5 video element
      const video = document.querySelector('video');
      if (video) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', 0.85);
        } catch (videoErr) {
          console.warn('Direct canvas draw from video element failed (likely due to cross-origin CORS restriction).', videoErr);
        }
      }

      // 2. Beautiful procedural fallback mockup for audio/visual waveforms
      const gradient = ctx.createLinearGradient(0, 0, 160, 90);
      gradient.addColorStop(0, '#7f5af0');       // Elegant purple
      gradient.addColorStop(0.5, '#2cb67d');     // Gentle emerald green
      gradient.addColorStop(1, '#16161a');       // Dark deep background
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 160, 90);

      // Simple geometric shape accents
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.arc(130, 25, 25, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.beginPath();
      ctx.arc(30, 70, 45, 0, Math.PI * 2);
      ctx.fill();

      // Procedural mountains/waves representation
      const barCount = 16;
      const barWidth = 4;
      const gap = 2;
      const totalBarsWidth = barCount * (barWidth + gap) - gap;
      const startX = (160 - totalBarsWidth) / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      for (let i = 0; i < barCount; i++) {
        const heightFactor = Math.max(0.15, Math.sin(i * 0.4 + currentTime * 0.5) * 0.6 + 0.4 * Math.cos(i * 0.1));
        const barHeight = Math.max(5, Math.round(heightFactor * 26));
        const y = Math.round((90 - barHeight) / 2 - 5);
        ctx.fillRect(startX + i * (barWidth + gap), y, barWidth, barHeight);
      }

      // Dark footer ribbon for the timestamp
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 68, 160, 22);

      // Soft borders split line
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, 68, 160, 1);

      // Timestamp string overlay
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatTime(currentTime), 80, 79);

      // Watermark title text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      const maxCharCount = 20;
      const cleanLabel = fileName ? (fileName.length > maxCharCount ? fileName.slice(0, maxCharCount - 3) + '...' : fileName) : 'AUDIO PREVIEW';
      ctx.fillText(cleanLabel, 8, 14);

      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
      console.error('Failed to generate fallback thumbnail', err);
      return undefined;
    }
  };

  const getABTranscriptText = useCallback(() => {
    if (pointA === null || pointB === null || !transcriptLines) return "";
    const start = Math.min(pointA, pointB);
    const end = Math.max(pointA, pointB);
    
    // 過濾出與 AB 區間有重疊的字幕行
    const linesInRange = transcriptLines.filter(line => {
      if (line.startTime === undefined || line.endTime === undefined || line.startTime === -1 || line.endTime === -1) {
        return false;
      }
      return line.startTime < end && line.endTime > start;
    });
    
    if (linesInRange.length === 0) return "";
    
    return linesInRange.map(line => {
      const parts = [];
      if (line.text) parts.push(line.text);
      if (line.translation) parts.push(`(${line.translation})`);
      return parts.join(' ');
    }).join('\n');
  }, [pointA, pointB, transcriptLines]);

  const generateAIBookmarkLabel = async () => {
    if (pointA === null || pointB === null) {
      setError("請先設定 A/B 區間來指定要分析的字幕段落！");
      setTimeout(() => setError(""), 3000);
      return;
    }
    
    const text = getABTranscriptText();
    if (!text) {
      setError("當前 A/B 區間內沒有偵測到字幕文字！");
      setTimeout(() => setError(""), 3000);
      return;
    }
    
    setIsGeneratingLabel(true);
    try {
      const response = await fetch('/api/gemini/generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          contents: [
            {
              parts: [
                {
                  text: `以下是使用者正在學習的一段音軌字幕文字：\n\n"${text}"\n\n請以繁體中文自動產生一個極為精簡的摘要說明或學習標籤（例如：「談論興趣與夢想」、「文法：～ている」、「聽力盲點練習」），長度請控制在 15 字以內。直接回答這句標籤，禁止包含任何引號、括號、前綴、說明或任何引言文字。`
                }
              ]
            }
          ]
        })
      });
      
      if (!response.ok) {
        throw new Error(`API 錯誤: ${response.status}`);
      }
      
      const data = await response.json();
      if (data && data.text) {
        const cleanedLabel = data.text.trim().replace(/^["'「`]+|["'」`]+$/g, '');
        setNewBookmarkLabel(cleanedLabel);
        setSuccessMessage("AI 標籤生成成功！");
      } else {
        throw new Error("API 回傳結構不正確");
      }
    } catch (err: any) {
      console.error("AI 標籤生成失敗:", err);
      setError(`AI 生成失敗：${err.message || err}`);
    } finally {
      setIsGeneratingLabel(false);
      setTimeout(() => {
        setSuccessMessage("");
        setError("");
      }, 3000);
    }
  };

  const addBookmark = () => {
    if (!audioUrl) {
      setError('請先載入音檔，再新增書籤');
      setTimeout(() => setError(''), 3000);
      return;
    }
    const labelText = newBookmarkLabel.trim() || `書籤 @ ${formatTime(currentTime)}`;
    
    let thumbnail: string | undefined = undefined;
    try {
      thumbnail = captureScreenshot();
    } catch (e) {
      console.warn('Screenshot capture error:', e);
    }

    const newB: Bookmark = {
      id: Math.random().toString(36).slice(2, 9),
      time: Math.round(currentTime * 10) / 10,
      label: labelText,
      thumbnail,
      color: selectedColorForNewBookmark,
      pointA: pointA !== null ? Math.round(pointA * 100) / 100 : undefined,
      pointB: pointB !== null ? Math.round(pointB * 100) / 100 : undefined,
    };
    setBookmarks(prev => {
      const list = [...prev, newB];
      if (bookmarkSortBy !== 'manual') {
        return list.sort((a, b) => a.time - b.time);
      }
      return list;
    });
    setNewBookmarkLabel('');
    setSuccessMessage(`書籤「${labelText}」已儲存於 ${formatTime(currentTime)}！`);
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const deleteBookmark = (id: string) => {
    const deleted = bookmarks.find(b => b.id === id);
    setBookmarks(prev => prev.filter(b => b.id !== id));
    if (deleted) {
      setSuccessMessage(`已刪除書籤「${deleted.label}」`);
      setTimeout(() => setSuccessMessage(''), 2000);
    }
  };

  // 開啟編輯書籤對話框
  const openEditBookmark = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark);
    setEditLabel(bookmark.label);
    setEditTime(bookmark.time);
    setEditPointA(bookmark.pointA !== undefined ? bookmark.pointA : null);
    setEditPointB(bookmark.pointB !== undefined ? bookmark.pointB : null);
    setEditColor(bookmark.color || 'gray');
  };

  // 儲存編輯後的書籤
  const saveEditedBookmark = () => {
    if (!editingBookmark) return;
    const trimmedLabel = editLabel.trim();
    if (trimmedLabel === '') {
      setError('標籤名稱不能為空');
      setTimeout(() => setError(''), 3000);
      return;
    }

    if (editPointA !== null && editPointB !== null && editPointB <= editPointA) {
      setError('終點 B 必須大於起點 A');
      setTimeout(() => setError(''), 3500);
      return;
    }

    setBookmarks(prev => {
      const list = prev.map(b => {
        if (b.id === editingBookmark.id) {
          return {
            ...b,
            label: trimmedLabel,
            time: Math.round(editTime * 100) / 100,
            pointA: editPointA !== null ? Math.round(editPointA * 100) / 100 : undefined,
            pointB: editPointB !== null ? Math.round(editPointB * 100) / 100 : undefined,
            color: editColor
          };
        }
        return b;
      });
      if (bookmarkSortBy !== 'manual') {
        return list.sort((a, b) => a.time - b.time);
      }
      return list;
    });

    setSuccessMessage(`書籤「${trimmedLabel}」已成功更新！`);
    setTimeout(() => setSuccessMessage(''), 2000);
    setEditingBookmark(null);
  };

  // 處理書籤拖曳排序事件，支援即時自訂位置 swap 與 localStorage 同步
  const handleDragOverBookmark = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;

    // 自動切換為手動排序，拖曳時能即時看到變更
    if (bookmarkSortBy !== 'manual') {
      setBookmarkSortBy('manual');
    }

    setBookmarks(prev => {
      const newList = [...prev];
      const draggedIndex = newList.findIndex(b => b.id === draggedId);
      const targetIndex = newList.findIndex(b => b.id === targetId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const [draggedItem] = newList.splice(draggedIndex, 1);
        newList.splice(targetIndex, 0, draggedItem);
      }
      return newList;
    });
  };

  // 開始麥克風跟讀錄音
  const startShadowRecording = async () => {
    if (isRecordingShadow) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunksRef.current = [];
      
      // 擷取目前的原始音訊時間點與迴圈區間
      shadowingTimeRef.current = Math.round(currentTime * 100) / 100;
      shadowingPointARef.current = pointA !== null ? Math.round(pointA * 100) / 100 : null;
      shadowingPointBRef.current = pointB !== null ? Math.round(pointB * 100) / 100 : null;

      let options = {};
      // 優先使用常用的音訊容器類型
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm')) {
          options = { mimeType: 'audio/webm' };
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          options = { mimeType: 'audio/ogg' };
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          options = { mimeType: 'audio/mp4' };
        }
      }

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordingChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        // 釋放麥克風軌道
        stream.getTracks().forEach(track => track.stop());

        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        
        // 限制檔案大小或轉成 Base64 儲存
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Data = reader.result as string;
          const labelText = newBookmarkLabel.trim() || `🎤 跟讀錄製 @ ${formatTime(shadowingTimeRef.current)}`;
          
          const newB: Bookmark = {
            id: `shadow_${Date.now()}`,
            time: shadowingTimeRef.current,
            label: labelText,
            color: selectedColorForNewBookmark,
            pointA: shadowingPointARef.current !== null ? shadowingPointARef.current : undefined,
            pointB: shadowingPointBRef.current !== null ? shadowingPointBRef.current : undefined,
            isShadowing: true,
            shadowingAudioUrl: base64Data
          };

          setBookmarks(prev => {
            const list = [...prev, newB];
            if (bookmarkSortBy !== 'manual') {
              return list.sort((a, b) => a.time - b.time);
            }
            return list;
          });

          setNewBookmarkLabel('');
          setSuccessMessage(`跟讀書籤「${labelText}」已成功錄製並存入備忘！`);
          setTimeout(() => setSuccessMessage(''), 3000);
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setIsRecordingShadow(true);
      setRecordingShadowDuration(0);

      // 設定最大 15 秒錄音保護，避免 localStorage 被灌爆
      recordingTimerRef.current = setInterval(() => {
        setRecordingShadowDuration(prev => {
          if (prev >= 14) {
            clearInterval(recordingTimerRef.current);
            stopShadowRecording();
            return 15;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err: any) {
      console.error('Failed to start recording shadow:', err);
      setError('❌ 啟動麥克風錄音失敗：請確認是否已授權麥克風權限。');
      setTimeout(() => setError(''), 4000);
    }
  };

  // 停止麥克風跟讀錄音
  const stopShadowRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingShadow(false);
  };

  // 播放跟讀錄音
  const playShadowAudio = (bookmark: Bookmark) => {
    if (!bookmark.shadowingAudioUrl) return;

    if (playingShadowId === bookmark.id) {
      if (shadowAudioPlayerRef.current) {
        shadowAudioPlayerRef.current.pause();
      }
      setPlayingShadowId(null);
      return;
    }

    // 先暫停現有播放
    if (shadowAudioPlayerRef.current) {
      shadowAudioPlayerRef.current.pause();
    }
    if (playingClipId) {
      setPlayingClipId(null);
    }
    if (clipAudioRef.current) {
      clipAudioRef.current.pause();
    }

    const audio = new Audio(bookmark.shadowingAudioUrl);
    shadowAudioPlayerRef.current = audio;
    setPlayingShadowId(bookmark.id);

    audio.onended = () => {
      setPlayingShadowId(null);
    };
    audio.onerror = () => {
      setPlayingShadowId(null);
      setError('無法播放此錄音片段，可能格式不受此瀏覽器支援。');
      setTimeout(() => setError(''), 3000);
    };

    audio.play().catch(e => {
      console.error(e);
      setPlayingShadowId(null);
    });
  };

  // 生成個別書籤對應 AB 重複段落的音訊剪輯 (無損 WAV)
  const generateAudioClip = async (bookmark: Bookmark) => {
    if (generatingClipIds[bookmark.id]) return;
    
    setGeneratingClipIds(prev => ({ ...prev, [bookmark.id]: true }));
    
    const bStart = (bookmark.pointA !== undefined && bookmark.pointA !== null) ? bookmark.pointA : Math.max(0, bookmark.time - 2);
    const bEnd = (bookmark.pointB !== undefined && bookmark.pointB !== null) ? bookmark.pointB : Math.min(duration || (bookmark.time + 2), bookmark.time + 2);
    const lengthSec = Math.max(0.1, bEnd - bStart);

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      let finalBuffer: AudioBuffer | null = null;
      let isSynthetic = false;

      // 1. 本地上傳檔案：使用快取或直接解碼
      if (uploadedFile) {
        let sourceBuffer = decodedAudioBufferRef.current;
        if (!sourceBuffer) {
          const arrayBuffer = await uploadedFile.arrayBuffer();
          sourceBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          decodedAudioBufferRef.current = sourceBuffer;
        }
        
        const finalStart = Math.max(0, Math.min(sourceBuffer.duration, bStart));
        const finalEnd = Math.max(0, Math.min(sourceBuffer.duration, bEnd));
        
        finalBuffer = sliceAudioBuffer(audioCtx, sourceBuffer, finalStart, finalEnd);
      } 
      // 2. 線上隨取檔案：若是 direct URL 且非 CORS 可嘗試 Fetch
      else if (audioUrl && 
               !audioUrl.startsWith('http://localhost') && 
               !audioUrl.startsWith('https://www.youtube') && 
               !audioUrl.startsWith('https://youtu.be') && 
               !audioUrl.includes('youtube.com') && 
               !audioUrl.includes('vimeo.com') && 
               !audioUrl.includes('dailymotion.com') &&
               !audioUrl.startsWith('blob:')) {
        try {
          const response = await fetch(audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const sourceBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          
          const finalStart = Math.max(0, Math.min(sourceBuffer.duration, bStart));
          const finalEnd = Math.max(0, Math.min(sourceBuffer.duration, bEnd));
          
          finalBuffer = sliceAudioBuffer(audioCtx, sourceBuffer, finalStart, finalEnd);
        } catch (fetchErr) {
          console.warn("Direct fetch audioUrl CORS or network blocked, using premium synthetic mockup:", fetchErr);
          isSynthetic = true;
        }
      } else {
        isSynthetic = true;
      }

      // 3. YouTube/跨網域串流 fallback：利用 Web Audio API 合成優美太空音 chimes
      if (isSynthetic || !finalBuffer) {
        isSynthetic = true;
        const sampleRate = 44100;
        const numSamples = Math.floor(lengthSec * sampleRate);
        const synBuffer = audioCtx.createBuffer(1, numSamples, sampleRate);
        const channelData = synBuffer.getChannelData(0);
        
        // 生成具有優雅顫音與諧波的合成晶瑩音色（代表這段書籤的頻譜特徵）
        const baseFreq = 220 + ((bookmark.time * 77) % 5) * 88; // 220Hz - 660Hz
        for (let i = 0; i < numSamples; i++) {
          const t = i / sampleRate;
          const vibrato = Math.sin(2 * Math.PI * 6.0 * t) * 4.5;
          const primaryTone = Math.sin(2 * Math.PI * (baseFreq + vibrato) * t);
          const subTone = Math.sin(2 * Math.PI * (baseFreq * 0.5) * t) * 0.4;
          const highHarmonic = Math.sin(2 * Math.PI * (baseFreq * 1.5) * t) * 0.15;
          const sweepAccent = Math.sin(2 * Math.PI * (baseFreq * 2.01) * t) * 0.1;
          
          // 包絡線控制：淡入攻擊(15%), 慢退淡出(40%)
          let env = 1.0;
          if (t < 0.15) {
            env = t / 0.15;
          } else if (t > lengthSec - 0.4) {
            env = Math.max(0, (lengthSec - t) / 0.4);
          }
          
          channelData[i] = (primaryTone + subTone + highHarmonic + sweepAccent) * 0.18 * env;
        }
        finalBuffer = synBuffer;
      }

      // 將 finalBuffer 轉成無損 WAV 流 Blob
      const wavBlob = bufferToWav(finalBuffer);
      const blobUrl = URL.createObjectURL(wavBlob);

      setGeneratedClips(prev => ({
        ...prev,
        [bookmark.id]: {
          blobUrl,
          duration: lengthSec,
          isSynthetic,
          start: bStart,
          end: bEnd
        }
      }));

      if (isSynthetic) {
        setSuccessMessage(`已爲「${bookmark.label}」生成 Web Audio 數位合成預覽音軌！(由於 YouTube/CORS 圖騰跨網安全限制)`);
      } else {
        setSuccessMessage(`成功為「${bookmark.label}」完美提取 ${lengthSec.toFixed(1)} 秒原音剪輯！`);
      }
      setTimeout(() => setSuccessMessage(''), 3000);

    } catch (err: any) {
      console.error("Audio clip production error:", err);
      setError(`提取音訊剪輯失敗: ${err.message || err}`);
      setTimeout(() => setError(''), 4000);
    } finally {
      setGeneratingClipIds(prev => ({ ...prev, [bookmark.id]: false }));
    }
  };

  // 播放/暫停產生的剪輯音檔
  const playClip = (bookmarkId: string, blobUrl: string) => {
    if (playingClipId === bookmarkId) {
      if (clipAudioRef.current) {
        if (clipAudioRef.current.paused) {
          clipAudioRef.current.play().then(() => setPlayingClipId(bookmarkId)).catch(e => console.error(e));
        } else {
          clipAudioRef.current.pause();
          setPlayingClipId(null);
        }
      }
      return;
    }

    if (clipAudioRef.current) {
      clipAudioRef.current.pause();
      clipAudioRef.current.src = "";
    }

    const audio = new Audio(blobUrl);
    clipAudioRef.current = audio;
    
    audio.ontimeupdate = () => {
      if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        setClipProgress(prev => ({ ...prev, [bookmarkId]: percent }));
      }
    };
    
    audio.onended = () => {
      setPlayingClipId(null);
      setClipProgress(prev => ({ ...prev, [bookmarkId]: 100 }));
      setTimeout(() => {
        setClipProgress(prev => ({ ...prev, [bookmarkId]: 0 }));
      }, 300);
    };

    setPlayingClipId(bookmarkId);
    audio.play().catch(e => {
      console.error("Clip play initial failed", e);
      setPlayingClipId(null);
    });
  };

  useEffect(() => {
    if (!draggingMarker || !progressBarRef.current || duration === 0) return;
    
    // Trigger vibration feedback when dragging starts
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(15);
    }
    
    let lastVibratedSec = -1;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (e.type === 'touchmove') e.preventDefault();
      const clientX = e.type.includes('touch') ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const rect = progressBarRef.current!.getBoundingClientRect();
      let percent = (clientX - rect.left) / rect.width;
      percent = Math.max(0, Math.min(1, percent));
      const newTime = percent * duration;
      if (draggingMarker === 'A') {
        setPointA(pointB !== null && newTime > pointB ? pointB : newTime);
      } else if (draggingMarker === 'B') {
        setPointB(pointA !== null && newTime < pointA ? pointA : newTime);
      }

      // Vibrate on changing major second increments to feel tactile
      const currentSec = Math.floor(newTime * 2); // subtle notch every 0.5s
      if (currentSec !== lastVibratedSec) {
        lastVibratedSec = currentSec;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(8);
        }
      }
    };
    const handleEnd = () => {
      const { pointA: pA, pointB: pB } = stateRef.current;
      if (draggingMarker === 'A' && pA !== null) {
        jumpToAndPlay(pA);
      } else if (draggingMarker === 'B' && pB !== null) {
        jumpToAndPlay(Math.max(0, pB - 5));
      }
      setDraggingMarker(null);
      
      // End vibration
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(10);
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchend', handleEnd);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [draggingMarker, duration, pointA, pointB, isRepeatEnabled]);

  useEffect(() => {
    if (!isRepeatEnabled || pointB === null || isFadingRef.current) return;

    const startPoint = pointA !== null ? pointA : 0;
    const endPoint = pointB;

    if (currentTime >= endPoint) {
      if (isLoopFadeEnabled && (endPoint - startPoint >= 1.0) && volume > 0) {
        // Trigger smooth fade out
        isFadingRef.current = true;
        const fadeSteps = 10;
        const fadeInterval = 15; // 15ms * 10 steps = 150ms total fade duration
        let currentStep = 0;
        const initialVol = volume;

        const intervalId = setInterval(() => {
          currentStep++;
          const targetVol = initialVol * (1 - currentStep / fadeSteps);
          setActiveVolume(targetVol);

          if (currentStep >= fadeSteps) {
            clearInterval(intervalId);
            // Once volume is completely faded out, perform precise jump to A
            jumpToAndPlay(startPoint);
            
            // Wait slightly for the seek/jump to register, then restore volume smoothly
            setTimeout(() => {
              let restoreStep = 0;
              const restoreIntervalId = setInterval(() => {
                restoreStep++;
                const restoredVol = initialVol * (restoreStep / fadeSteps);
                setActiveVolume(restoredVol);

                if (restoreStep >= fadeSteps) {
                  clearInterval(restoreIntervalId);
                  setActiveVolume(initialVol);
                  isFadingRef.current = false;
                }
              }, 15);
            }, 30);
          }
        }, fadeInterval);
      } else {
        // No fade-out, precise direct jump
        jumpToAndPlay(startPoint);
      }
    }
  }, [currentTime, pointA, pointB, isRepeatEnabled, isLoopFadeEnabled, volume]);

  const togglePlay = () => {
    if (!audioUrl) return;
    if (!isPlaying) {
      // 解決部分內嵌瀏覽器 (如 Line) 除非手動改變音量否則沒有聲音的問題
      setTimeout(() => setVolume(v => v >= 1 ? 0.99 : v + 0.01), 50);
      // 同步觸發底層播放器，避免 React 狀態更新延遲導致 iOS/Line 判定非使用者主動操作
      const internal = playerRef.current?.getInternalPlayer();
      if (internal) {
        try {
          if (typeof internal.playVideo === 'function') {
            internal.playVideo();
          } else if (typeof internal.play === 'function') {
            const playPromise = internal.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(() => {});
            }
          }
        } catch (e) {
          console.warn('Direct play triggered error', e);
        }
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleProgressBarInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (!progressBarRef.current || !playerRef.current || duration === 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const percent = Math.min(Math.max(0, (clientX - rect.left) / rect.width), 1);
    const newTime = percent * duration;
    setPreviewTime(newTime);
    return { newTime, percent };
  };

  const handleSeek = (e: React.MouseEvent | React.TouchEvent) => {
    const result = handleProgressBarInteraction(e);
    if (result && playerRef.current) {
      playerRef.current.seekTo(result.newTime, 'seconds');
      setCurrentTime(result.newTime);
    }
  };

  const onProgressMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const result = handleProgressBarInteraction(e);
    if (result) setPreviewTime(result.newTime);
  };

  const onProgressMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    setIsScrubbing(true);
    handleSeek(e);
  };

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      if (!isScrubbing || !progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const percent = Math.min(Math.max(0, (clientX - rect.left) / rect.width), 1);
      const newTime = percent * duration;
      setPreviewTime(newTime);
      if (playerRef.current) {
        playerRef.current.seekTo(newTime, 'seconds');
        setCurrentTime(newTime);
      }
    };
    const handleGlobalUp = () => {
      setIsScrubbing(false);
    };

    if (isScrubbing) {
      window.addEventListener('mousemove', handleGlobalMove);
      window.addEventListener('mouseup', handleGlobalUp);
      window.addEventListener('touchmove', handleGlobalMove, { passive: false });
      window.addEventListener('touchend', handleGlobalUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('touchend', handleGlobalUp);
    };
  }, [isScrubbing, duration]);

  const setA = () => { 
    setPointA(currentTime); 
    jumpToAndPlay(currentTime);
  };

  const setB = () => {
    if (pointA !== null && currentTime <= pointA) {
      setError('點 B 必須在點 A 之後');
      setTimeout(() => setError(''), 3000);
      return;
    }
    setPointB(currentTime);
    jumpToAndPlay(Math.max(0, currentTime - 5));
  };

  const applyInputA = () => {
    const parsed = parseTimeInput(inputA);
    if (parsed !== null && !isNaN(parsed)) {
      const finalA = duration ? Math.min(parsed, duration) : parsed;
      setPointA(finalA);
      jumpToAndPlay(finalA);
    }
  };

  const applyInputB = () => {
    const parsed = parseTimeInput(inputB);
    if (parsed !== null && !isNaN(parsed)) {
      if (pointA !== null && parsed <= pointA) { 
        setError('B 必須大於 A'); 
        return; 
      }
      const finalB = duration ? Math.min(parsed, duration) : parsed;
      setPointB(finalB);
      jumpToAndPlay(Math.max(0, finalB - 5));
    }
  };

  const applyRange = () => {
    const parts = rangeInput.split(/[-~]/);
    if (parts.length === 2) {
      const startStr = parts[0].trim();
      const endStr = parts[1].trim();
      
      const start = startStr === '' ? 0 : parseTimeInput(startStr);
      const end = parseTimeInput(endStr);
      
      if (start !== null && end !== null && start < end) {
        const finalStart = duration ? Math.min(start, duration) : start;
        const finalEnd = duration ? Math.min(end, duration) : end;
        setPointA(finalStart); 
        setPointB(finalEnd);
        setRangeInput(`${formatForInput(finalStart)}~${formatForInput(finalEnd)}`);
        jumpToAndPlay(finalStart);
      }
    }
  };

  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
  };

  const latestARef = useRef<number | null>(null);
  const latestBRef = useRef<number | null>(null);

  const adjustAInner = (delta: number) => {
    setPointA(prevA => {
      const { pointB: pB, currentTime: cT } = stateRef.current;
      let current = prevA !== null ? prevA : cT;
      let newA = current + delta;
      newA = Math.max(0, newA);
      newA = Math.round(newA * 10) / 10;
      if (pB !== null && newA >= pB) newA = Math.max(0, pB - 0.1);
      latestARef.current = newA;
      return newA;
    });
  };

  const adjustBInner = (delta: number) => {
    setPointB(prevB => {
      const { pointA: pA, currentTime: cT, duration: dur } = stateRef.current;
      let current = prevB !== null ? prevB : cT;
      let newB = current + delta;
      newB = Math.max(0, newB);
      if (dur) newB = Math.min(dur, newB);
      newB = Math.round(newB * 10) / 10;
      if (pA !== null && newB <= pA) newB = pA + 0.1;
      latestBRef.current = newB;
      return newB;
    });
  };

  const handleHold = (type: string, delta: number) => {
    const action = type === 'A' ? adjustAInner : adjustBInner;
    action(delta);
    holdTimer.current = setTimeout(() => {
      holdInterval.current = setInterval(() => {
        action(delta);
      }, 100);
    }, 400);
  };

  const handleHoldEnd = (type: string) => {
    stopHold();
    setTimeout(() => {
      if (type === 'A' && latestARef.current !== null) {
        jumpToAndPlay(latestARef.current);
      } else if (type === 'B' && latestBRef.current !== null) {
        jumpToAndPlay(Math.max(0, latestBRef.current - 5));
      }
    }, 50); // slight delay to ensure state sets resolve if we strictly needed them, though the ref is sync
  };

  const getHoldHandlers = (type: string, delta: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      handleHold(type, delta);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      handleHoldEnd(type);
    },
    onPointerCancel: (e: React.PointerEvent) => {
       e.currentTarget.releasePointerCapture(e.pointerId);
       handleHoldEnd(type);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault()
  });

  const clearAB = () => {
    setPointA(null);
    setPointB(null);
    setInputA('');
    setInputB('');
    setRangeInput('');
  };



  const Player = ReactPlayer as any;

  const skip = (amount: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(currentTime + amount, 'seconds');
    }
  };

  const handleShare = async () => {
    if (!audioUrl) {
      alert("❌ 目前沒有可分享的音檔。");
      return;
    }
    if (audioUrl.startsWith('blob:')) {
      alert("❌ 本機上傳的音檔無法直接分享，請使用網路連結。");
      return;
    }

    const params = new URLSearchParams();
    
    // 極致壓縮網址策略
    const ytMatch = audioUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
    const vmMatch = audioUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    const dmMatch = audioUrl.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([^&?]+)/);
    
    if (ytMatch && ytMatch[1]) {
      // YouTube 只留 v=ID
      params.set('v', ytMatch[1]);
    } else if (vmMatch && vmMatch[1]) {
      // Vimeo 只留 vm=ID
      params.set('vm', vmMatch[1]);
    } else if (dmMatch && dmMatch[1]) {
      // Dailymotion 只留 dm=ID
      params.set('dm', dmMatch[1]);
    } else {
      // 一般網址改用 'u' 參數，並且剝除可能多餘的 query 字串以節省長度
      try {
        const cleanUrl = new URL(audioUrl);
        // 保留乾淨的基礎網址
        params.set('u', cleanUrl.origin + cleanUrl.pathname);
      } catch (e) {
        // 如果不是有效 URL 則原樣放入
        params.set('u', audioUrl);
      }
    }

    if (pointA !== null) params.set('a', Math.round(pointA).toString());
    if (pointB !== null) params.set('b', Math.round(pointB).toString());

    if (transcriptLines && transcriptLines.length > 0) {
      try {
        const linesStr = JSON.stringify(transcriptLines);
        const compressed = LZString.compressToEncodedURIComponent(linesStr);
        params.set('t', compressed);
      } catch (err) {
        console.error("Failed to compress transcript for sharing", err);
      }
    }

    let finalOrigin = window.location.origin.replace('ais-dev-', 'ais-pre-');
    // 解碼掉 params.toString() 中不必要的 %3A (:) 與 %2F (/) 讓網址看起來更直觀短小
    const decodedHash = params.toString().replace(/%3A/g, ':').replace(/%2F/g, '/');
    let finalUrl = `${finalOrigin}${window.location.pathname}#${decodedHash}`;

    try {
      const url = new URL(window.location.href);
      url.search = ""; 
      url.hash = decodedHash;
      window.history.replaceState(null, '', url.toString());
    } catch (e) {
      console.warn('History replace failed');
    }

    setSuccessMessage('正在產生連結...');

    // 呼叫後端 API 進行短網址轉換
    try {
      const res = await fetch("/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: finalUrl })
      });
      if (res.ok) {
        finalUrl = await res.text();
      }
    } catch(e) {
      // 網路錯誤，維持原本的長網址
    }

    try {
      await navigator.clipboard.writeText(finalUrl);
      setSuccessMessage('🔗 分享與嵌入對話框已開啟！');
    } catch (err) {
      setSuccessMessage('🔗 連結產生成功！');
    }
    setSharingUrl(finalUrl);
    setShowShareModal(true);
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const copyToClipboard = (text: string) => {
    let copySuccess = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        copySuccess = true;
      }
    } catch (e) {
      console.warn('Clipboard API failed', e);
    }
    
    if (!copySuccess) {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        copySuccess = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (err) {
        console.warn('Legacy copy failed');
      }
    }
    
    if (copySuccess) {
      alert("✅ 已成功複製到剪貼簿！");
    } else {
      alert("❌ 複製失敗，請手動長按選取網址。");
    }
  };

  const filteredBookmarks = bookmarks.filter(b => {
    const matchesQuery = b.label.toLowerCase().includes(bookmarkSearchQuery.toLowerCase()) ||
      formatTime(b.time).includes(bookmarkSearchQuery);
    
    if (bookmarkColorFilter === 'all') return matchesQuery;
    const bColor = b.color || 'gray';
    return matchesQuery && bColor === bookmarkColorFilter;
  });

  const sortedAndFilteredBookmarks = useMemo(() => {
    const list = [...filteredBookmarks];
    if (bookmarkSortBy === 'time-asc') {
      return list.sort((a, b) => a.time - b.time);
    } else if (bookmarkSortBy === 'time-desc') {
      return list.sort((a, b) => b.time - a.time);
    } else if (bookmarkSortBy === 'category') {
      const colorPriority: Record<string, number> = {
        'red': 1,    // 待加強
        'blue': 2,   // 生字區
        'green': 3,  // 已掌握
        'gray': 4    // 預設
      };
      return list.sort((a, b) => {
        const priorityA = colorPriority[a.color || 'gray'] || 99;
        const priorityB = colorPriority[b.color || 'gray'] || 99;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return a.time - b.time;
      });
    }
    return list;
  }, [filteredBookmarks, bookmarkSortBy]);

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 font-sans relative" style={{ backgroundColor: colors.background, color: colors.paragraph }}>
      
      {successMessage && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 px-6 py-4 border shadow-2xl font-bold z-50 transition-all flex items-center gap-3 animate-in fade-in slide-in-from-top-4" style={{ backgroundColor: colors.tertiary, color: colors.background, borderColor: colors.stroke }}>
          <FileAudio className="w-5 h-5" />
          {successMessage}
        </div>
      )}

      {/* Keyboard Shortcut Hints Bar */}
      <div className="max-w-4xl w-full mb-6 p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs font-medium" style={{ borderColor: colors.stroke, backgroundColor: 'rgba(255, 255, 255, 0.01)' }}>
        <div className="flex items-center gap-2" style={{ color: colors.headline }}>
          <Keyboard className="w-4 h-4 text-[#7f5af0]" />
          <span>鍵盤快捷鍵指南</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold" style={{ backgroundColor: '#242629', borderColor: colors.stroke, color: colors.headline }}>Space</kbd>
            <span className="text-[11px]">{isPlaying ? '暫停' : '播放'}</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold" style={{ backgroundColor: '#242629', borderColor: colors.stroke, color: colors.headline }}>A</kbd>
            <span className="text-[11px]">設 A 點</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold" style={{ backgroundColor: '#242629', borderColor: colors.stroke, color: colors.headline }}>B</kbd>
            <span className="text-[11px]">設 B 點</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold">←</kbd>
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold">→</kbd>
            <span className="text-[11px]">微調 5 秒</span>
          </div>
          <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold">Shift</kbd>
            <span className="text-[11px] opacity-40">+</span>
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold">←</kbd>
            <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border font-bold">→</kbd>
            <span className="text-[11px]">微調 1 秒</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl w-full shadow-2xl border rounded-2xl md:rounded-3xl relative" style={{ borderColor: colors.stroke, backgroundColor: colors.background }}>
        
        <div className="p-10 text-center border-b border-opacity-5 rounded-t-2xl md:rounded-t-3xl" style={{ borderColor: colors.paragraph }}>
          <h1 className="text-4xl font-bold mb-3 flex items-center justify-center gap-3" style={{ color: colors.headline }}>
            <RotateCcw className="w-10 h-10" />
            AB Repeat 點讀助手
          </h1>
          <p className="text-lg opacity-90" style={{ color: colors.paragraph }}>精準控制 • 反覆練習 • 輕鬆分享</p>
        </div>

        <div className="px-8 md:px-12 pt-8 md:pt-12">
          <div className="mb-8 flex flex-col gap-4">
            <label className="block text-xs font-bold uppercase tracking-widest opacity-70">載入音檔</label>
            <div 
              className={`group border border-dashed p-8 flex flex-col items-center justify-center transition-all cursor-pointer ${isDragging ? 'bg-opacity-10 scale-[1.02]' : 'hover:bg-opacity-5'}`}
              style={{ 
                borderColor: isDragging ? colors.button : colors.stroke,
                backgroundColor: isDragging ? colors.button : 'transparent'
              }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-10 h-10 mb-3 opacity-60 transition-transform group-hover:-translate-y-1" style={{ color: isDragging ? colors.button : colors.paragraph }} />
              <p className="font-bold mb-1" style={{ color: colors.headline }}>點擊或拖曳音檔/字幕 (.srt, .vtt) 至此處</p>
              <p className="text-xs opacity-60 mb-3" style={{ color: colors.paragraph }}>支援音檔 (MP3, WAV, M4A, AAC) 與自訂字幕檔 (SRT, VTT)</p>
              
              {/* Flex layout container for loaded assets */}
              <div className="flex flex-col md:flex-row gap-3 mt-2" onClick={(e) => e.stopPropagation()}>
                {fileName && (
                  <div className="flex items-center gap-2 px-3 py-1.5 border" style={{ backgroundColor: colors.background, borderColor: colors.stroke }}>
                    <FileAudio className="w-4 h-4" style={{ color: colors.button }} />
                    <span className="text-sm font-mono truncate max-w-[200px] md:max-w-[300px]" style={{ color: colors.headline }}>{fileName}</span>
                  </div>
                )}
                {transcriptLines.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 border relative group/sub" style={{ backgroundColor: colors.background, borderColor: colors.stroke }}>
                    <FileText className="w-4 h-4 text-[#7f5af0]" />
                    <span className="text-sm font-mono" style={{ color: colors.headline }}>
                      已匯入自訂字幕 ({transcriptLines.length} 句)
                    </span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setTranscriptLines([]);
                        setSuccessMessage('字幕已清除！');
                        setTimeout(() => setSuccessMessage(''), 2500);
                      }}
                      className="text-[10px] ml-1 px-1.5 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
                      title="清除字幕"
                    >
                      清除
                    </button>
                  </div>
                )}
              </div>

              <input type="file" ref={fileInputRef} className="hidden" accept="audio/*,.m4a,.aac,.srt,.vtt" onChange={(e) => { if(e.target.files && e.target.files[0]) handleFile(e.target.files[0]); }} />
            </div>

            <div className="flex items-center gap-4 my-2">
              <div className="flex-grow h-px" style={{ backgroundColor: colors.stroke }}></div>
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: colors.secondary }}>或貼上網址</span>
              <div className="flex-grow h-px" style={{ backgroundColor: colors.stroke }}></div>
            </div>

            <div className="flex gap-3">
              <div className="relative flex-grow border" style={{ borderColor: colors.stroke }}>
                <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 opacity-40" />
                <input 
                  type="text" 
                  placeholder="輸入音檔、YouTube 等連結..." 
                  className="w-full pl-12 pr-4 py-4 outline-none focus:ring-2 transition-all border-none" 
                  style={{ backgroundColor: 'transparent', color: colors.headline }} 
                  value={audioUrl} 
                  onChange={(e) => { 
                    setAudioUrl(e.target.value); 
                    setFileName(''); 
                    setUploadedFile(null);
                    setError(''); // 清除錯誤
                  }} 
                />
              </div>
              <button 
                onClick={() => { 
                  setError('');
                  if(playerRef.current) {
                    setSuccessMessage('準備載入中...');
                    setTimeout(() => setSuccessMessage(''), 2000);
                  }
                }} 
                className="px-8 py-4 font-black transition-all hover:opacity-90 active:scale-95 whitespace-nowrap uppercase tracking-widest text-xs border" 
                style={{ backgroundColor: 'transparent', color: colors.headline, borderColor: colors.headline }}
              >
                載入連結
              </button>
            </div>
            {error && <div className="mt-1 text-red-400 text-sm flex items-center gap-2 px-2"><Info className="w-4 h-4 flex-shrink-0" /> {error}</div>}

          </div>
        </div>

        <div id="sticky-header" className="sticky top-0 z-40 border-b-2 shadow-2xl transition-all" style={{ backgroundColor: colors.background, borderColor: colors.stroke }}>
          <div className="px-4 md:px-8 py-3">
            {/* The video container, if visible, maybe make it very small or hidden when scrolling? We'll just shrink its margins. */}
            <div className={`mb-3 overflow-hidden transition-all duration-500 border rounded-lg mx-auto bg-black ${isVideo ? 'shadow-md opacity-100 w-full max-w-[500px] aspect-video' : 'h-1 opacity-0 pointer-events-none mb-0 border-none m-0'}`} style={{ borderColor: colors.stroke }}>
              <div className="relative w-full h-full flex justify-center items-center">
                    {isDailymotion && dmVideoId ? (
                      <DailymotionPlayer
                        videoId={dmVideoId}
                        playing={isPlaying}
                        volume={activeVolume}
                        playbackRate={playbackRate}
                        onProgress={(state) => {
                          setCurrentTime(state.playedSeconds);
                        }}
                        onDuration={(dur) => setDuration(dur)}
                        onEnded={() => {
                          if (isRepeatEnabled) {
                            if (pointA !== null) jumpToAndPlay(pointA);
                            else jumpToAndPlay(0);
                          } else {
                            setIsPlaying(false);
                          }
                        }}
                        onReady={() => {
                          if (lastLoadedUrl.current === audioUrl) return;
                          lastLoadedUrl.current = audioUrl;
                          const searchParams = new URLSearchParams(window.location.search);
                          const hashParams = new URLSearchParams(window.location.hash.slice(1));
                          const aParam = searchParams.get('a') || hashParams.get('a');
                          if (aParam && playerRef.current) {
                            setTimeout(() => playerRef.current.seekTo(parseFloat(aParam), 'seconds'), 500);
                          }
                          setError('');
                          setSuccessMessage('影片載入成功！');
                          setTimeout(() => setSuccessMessage(''), 3000);
                        }}
                        playerRef={playerRef}
                      />
                    ) : (
                    <Player
                      ref={(player: any) => {
                        if (player) {
                          playerRef.current = player;
                        }
                      }}
                      style={{ position: 'absolute', top: 0, left: 0 }}
                      url={audioUrl}
                      playing={isPlaying}
                      volume={activeVolume}
                      playbackRate={playbackRate}
                      loop={isRepeatEnabled && pointA === null && pointB === null}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => {
                        if (isRepeatEnabled) {
                          if (pointA !== null) {
                            jumpToAndPlay(pointA);
                          } else {
                            jumpToAndPlay(0);
                          }
                        } else {
                          setIsPlaying(false);
                        }
                      }}
                      progressInterval={100}
                      onProgress={(state: any) => {
                        setCurrentTime(state.playedSeconds);
                      }}
                      onDuration={(dur: number) => setDuration(dur)}
                      onReady={() => {
                        if (lastLoadedUrl.current === audioUrl) return;
                        lastLoadedUrl.current = audioUrl;
                        const searchParams = new URLSearchParams(window.location.search);
                        const hashParams = new URLSearchParams(window.location.hash.slice(1));
                        const aParam = searchParams.get('a') || hashParams.get('a');
                        if (aParam && playerRef.current) {
                          playerRef.current.seekTo(parseFloat(aParam), 'seconds');
                        }
                        setError('');
                        setSuccessMessage(isVideo ? '影片載入成功！' : '音檔載入成功！');
                        setTimeout(() => setSuccessMessage(''), 3000);
                      }}
                      onError={() => {
                        if (!audioUrl) return;
                        setError('載入失敗，可能原因：連結無效、該網站禁止嵌入、或 CORS 權限限制。');
                        setSuccessMessage('');
                      }}
                      width="100%"
                      height="100%"
                      playsinline={true}
                      config={{
                        file: { attributes: { playsInline: true, webkitplaysinline: "true" } },
                        youtube: { playerVars: { origin: window.location.origin, autoplay: 1, playsinline: 1 } },
                        vimeo: { playerOptions: { playsinline: true, autoplay: true } }
                      } as any}
                    />
                    )}

                 {/* Subtitle Overlay for Video Player */}
                 {isVideo && activeLine && (
                   <div className="absolute bottom-2 md:bottom-4 left-0 w-full px-4 flex flex-col items-center justify-end pointer-events-none z-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                     <div className="flex flex-wrap items-center justify-center gap-x-1 md:gap-x-1.5 bg-black/60 px-3 py-1 md:px-4 md:py-1.5 rounded-lg backdrop-blur-sm max-w-[95%]">
                       {activeLine.words.map((word, i) => {
                         const isWordActive = i === activeWordIndex;
                         const wordText = word.word || word.romaji || "";
                         return (
                           <span 
                             key={i} 
                             className={`text-xs sm:text-sm md:text-base font-bold transition-all duration-300 ease-out transform ${isWordActive ? 'text-[#7f5af0] -translate-y-0.5 scale-110 drop-shadow-[0_0_8px_rgba(127,90,240,0.8)]' : 'text-white/90'}`}
                           >
                             {wordText}
                           </span>
                         )
                       })}
                     </div>
                     {activeLine.translation && (
                       <div className="mt-1 md:mt-1.5 flex justify-center transition-all duration-300">
                         <span className="text-[10px] md:text-xs font-medium text-white bg-black/70 px-2 md:px-3 py-0.5 md:py-1 rounded shadow-sm text-center line-clamp-1 max-w-[95%]">
                           {activeLine.translation}
                         </span>
                       </div>
                     )}
                   </div>
                 )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {/* Top Row: Time, Progress Bar, Play Controls */}
              <div className="flex flex-col gap-3">
                <div className="flex-grow flex flex-col gap-1.5 justify-center">
                  <div className="flex justify-between items-center px-1">
                    <span className="font-mono text-sm font-bold tracking-tight" style={{ color: colors.headline }}>{formatTime(currentTime)} <span className="opacity-40 font-normal">/ {formatTime(duration)}</span></span>
                  </div>

                  <div className="relative h-6 flex items-center group/bar">
                    <div 
                      ref={progressBarRef} 
                      onMouseDown={onProgressMouseDown}
                      onTouchStart={onProgressMouseDown}
                      onMouseMove={onProgressMouseMove}
                      onTouchMove={onProgressMouseMove}
                      onMouseEnter={() => setIsHoveringBar(true)}
                      onMouseLeave={() => { if (!isScrubbing) { setIsHoveringBar(false); setPreviewTime(null); } }}
                      className={`relative w-full h-3 cursor-pointer overflow-hidden shadow-inner rounded-full transition-all duration-150 group-hover/bar:h-4 ${
                        isScrubbing 
                          ? 'h-4 brightness-125 scale-y-[1.1] shadow-md' 
                          : 'active:brightness-115 active:scale-y-[1.05]'
                      }`}
                      style={{ backgroundColor: colors.stroke }}
                    >
                      {/* 預覽條 */}
                      {previewTime !== null && (
                        <div 
                          className="absolute top-0 left-0 h-full opacity-25 pointer-events-none transition-all duration-75" 
                          style={{ width: `${(previewTime / duration) * 100}%`, backgroundColor: colors.button }} 
                        />
                      )}
                      {/* 當前進度 */}
                      <div 
                        className={`absolute top-0 left-0 h-full transition-all pointer-events-none ${
                          isScrubbing ? 'opacity-80' : 'opacity-40 group-hover/bar:opacity-50'
                        }`} 
                        style={{ width: `${(currentTime / duration) * 100}%`, backgroundColor: colors.button }} 
                      />
                      {/* AB 區間填充 */}
                      {pointA !== null && pointB !== null && (
                        <div 
                          className={`absolute top-0 h-full transition-all ${
                            isScrubbing ? 'opacity-65' : 'opacity-45 group-hover/bar:opacity-55'
                          }`} 
                          style={{ left: `${(pointA / duration) * 100}%`, width: `${((pointB - pointA) / duration) * 100}%`, backgroundColor: colors.tertiary }} 
                        />
                      )}
                    </div>

                    {/* Hover Timestamp Tooltip */}
                    {previewTime !== null && duration > 0 && (
                      <div 
                        className="absolute -top-10 -translate-x-1/2 pointer-events-none z-40 transition-all duration-75"
                        style={{ left: `${(previewTime / duration) * 100}%` }}
                      >
                        <div className="px-2 py-0.5 rounded text-[10px] font-mono font-bold shadow-lg border whitespace-nowrap flex flex-col items-center relative"
                          style={{ 
                            backgroundColor: colors.background, 
                            color: colors.headline, 
                            borderColor: colors.button 
                          }}
                        >
                          {formatTime(previewTime)}
                          {/* Triangle arrow pointing down */}
                          <div className="w-1.5 h-1.5 border-r border-b rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2" 
                            style={{ 
                              backgroundColor: colors.background, 
                              borderColor: colors.button 
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {/* A/B Markers */}
                    {pointA !== null && (
                      <div 
                        className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center -translate-x-1/2 cursor-ew-resize z-30 group select-none touch-none w-11 h-11 animate-fade-in" 
                        style={{ left: `${(pointA / duration) * 100}%` }}
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingMarker('A'); }}
                        onTouchStart={(e) => { e.stopPropagation(); setDraggingMarker('A'); }}
                      >
                        {/* Large invisible hit area visual cue */}
                        <div className={`absolute inset-0 rounded-full transition-all duration-200 pointer-events-none scale-75 ${
                          draggingMarker === 'A' 
                            ? 'bg-[#7f5af0]/20 scale-90' 
                            : 'bg-[#7f5af0]/0 group-hover:bg-[#7f5af0]/10 group-active:bg-[#7f5af0]/25 group-active:scale-95'
                        }`} />
                        
                        <div className={`text-[9px] px-1.5 py-0.5 font-bold shadow-md transition-all duration-150 border rounded-sm relative z-10 ${
                          draggingMarker === 'A' 
                            ? 'scale-125 brightness-125 shadow-purple-500/20 shadow-lg ring-1 ring-[#7f5af0]/40' 
                            : 'group-hover:scale-110 group-active:scale-115 group-active:brightness-125 hover:border-[#7f5af0]'
                        }`} style={{ backgroundColor: colors.background, color: colors.headline, borderColor: colors.headline }}>
                          {draggingMarker === 'A' ? formatTime(pointA) : 'A'}
                        </div>
                      </div>
                    )}
                    {pointB !== null && (
                      <div 
                        className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center -translate-x-1/2 cursor-ew-resize z-30 group select-none touch-none w-11 h-11 animate-fade-in" 
                        style={{ left: `${(pointB / duration) * 100}%` }}
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingMarker('B'); }}
                        onTouchStart={(e) => { e.stopPropagation(); setDraggingMarker('B'); }}
                      >
                        {/* Large invisible hit area visual cue */}
                        <div className={`absolute inset-0 rounded-full transition-all duration-200 pointer-events-none scale-75 ${
                          draggingMarker === 'B' 
                            ? 'bg-[#2cb67d]/20 scale-90' 
                            : 'bg-[#2cb67d]/0 group-hover:bg-[#2cb67d]/10 group-active:bg-[#2cb67d]/25 group-active:scale-95'
                        }`} />
                        
                        <div className={`text-[9px] px-1.5 py-0.5 font-bold shadow-md transition-all duration-150 border rounded-sm relative z-10 ${
                          draggingMarker === 'B' 
                            ? 'scale-125 brightness-125 shadow-emerald-500/20 shadow-lg ring-1 ring-[#2cb67d]/40' 
                            : 'group-hover:scale-110 group-active:scale-115 group-active:brightness-125 hover:border-[#2cb67d]'
                        }`} style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.button }}>
                          {draggingMarker === 'B' ? formatTime(pointB) : 'B'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 微型書籤時間軸 (Bookmark Timeline) */}
                  {duration > 0 && bookmarks.length > 0 && (
                    <div className="relative h-4 mt-0.5 flex items-center border-t border-b border-white/[0.04] bg-white/[0.01] rounded-md overflow-visible select-none px-1">
                      {/* Background horizontal timeline guide line */}
                      <div className="absolute left-1 right-1 h-[2px] bg-white/[0.08] rounded-full pointer-events-none" />

                      {/* Dots representation of bookmarks */}
                      {bookmarks.map((bookmark) => {
                        const bColorObj = bookmarkColors.find(c => c.value === (bookmark.color || 'gray')) || bookmarkColors[0];
                        const positionPct = (bookmark.time / duration) * 100;
                        const isCurrentActive = Math.abs(currentTime - bookmark.time) < 0.5;

                        return (
                          <div
                            key={`timeline-${bookmark.id}`}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 group/dot cursor-pointer"
                            style={{ left: `${positionPct}%` }}
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpToAndPlay(bookmark.time);
                            }}
                            onMouseEnter={() => setHoveredTimelineB(bookmark)}
                            onMouseLeave={() => setHoveredTimelineB(null)}
                          >
                            {/* Glowing/pulse ring around active/hovered dot */}
                            <div 
                              className={`absolute -inset-2 rounded-full transition-all duration-300 ${
                                isCurrentActive ? 'scale-100 opacity-50 animate-ping' : 'scale-50 opacity-0 group-hover/dot:scale-100 group-hover/dot:opacity-30'
                              }`}
                              style={{ backgroundColor: bColorObj.dot }}
                            />

                            {/* Core color dot */}
                            <div 
                              className={`w-2 h-2 rounded-full border border-black/50 shadow-sm transition-all duration-150 relative ${
                                isCurrentActive 
                                  ? 'scale-125 ring-2 ring-white/60 brightness-110 shadow-lg' 
                                  : 'group-hover/dot:scale-125 hover:brightness-110'
                              }`}
                              style={{ 
                                backgroundColor: bColorObj.dot,
                                boxShadow: isCurrentActive ? `0 0 8px ${bColorObj.dot}` : undefined 
                              }}
                            />
                          </div>
                        );
                      })}

                      {/* Floating Tooltip design */}
                      {hoveredTimelineB && (
                        <div 
                          className="absolute bottom-6 -translate-x-1/2 pointer-events-none z-50 animate-in fade-in zoom-in-95 duration-100"
                          style={{ left: `${(hoveredTimelineB.time / duration) * 100}%` }}
                        >
                          <div 
                            className="px-2.5 py-1.5 rounded-lg text-[10px] font-sans font-bold shadow-2xl border whitespace-nowrap flex flex-col items-center gap-0.5"
                            style={{ 
                              backgroundColor: '#16161a', 
                              color: '#ffffff', 
                              borderColor: (bookmarkColors.find(c => c.value === (hoveredTimelineB.color || 'gray')) || bookmarkColors[0]).dot 
                            }}
                          >
                            <span className="opacity-50 font-mono tracking-wide text-[9px]">
                              {formatTime(hoveredTimelineB.time)}
                            </span>
                            <span className="truncate max-w-[140px] font-medium text-white/95 text-[10px]">
                              {hoveredTimelineB.label || '無標籤'}
                            </span>
                            <span 
                              className="text-[8px] font-bold px-1 py-0.2 rounded-sm mt-0.5"
                              style={{ 
                                backgroundColor: `${(bookmarkColors.find(c => c.value === (hoveredTimelineB.color || 'gray')) || bookmarkColors[0]).dot}20`,
                                color: (bookmarkColors.find(c => c.value === (hoveredTimelineB.color || 'gray')) || bookmarkColors[0]).dot
                              }}
                            >
                              {(bookmarkColors.find(c => c.value === (hoveredTimelineB.color || 'gray')) || bookmarkColors[0]).label}
                            </span>
                            {/* Arrow */}
                            <div 
                              className="w-1.5 h-1.5 border-r border-b rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2 bg-[#16161a]" 
                              style={{ borderColor: (bookmarkColors.find(c => c.value === (hoveredTimelineB.color || 'gray')) || bookmarkColors[0]).dot }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Play Controls Row placed centrally below the progress bar */}
                <div className="flex justify-center items-center gap-6 mt-1">
                  <button onClick={() => { if (playerRef.current) playerRef.current.seekTo(Math.max(0, currentTime - 3), 'seconds'); }} className="flex-shrink-0 aspect-square w-11 h-11 rounded-full flex items-center justify-center hover:scale-105 active:scale-90 transition-all bg-white/5 hover:bg-white/10 text-white shadow-sm border border-white/5" title="倒退 3 秒">
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  <button onClick={togglePlay} className="flex-shrink-0 aspect-square w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 active:scale-90 transition-all shadow-md" style={{ backgroundColor: colors.button, color: colors.buttonText }}>
                     {isPlaying ? <Pause className="w-7 h-7 fill-current" /> : <Play className="w-7 h-7 fill-current ml-1.5" />}
                  </button>
                  <button onClick={() => { if (playerRef.current) playerRef.current.seekTo(Math.min(duration, currentTime + 3), 'seconds'); }} className="flex-shrink-0 aspect-square w-11 h-11 rounded-full flex items-center justify-center hover:scale-105 active:scale-90 transition-all bg-white/5 hover:bg-white/10 text-white shadow-sm border border-white/5" title="快轉 3 秒">
                    <RotateCw className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 md:px-8 pb-3">
          <div className="flex flex-col gap-3">
              {/* Playback Settings Panel */}
              <div className="flex items-center justify-between flex-wrap gap-4 bg-white/[0.03] border border-white/5 rounded-xl p-3 sm:p-4 text-xs">
                {/* Left: Speed Settings */}
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider opacity-60">播放速度</span>
                  <div className="flex items-center bg-black/40 border border-white/10 rounded px-1.5 py-0.5">
                    <button onClick={() => setPlaybackRate(v => Math.max(0.1, v - 0.1))} className="px-1.5 py-0.5 hover:bg-white/10 rounded text-xs font-bold transition-all" title="速度減少 0.1">-</button>
                    <span className="text-xs font-mono font-bold w-7 text-center">{playbackRate.toFixed(1)}x</span>
                    <button onClick={() => setPlaybackRate(v => Math.min(3.0, v + 0.1))} className="px-1.5 py-0.5 hover:bg-white/10 rounded text-xs font-bold transition-all" title="速度增加 0.1">+</button>
                  </div>
                </div>

                {/* Right: Volume */}
                <div className="flex items-center gap-2">
                  <Volume2 className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={volume} 
                    onChange={(e) => setVolume(parseFloat(e.target.value))} 
                    className="w-16 sm:w-24 h-1 appearance-none cursor-pointer accent-[#7f5af0] flex-shrink-0 rounded-full" 
                    style={{ backgroundColor: colors.stroke }} 
                  />
                </div>
              </div>

              {/* 當前 A/B 循環區間對應的字幕名稱與建議 */}
              {pointA !== null && pointB !== null && (
                <div 
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-[#7f5af0]/10 border border-[#7f5af0]/20 rounded-lg p-3.5 transition-all duration-300"
                  style={{ borderColor: `${colors.button}30` }}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span 
                      className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider whitespace-nowrap select-none mt-0.5" 
                      style={{ backgroundColor: `${colors.button}20`, color: colors.button }}
                    >
                      當前循環句
                    </span>
                    <div className="flex flex-col min-w-0">
                      {currentLoopName ? (
                        <>
                          <span className="text-xs sm:text-sm font-bold text-white font-sans break-words leading-relaxed">
                            {currentLoopName}
                          </span>
                          {currentLoopTranslation && (
                            <span className="text-[11px] text-white/50 font-medium font-sans mt-0.5 break-words">
                              {currentLoopTranslation}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-white/40 italic">
                          當前 A/B 時間點 ({formatTime(pointA)} ~ {formatTime(pointB)}) 未偵測到完整對應的字幕句。
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* 一鍵儲存該句為書籤 */}
                  {currentLoopName && (
                    <button
                      onClick={() => {
                        const existing = bookmarks.find(b => b.label === currentLoopName && Math.abs(b.time - pointA) < 0.1);
                        if (existing) {
                          setSuccessMessage('此句子已存在於書籤中囉！');
                          setTimeout(() => setSuccessMessage(''), 2500);
                          return;
                        }
                        
                        let thumbnail: string | undefined = undefined;
                        try {
                          thumbnail = captureScreenshot();
                        } catch (e) {
                          console.warn('Screenshot capture error:', e);
                        }

                        const newB: Bookmark = {
                          id: Math.random().toString(36).slice(2, 9),
                          time: Math.round(pointA * 10) / 10,
                          label: currentLoopName,
                          thumbnail,
                          color: selectedColorForNewBookmark,
                          pointA: pointA !== null ? Math.round(pointA * 100) / 100 : undefined,
                          pointB: pointB !== null ? Math.round(pointB * 100) / 100 : undefined,
                        };
                        setBookmarks(prev => {
                          const list = [...prev, newB];
                          if (bookmarkSortBy !== 'manual') {
                            return list.sort((a, b) => a.time - b.time);
                          }
                          return list;
                        });
                        setSuccessMessage(`已將此句字幕儲存為具有【${bookmarkColors.find(c => c.value === selectedColorForNewBookmark)?.label || '預設'}】標記的書籤（起點：${formatTime(pointA)}）`);
                        setTimeout(() => setSuccessMessage(''), 3000);
                      }}
                      className="flex-shrink-0 self-start sm:self-center bg-[#7f5af0]/20 hover:bg-[#7f5af0]/30 text-white hover:text-white border border-[#7f5af0]/30 hover:border-[#7f5af0]/50 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 whitespace-nowrap"
                    >
                      <Plus className="w-3 h-3" />
                      <span>儲存此句為書籤</span>
                      <span className="w-2 h-2 rounded-full inline-block ml-0.5" style={{ backgroundColor: bookmarkColors.find(c => c.value === selectedColorForNewBookmark)?.dot || '#ffffff' }} title={`將以「${bookmarkColors.find(c => c.value === selectedColorForNewBookmark)?.label}」顏色標籤儲存`} />
                    </button>
                  )}
                </div>
              )}

              {/* Bottom Row: A/B Controls (Compact) */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white/5 rounded-lg px-3 py-3 md:py-2 border border-white/5 overflow-hidden">
                
                {/* A & B Group */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 md:gap-3 w-full md:w-auto">
                  {/* Point A Input */}
                  <div className="flex items-center justify-between sm:justify-center gap-1.5 bg-black/40 rounded px-2 py-1.5 sm:px-1.5 sm:py-1 border border-white/10 w-full sm:w-auto">
                    <span className="text-[10px] font-black opacity-50 sm:hidden ml-1">起點 A</span>
                    <span className="text-[10px] hidden sm:inline font-black opacity-50">A</span>
                    <div className="flex items-center gap-1">
                      <button {...getHoldHandlers('A', -0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Minus className="w-3 h-3 opacity-70" /></button>
                      <input type="text" value={inputA} onChange={(e) => setInputA(e.target.value)} onBlur={applyInputA} onKeyDown={(e) => e.key === 'Enter' && applyInputA()} placeholder="00:00" className="w-14 sm:w-11 text-center font-mono text-[11px] bg-transparent outline-none" />
                      <button {...getHoldHandlers('A', 0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Plus className="w-3 h-3 opacity-70" /></button>
                      <button onClick={setA} className="ml-1 sm:ml-0.5 text-[11px] sm:text-[10px] bg-white/10 hover:bg-white/20 rounded px-2 py-1 sm:px-1.5 sm:py-0.5 transition-colors whitespace-nowrap">設為當前</button>
                    </div>
                  </div>

                  {/* Point B Input */}
                  <div className="flex items-center justify-between sm:justify-center gap-1.5 bg-[#7f5af0]/10 sm:bg-black/40 rounded px-2 py-1.5 sm:px-1.5 sm:py-1 border border-[#7f5af0]/30 sm:border-white/10 w-full sm:w-auto">
                    <span className="text-[10px] font-black sm:hidden ml-1" style={{ color: colors.button }}>終點 B</span>
                    <span className="text-[10px] hidden sm:inline font-black" style={{ color: colors.button }}>B</span>
                    <div className="flex items-center gap-1">
                      <button {...getHoldHandlers('B', -0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Minus className="w-3 h-3 opacity-70" /></button>
                      <input type="text" value={inputB} onChange={(e) => setInputB(e.target.value)} onBlur={applyInputB} onKeyDown={(e) => e.key === 'Enter' && applyInputB()} placeholder="00:00" className="w-14 sm:w-11 text-center font-mono text-[11px] bg-transparent outline-none" style={{ color: colors.button }} />
                      <button {...getHoldHandlers('B', 0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Plus className="w-3 h-3 opacity-70" /></button>
                      <button onClick={setB} className="ml-1 sm:ml-0.5 text-[11px] sm:text-[10px] rounded px-2 py-1 sm:px-1.5 sm:py-0.5 transition-colors whitespace-nowrap" style={{ backgroundColor: colors.button, color: colors.buttonText }}>設為當前</button>
                    </div>
                  </div>
                </div>

                {/* Range, Repeat, and Actions Group */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between md:justify-end gap-3 md:gap-3 w-full md:w-auto mt-2 md:mt-0">
                  <div className="flex items-center justify-between sm:justify-center gap-2 sm:gap-1 bg-black/40 rounded px-2 py-1.5 sm:px-1.5 sm:py-1 border border-white/10 w-full sm:w-auto">
                    <span className="text-[11px] sm:text-[10px] font-black opacity-50 whitespace-nowrap ml-1 sm:ml-0">快速區間</span>
                    <input type="text" value={rangeInput} onChange={(e) => setRangeInput(e.target.value)} onBlur={applyRange} onKeyDown={(e) => e.key === 'Enter' && applyRange()} placeholder="A~B" className="w-14 sm:w-12 text-center font-mono text-[11px] bg-transparent outline-none border-b border-white/20 focus:border-white/50 transition-colors pb-0" />
                  </div>

                  <div className="flex flex-row items-center justify-between sm:justify-end gap-2 w-full sm:w-auto px-1 sm:px-0">
                    <div className="flex items-center gap-4 sm:gap-3">
                      <label className="flex items-center gap-1.5 sm:gap-1 cursor-pointer">
                        <input type="checkbox" checked={isRepeatEnabled} onChange={(e) => setIsRepeatEnabled(e.target.checked)} className="w-4 h-4 sm:w-3 sm:h-3 accent-[#7f5af0]" />
                        <span className={`text-sm sm:text-[10px] font-bold whitespace-nowrap ${isRepeatEnabled ? 'text-white' : 'opacity-50'}`}>循環</span>
                      </label>

                      <label className="flex items-center gap-1.5 sm:gap-1 cursor-pointer" title="自動循環增強：超出 B 點時極短淡出再跳回 A 點，聽力練習流暢不刺耳">
                        <input type="checkbox" checked={isLoopFadeEnabled} onChange={(e) => setIsLoopFadeEnabled(e.target.checked)} className="w-4 h-4 sm:w-3 sm:h-3 accent-[#7f5af0]" />
                        <span className={`text-sm sm:text-[10px] font-bold whitespace-nowrap ${isLoopFadeEnabled ? 'text-white' : 'opacity-50'}`}>淡出</span>
                      </label>
                    </div>

                    <div className="flex items-center justify-end gap-2 sm:gap-1 sm:border-l sm:border-white/10 sm:pl-2">
                      <button onClick={clearAB} title="清除標記" className="p-2 sm:p-1.5 hover:bg-white/10 rounded transition-colors text-red-400 group flex items-center justify-center bg-black/20 sm:bg-transparent"><Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 opacity-70 group-hover:opacity-100" /></button>
                      <button onClick={handleShare} title="產生分享連結" className="p-2 sm:p-1.5 hover:bg-white/10 rounded transition-colors group flex items-center justify-center bg-black/20 sm:bg-transparent"><Share2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 opacity-70 group-hover:opacity-100" /></button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        {/* 書籤紀錄與重點標記 */}
        <div className="mx-8 md:mx-12 mb-8 p-6 rounded-2xl border border-white/5 bg-white/[0.02]" style={{ borderColor: colors.stroke }}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 border-b border-white/5 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-lg bg-[#7f5af0]/10 text-[#7f5af0] flex items-center justify-center">
                <BookmarkIcon className="w-5 h-5 animate-pulse" />
              </span>
              <div>
                <h3 className="font-bold text-base" style={{ color: colors.headline }}>
                  書籤紀錄與重點標記
                </h3>
                <p className="text-xs opacity-60">儲存特定時間點與備忘標籤，隨時一鍵精確跳轉聽力練習</p>
              </div>
            </div>

            {/* 搜尋過濾與排序 */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              {/* 搜尋過濾 */}
              <div className="relative w-full sm:w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
                <input 
                  type="text" 
                  placeholder="搜尋書籤或時間..." 
                  className="w-full pl-9 pr-4 py-1.5 text-xs bg-black/40 border border-white/10 rounded-lg outline-none focus:border-[#7f5af0]/50 transition-colors"
                  style={{ color: colors.headline }}
                  value={bookmarkSearchQuery}
                  onChange={(e) => setBookmarkSearchQuery(e.target.value)}
                />
              </div>

              {/* 排序控制 */}
              <div className="flex items-center justify-between sm:justify-start gap-1 bg-black/30 border border-white/10 rounded-lg p-0.5 text-xs">
                <span className="text-[10px] opacity-40 px-1.5 font-sans pointer-events-none">排序：</span>
                <button
                  type="button"
                  onClick={() => setBookmarkSortBy('time-asc')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    bookmarkSortBy === 'time-asc'
                      ? 'bg-[#7f5af0]/20 border border-[#7f5af0]/30 text-[#a78bfa]'
                      : 'text-white/60 hover:text-white border border-transparent'
                  }`}
                  title="依時間先後順序正序排序"
                >
                  時間 ↑
                </button>
                <button
                  type="button"
                  onClick={() => setBookmarkSortBy('time-desc')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    bookmarkSortBy === 'time-desc'
                      ? 'bg-[#7f5af0]/20 border border-[#7f5af0]/30 text-[#a78bfa]'
                      : 'text-white/60 hover:text-white border border-transparent'
                  }`}
                  title="依時間先後順序倒序排序"
                >
                  時間 ↓
                </button>
                <button
                  type="button"
                  onClick={() => setBookmarkSortBy('category')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    bookmarkSortBy === 'category'
                      ? 'bg-[#7f5af0]/20 border border-[#7f5af0]/30 text-[#a78bfa]'
                      : 'text-white/60 hover:text-white border border-transparent'
                  }`}
                  title="依標籤類別/顏色排序"
                >
                  類別
                </button>
                <button
                  type="button"
                  onClick={() => setBookmarkSortBy('manual')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    bookmarkSortBy === 'manual'
                      ? 'bg-[#7f5af0]/20 border border-[#7f5af0]/30 text-[#a78bfa]'
                      : 'text-white/60 hover:text-white border border-transparent'
                  }`}
                  title="手動拖曳自訂清單順序"
                >
                  手動（可拖曳）
                </button>
              </div>
            </div>
          </div>

          {/* 新增書籤控制列 */}
          <div className="flex flex-col gap-3 mb-5 p-3 rounded-xl bg-white/[0.01] border border-white/5">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-grow">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-40" />
                <input 
                  type="text" 
                  placeholder={`書籤說明（選填，預設：書籤 @ ${formatTime(currentTime)}）`}
                  className="w-full pl-9 pr-28 py-2 text-xs bg-black/40 border border-white/10 rounded-lg outline-none focus:border-[#7f5af0]/50 transition-colors"
                  style={{ color: colors.headline }}
                  value={newBookmarkLabel}
                  onChange={(e) => setNewBookmarkLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBookmark()}
                />
                <button
                  type="button"
                  onClick={generateAIBookmarkLabel}
                  disabled={isGeneratingLabel || pointA === null || pointB === null}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-[#7f5af0]/20 hover:bg-[#7f5af0]/30 border border-[#7f5af0]/30 hover:border-[#7f5af0]/50 text-white transition-all disabled:opacity-30 disabled:scale-100 disabled:cursor-not-allowed active:scale-95"
                  title={pointA === null || pointB === null ? "請設定 AB 區間以分析對應字幕文字" : "自動分析 AB 區間字幕文字並生成繁中標籤"}
                >
                  <Sparkles className={`w-3.5 h-3.5 text-[#a78bfa] ${isGeneratingLabel ? 'animate-spin' : ''}`} />
                  <span>{isGeneratingLabel ? "AI 摘要中" : "AI 自動生成"}</span>
                </button>
              </div>
              <button 
                onClick={addBookmark}
                className="flex-shrink-0 px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 text-white active:scale-95 shadow-md hover:opacity-90"
                style={{ backgroundColor: colors.button }}
              >
                <Plus className="w-3.5 h-3.5" />
                新增當前時間 ({formatTime(currentTime)})
              </button>
            </div>

            {/* 顏色標記選擇器 */}
            <div className="flex flex-wrap items-center gap-2 text-xs border-t border-white/5 pt-2.5">
              <span className="opacity-50">選擇顏色標記：</span>
              <div className="flex flex-wrap gap-1.5">
                {bookmarkColors.map(c => {
                  const isSelected = selectedColorForNewBookmark === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setSelectedColorForNewBookmark(c.value)}
                      className={`px-2.5 py-1 rounded-md border text-[11px] font-medium flex items-center gap-1.5 transition-all select-none ${
                        isSelected 
                          ? `${c.bg} ${c.border} ${c.text} font-bold scale-105 shadow-sm` 
                          : 'bg-black/20 border-white/5 text-white/50 hover:text-white hover:border-white/10 active:scale-95'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: c.dot }} />
                      <span>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 錄製跟讀筆記功能區 */}
            <div className="flex flex-col sm:flex-row gap-3 mt-3 pt-3 border-t border-white/5 justify-between items-center">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl flex items-center justify-center transition-all ${isRecordingShadow ? 'bg-red-500/25 text-red-500 animate-pulse border border-red-500/30' : 'bg-[#7f5af0]/10 text-[#a78bfa] border border-[#7f5af0]/15'}`}>
                  <Mic className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-white/95">
                    {isRecordingShadow ? "正在錄製跟讀語音..." : "跟讀語音錄製筆記"}
                  </span>
                  <span className="text-[9px] text-white/45 leading-none mt-0.5">
                    {isRecordingShadow 
                      ? `已錄製 ${recordingShadowDuration} 秒（上限 15 秒，錄完後自動轉換成書籤）` 
                      : "可透過麥克風隨手跟讀，自動比對並插入專屬跟讀書籤！"
                    }
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {isRecordingShadow ? (
                  <button
                    type="button"
                    onClick={stopShadowRecording}
                    className="px-4 py-1.5 rounded-lg text-xs font-black bg-red-610 hover:bg-red-550 text-white flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all outline-none"
                    title="結束並儲存目前的跟讀語音"
                  >
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    停止並儲存 ({recordingShadowDuration}秒)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startShadowRecording}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#7f5af0]/10 hover:bg-[#7f5af0]/20 border border-[#7f5af0]/35 text-[#a78bfa] flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all outline-none"
                    title="立即錄音：按一下即開始錄音，配上目前的播放時間點"
                  >
                    <Mic className="w-3.5 h-3.5 text-[#a78bfa]" />
                    開始跟讀錄音 ({formatTime(currentTime)})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 書籤分類與批量管理面板 */}
          {bookmarks.length > 0 && (
            <div className="flex flex-col gap-3 mb-5 p-3 rounded-xl bg-white/[0.01] border border-white/5 font-sans">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="opacity-40 font-bold tracking-wider uppercase text-[10px]">顏色篩選：</span>
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setBookmarkColorFilter('all')}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all border ${
                        bookmarkColorFilter === 'all'
                          ? 'bg-white/10 border-white/20 text-white shadow-sm'
                          : 'bg-black/10 border-transparent opacity-40 hover:opacity-100 text-white/60'
                      }`}
                    >
                      全部 ({bookmarks.length})
                    </button>
                    {bookmarkColors.map(c => {
                      const count = bookmarks.filter(b => (b.color || 'gray') === c.value).length;
                      return (
                        <button
                          key={c.value}
                          onClick={() => setBookmarkColorFilter(c.value)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1.5 border ${
                            bookmarkColorFilter === c.value
                              ? `${c.bg} ${c.border} ${c.text} shadow-sm`
                              : 'bg-black/10 border-transparent opacity-40 hover:opacity-100 text-white/60'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full inline-block ${c.glow}`} style={{ backgroundColor: c.dot }} />
                          <span>{c.label} ({count})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="text-[10px] opacity-40 font-mono">
                  顯示 {filteredBookmarks.length} 個書籤
                </div>
              </div>

              {/* 批量操作控制列 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-lg bg-black/30 border border-white/5 text-xs">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-3.5 h-3.5 text-[#7f5af0]" />
                  <span className="font-bold opacity-80" style={{ color: colors.headline }}>批量管理：</span>
                  <span className="text-[10px] opacity-40 px-1.5 py-0.5 bg-white/5 rounded border border-white/5">
                    {bookmarkColorFilter === 'all' 
                      ? '全部書籤' 
                      : `僅限「${bookmarkColors.find(c => c.value === bookmarkColorFilter)?.label}」`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Dropdown select to move current selection */}
                  <div className="relative inline-block">
                    <select
                      className="appearance-none bg-black/40 hover:bg-black/60 border border-white/10 hover:border-white/20 rounded px-2.5 py-1 pr-6 text-[10px] font-medium text-white outline-none cursor-pointer transition-all active:scale-95"
                      value=""
                      onChange={(e) => {
                        const targetColor = e.target.value as 'gray' | 'red' | 'green' | 'blue';
                        if (!targetColor) return;
                        
                        const sourceFilter = bookmarkColorFilter;
                        setBookmarks(prev => prev.map(b => {
                          const curColor = b.color || 'gray';
                          if (sourceFilter === 'all' || curColor === sourceFilter) {
                            return { ...b, color: targetColor };
                          }
                          return b;
                        }));

                        const sourceName = sourceFilter === 'all' ? '全部' : bookmarkColors.find(c => c.value === sourceFilter)?.label;
                        const destName = bookmarkColors.find(c => c.value === targetColor)?.label;
                        setSuccessMessage(`已成功將【${sourceName}】書籤批量移動至【${destName}】類別`);
                        setTimeout(() => setSuccessMessage(''), 2000);
                        e.target.value = '';
                      }}
                    >
                      <option value="" disabled className="bg-[#16161a] text-white/40">批量移至... (顏色變更)</option>
                      {bookmarkColors.map(c => (
                        <option 
                          key={c.value} 
                          value={c.value} 
                          disabled={c.value === bookmarkColorFilter}
                          className="bg-[#16161a] text-white"
                        >
                          {c.label} {c.value === bookmarkColorFilter ? '(目前選取)' : ''}
                        </option>
                      ))}
                    </select>
                    {/* Tiny dropdown arrow */}
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-40 scale-75">▼</span>
                  </div>

                  {/* Batch Delete */}
                  <button
                    onClick={() => {
                      const sourceFilter = bookmarkColorFilter;
                      const sourceName = sourceFilter === 'all' ? '全部' : bookmarkColors.find(c => c.value === sourceFilter)?.label;
                      const countToRemove = sourceFilter === 'all' 
                        ? bookmarks.length 
                        : bookmarks.filter(b => (b.color || 'gray') === sourceFilter).length;
                      
                      if (countToRemove === 0) {
                        alert("沒有可刪除的書籤");
                        return;
                      }

                      const confirmMsg = `您確定要批量刪除 ${countToRemove} 個【${sourceName}】標識的書籤嗎？此操作不可復原。`;
                      if (window.confirm(confirmMsg)) {
                        setBookmarks(prev => prev.filter(b => {
                          const curColor = b.color || 'gray';
                          if (sourceFilter === 'all') return false; // delete all
                          return curColor !== sourceFilter; // delete current color group
                        }));
                        setSuccessMessage(`已成功批量刪除 ${countToRemove} 個【${sourceName}】類別書籤`);
                        setTimeout(() => setSuccessMessage(''), 2500);
                      }
                    }}
                    className="flex items-center gap-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 px-2.5 py-1 rounded text-[10px] font-bold transition-all active:scale-95"
                    title={`批量刪除當前顯示的顏色群組書籤`}
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>批量刪除</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 書籤列表 */}
          {bookmarks.length === 0 ? (
            <div className="py-6 text-center rounded-xl border border-dashed border-white/5 text-xs opacity-50 flex flex-col items-center gap-1">
              <BookmarkIcon className="w-6 h-6 opacity-30 mb-1" />
              <span>尚未建立任何書籤。</span>
              <span>您可以在上方文字框輸入備忘描述，然後點擊「新增當前時間」按鈕。</span>
            </div>
          ) : sortedAndFilteredBookmarks.length === 0 ? (
            <div className="py-6 text-center text-xs opacity-50">
              找不到符合「{bookmarkSearchQuery}」與篩選條件的書籤。
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1 font-sans">
              {sortedAndFilteredBookmarks.map((bookmark) => {
                const isCurrentActive = Math.abs(currentTime - bookmark.time) < 0.5;
                const bColorObj = bookmarkColors.find(c => c.value === (bookmark.color || 'gray')) || bookmarkColors[0];
                return (
                  <div 
                    key={bookmark.id}
                    onClick={() => openEditBookmark(bookmark)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      handleDragOverBookmark(bookmark.id);
                    }}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-white/5 bg-black/20 hover:bg-white/[0.04] transition-all duration-200 group/item border-l-[5px] relative overflow-hidden cursor-pointer"
                    style={{ 
                      borderColor: isCurrentActive ? `${colors.button}50` : undefined,
                      borderLeftColor: bColorObj.dot,
                      boxShadow: isCurrentActive ? `0 0 10px ${bColorObj.dot}25` : undefined,
                      opacity: draggedId === bookmark.id ? 0.3 : undefined,
                      borderStyle: draggedId === bookmark.id ? 'dashed' : undefined,
                    }}
                  >
                    {/* 拖曳握把 */}
                    <div 
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDraggedId(bookmark.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="cursor-grab active:cursor-grabbing p-1 -ml-1.5 text-white/20 hover:text-white/60 transition-colors flex items-center justify-center relative z-25 flex-shrink-0"
                      title="按住並上下拖曳以排序此書籤"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>

                    {/* 微調：在滑鼠 hover 時於底部顯示極淡的當前顏色漸層 */}
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-24 opacity-0 group-hover/item:opacity-5 transition-opacity duration-300 pointer-events-none bg-gradient-to-r"
                      style={{ 
                        backgroundImage: `linear-gradient(to right, ${bColorObj.dot}, transparent)`
                      }} 
                    />

                    <div className="flex items-center gap-2.5 min-w-0 flex-grow relative z-10">
                      {/* 縮圖（支援截圖或預設美化 fallback） */}
                      <div 
                        className="flex-shrink-0 w-14 h-9 rounded bg-black/40 overflow-hidden border border-white/10 select-none relative group-hover/item:border-white/20 transition-all shadow-sm cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          jumpToAndPlay(bookmark.time);
                        }}
                        title="點擊跳轉並播放"
                      >
                        {bookmark.thumbnail ? (
                          <img 
                            referrerPolicy="no-referrer" 
                            src={bookmark.thumbnail} 
                            alt={bookmark.label} 
                            className="w-full h-full object-cover" 
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-[#7f5af0]/20 to-[#2cb67d]/20 flex items-center justify-center">
                            {bookmark.isShadowing ? (
                              <Mic className="w-3.5 h-3.5 text-[#a78bfa] animate-pulse" />
                            ) : (
                              <Video className="w-3.5 h-3.5 opacity-40 text-white" />
                            )}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/20 group-hover/item:bg-black/0 transition-colors flex items-center justify-center">
                          <Play className="w-3 h-3 text-white opacity-0 group-hover/item:opacity-95 transition-opacity" />
                        </div>
                      </div>

                      <div className="flex flex-col gap-0.5 min-w-0 flex-grow">
                        {/* 描述 */}
                        <span className="text-xs truncate font-semibold" style={{ color: colors.headline }} title={bookmark.label}>
                          {bookmark.label}
                        </span>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* 時間點按鈕 */}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              jumpToAndPlay(bookmark.time);
                            }}
                            title="跳轉到此時間並播放"
                            className="flex-shrink-0 px-2 py-0.5 rounded font-mono text-[10px] font-bold transition-all hover:scale-105 active:scale-95 text-white flex items-center gap-0.5"
                            style={{ backgroundColor: colors.stroke, border: `1px solid ${colors.button}40` }}
                          >
                            <Play className="w-2 h-2 fill-current" />
                            {formatTime(bookmark.time)}
                          </button>

                          {/* 顏色標記（點擊可切換） */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const bColors = ['gray', 'red', 'green', 'blue'] as const;
                              const curIdx = bColors.indexOf(bookmark.color || 'gray');
                              const nextColor = bColors[(curIdx + 1) % bColors.length];
                              setBookmarks(prev => prev.map(b => b.id === bookmark.id ? { ...b, color: nextColor } : b));
                              setSuccessMessage(`已將標記顏色切換為「${bookmarkColors.find(c => c.value === nextColor)?.label}」`);
                              setTimeout(() => setSuccessMessage(''), 1500);
                            }}
                            title="點擊重設或切換顏色標籤"
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border flex items-center gap-1 transition-all hover:scale-105 active:scale-95 cursor-pointer ${bColorObj.bg} ${bColorObj.border} ${bColorObj.text}`}
                          >
                            <span 
                              className={`w-1.5 h-1.5 rounded-full inline-block ${bColorObj.glow}`} 
                              style={{ backgroundColor: bColorObj.dot }} 
                            />
                            <span>{bColorObj.label}</span>
                          </button>

                          {/* 跟讀錄音檔播放控制項 */}
                          {bookmark.isShadowing && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                playShadowAudio(bookmark);
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-black border transition-all hover:scale-105 active:scale-95 flex items-center gap-1 cursor-pointer ${
                                playingShadowId === bookmark.id
                                  ? 'bg-indigo-500/30 border-indigo-500 text-indigo-300'
                                  : 'bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/20 text-indigo-400 font-extrabold shadow-sm animate-pulse'
                              }`}
                              title={playingShadowId === bookmark.id ? "暫停播送跟讀錄音" : "點擊播放您先前錄製的跟讀練習語音"}
                            >
                              {playingShadowId === bookmark.id ? (
                                <>
                                  <Pause className="w-2.5 h-2.5 animate-pulse text-indigo-300" />
                                  <span>播放中 (跟讀記)</span>
                                </>
                              ) : (
                                <>
                                  <Mic className="w-2.5 h-2.5 text-indigo-400" />
                                  <span>播放跟讀筆記</span>
                                </>
                              )}
                            </button>
                          )}

                          {/* 「生成音訊剪輯」功能區 */}
                          {!generatedClips[bookmark.id] ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                generateAudioClip(bookmark);
                              }}
                              disabled={generatingClipIds[bookmark.id]}
                              title="利用 Web Audio API 將此書籤 AB 循環範圍內的聲音提取或渲染出來"
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1 ${
                                generatingClipIds[bookmark.id]
                                  ? 'bg-[#7f5af0]/15 border-[#7f5af0]/30 text-purple-300 pointer-events-none animate-pulse'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 text-emerald-400'
                              }`}
                            >
                              <Scissors className={`w-2.5 h-2.5 ${generatingClipIds[bookmark.id] ? 'animate-spin' : ''}`} />
                              <span>{generatingClipIds[bookmark.id] ? '製作中...' : '生成音訊剪輯'}</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded px-1.5 py-0.5 shadow-md" onClick={(e) => e.stopPropagation()}>
                              {/* 播放/暫停細節 */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  playClip(bookmark.id, generatedClips[bookmark.id].blobUrl);
                                }}
                                className={`text-[9px] font-bold transition-all hover:scale-110 active:scale-90 flex items-center gap-0.5 ${
                                  playingClipId === bookmark.id ? 'text-emerald-400' : 'text-[#7f5af0] hover:text-[#7f5af0]/80'
                                }`}
                                title={playingClipId === bookmark.id ? '暫停播放剪輯' : '播放剪輯'}
                              >
                                {playingClipId === bookmark.id ? (
                                  <Pause className="w-2.5 h-2.5" />
                                ) : (
                                  <Play className="w-2.5 h-2.5 fill-current" />
                                )}
                              </button>

                              {/* 進度直條 */}
                              <div className="w-8 h-1 bg-white/10 rounded-full overflow-hidden select-none">
                                <div 
                                  className="h-full bg-gradient-to-r from-[#7f5af0] to-emerald-400 transition-all duration-100"
                                  style={{ width: `${clipProgress[bookmark.id] || 0}%` }}
                                />
                              </div>

                              {/* 訊號源指示器 */}
                              {generatedClips[bookmark.id].isSynthetic ? (
                                <span 
                                  className="text-amber-400 cursor-help flex items-center" 
                                  title="為跨來源 CORS/YouTube 資源生成的太空模擬合成音。本地音檔則支援原音提取哦！"
                                >
                                  <Sparkles className="w-2.5 h-2.5" />
                                </span>
                              ) : (
                                <span 
                                  className="text-[#2cb67d] cursor-help flex items-center" 
                                  title="100% 精準無損提取原聲音軌！"
                                >
                                  <FileAudio className="w-2.5 h-2.5" />
                                </span>
                              )}

                              {/* 下載連結 */}
                              <a
                                href={generatedClips[bookmark.id].blobUrl}
                                onClick={(e) => e.stopPropagation()}
                                download={`${bookmark.label.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_clip.wav`}
                                className="text-white/60 hover:text-white transition-colors active:scale-90 inline-flex items-center ml-0.5"
                                title="下載 16-bit 無損 WAV 剪輯音檔"
                              >
                                <Download className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 控制動作與刪除 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setPointA(bookmark.time);
                          setSuccessMessage(`起點 A 已設為 ${formatTime(bookmark.time)}`);
                          setTimeout(() => setSuccessMessage(''), 2000);
                        }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/5 hover:bg-white/10 active:scale-95 transition-all"
                        style={{ color: colors.paragraph }}
                      >
                        A
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (pointA !== null && bookmark.time <= pointA) {
                            setError('點 B 必須在點 A 之後');
                            setTimeout(() => setError(''), 3000);
                            return;
                          }
                          setPointB(bookmark.time);
                          setSuccessMessage(`終點 B 已設為 ${formatTime(bookmark.time)}`);
                          setTimeout(() => setSuccessMessage(''), 2000);
                        }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-[#7f5af0]"
                        style={{ color: colors.button }}
                      >
                        B
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditBookmark(bookmark);
                        }}
                        title="編輯書籤內容"
                        className="p-1 rounded text-amber-400 hover:bg-amber-500/10 active:scale-95 transition-colors opacity-60 hover:opacity-100"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBookmark(bookmark.id);
                        }}
                        title="刪除書籤"
                        className="p-1 rounded text-red-400 hover:bg-red-500/10 active:scale-95 transition-colors opacity-60 hover:opacity-100 ml-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-8 border-t border-opacity-5 flex items-start gap-4" style={{ borderColor: colors.paragraph, backgroundColor: colors.background }}>
          <Info className="w-5 h-5 flex-shrink-0 mt-1 opacity-40" />
          <div className="text-xs leading-relaxed opacity-60">
            <p className="font-bold mb-1" style={{ color: colors.headline }}>使用指南</p>
            <ul className="space-y-1">
              <li>• 滑鼠點擊進度條可跳轉，按住 <strong style={{ color: colors.headline }}>A/B 標記</strong> 可直接左右拖動設定範圍。</li>
              <li>• 支援時間輸入 (如 `1:15` 或 `75`) 與<strong style={{ color: colors.headline }}>快速區間</strong> (如 `1:07~1:58`、`1:07-1:58` 或 `~1:58`)；時間旁的 <strong style={{ color: colors.headline }}>+/-</strong> 可微調，<strong style={{ color: colors.button }}>長按可連續增減</strong>。</li>
              <li>• 點擊 <strong style={{ color: colors.headline }}>分享圖示 ( <Share2 className="w-3 h-3 inline" /> )</strong> 可以產生專屬連結，方便傳送給朋友或在不同裝置繼續學習。</li>
              <li>• 使用 <strong style={{ color: colors.headline }}>跟讀語音錄製筆記</strong> 可以透過麥克風隨手錄下您的發音，自動比對並完美綁定在目前進度的書籤，隨時一鍵播放比對您的口音與原音。</li>
            </ul>
          </div>
        </div>
        
        {/* 編輯書籤對話框互動式 Modal */}
        {editingBookmark && (
          <div 
            className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
            onClick={() => setEditingBookmark(null)}
          >
            <div 
              className="bg-[#16161a] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden flex flex-col font-sans text-white text-xs select-none"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 頂部裝飾條（依據選定的邊線顏色） */}
              <div 
                className="h-1.5 w-full transition-all duration-300" 
                style={{ backgroundColor: bookmarkColors.find(c => c.value === editColor)?.dot || '#7f5af0' }}
              />

              {/* 標題 */}
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <BookmarkIcon className="w-4 h-4 text-[#7f5af0] animate-pulse" />
                  <span className="font-bold text-sm text-white/95">編輯書籤備忘區</span>
                </div>
                <button 
                  onClick={() => setEditingBookmark(null)}
                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 主內容表單 */}
              <div className="p-5 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
                {/* 書籤備忘名稱 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">書籤描述 / 字幕標籤</label>
                  <input 
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs text-white outline-none focus:border-[#7f5af0] transition-all font-semibold"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    placeholder="請輸入此書籤的說明..."
                  />
                </div>

                {/* 標記分類 / 顏色選擇 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">學習標記分類</label>
                  <div className="grid grid-cols-4 gap-1.5 mt-0.5">
                    {bookmarkColors.map((c) => (
                      <button
                        key={`edit-color-${c.value}`}
                        type="button"
                        onClick={() => setEditColor(c.value as any)}
                        className={`py-1.5 px-1 rounded-lg border text-[10px] font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                          editColor === c.value
                            ? 'bg-white/5 text-white scale-102 font-heavy'
                            : 'bg-black/20 text-white/40 border-transparent hover:text-white/70'
                        }`}
                        style={{ borderColor: editColor === c.value ? c.dot : 'transparent' }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.dot }} />
                        <span>{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 基準時間 (時間點) */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">書籤基準時間 (秒)</label>
                    <span className="text-[9px] text-[#7f5af0] font-mono">{formatTime(editTime)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input 
                      type="number"
                      step="0.1"
                      min="0"
                      max={duration || undefined}
                      className="flex-grow bg-black/40 border border-white/10 rounded-lg p-2 text-xs text-white outline-none focus:border-[#7f5af0] font-mono font-bold"
                      value={editTime}
                      onChange={(e) => setEditTime(Math.max(0, Number(e.target.value)))}
                    />
                    <button
                      type="button"
                      onClick={() => jumpToAndPlay(editTime)}
                      title="跳轉並播放目前微調時間"
                      className="p-2 rounded bg-white/5 hover:bg-white/10 text-white active:scale-95 transition-all text-[10px] font-bold border border-white/5 flex items-center justify-center"
                    >
                      <Play className="w-3 h-3 text-emerald-400 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTime(Math.round(currentTime * 100) / 100)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#7f5af0]/10 hover:bg-[#7f5af0]/20 border border-[#7f5af0]/30 text-[#a78bfa] text-[10px] font-bold active:scale-95 transition-all"
                    >
                      使用當前時間
                    </button>
                  </div>

                  {/* 精準微調 A 控制器 */}
                  <div className="flex gap-1 items-center mt-1">
                    <button
                      type="button"
                      onClick={() => setEditTime(Math.max(0, editTime - 1))}
                      className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                    >
                      -1秒
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTime(Math.max(0, editTime - 0.1))}
                      className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                    >
                      -0.1秒
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTime(Math.min(duration || 9999, editTime + 0.1))}
                      className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                    >
                      +0.1秒
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTime(Math.min(duration || 9999, editTime + 1))}
                      className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                    >
                      +1秒
                    </button>
                  </div>
                </div>

                {/* 循環 A 點 (pointA) */}
                <div className="flex flex-col gap-1 pb-1 border-b border-white/5">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">AB 循環：起點 A (秒)</label>
                    <span className="text-[9px] text-[#7f5af0] font-mono font-bold">
                      {editPointA !== null ? formatTime(editPointA) : '尚未設定'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input 
                      type="number"
                      placeholder="點 A 未設定 (使用預設起點)"
                      step="0.1"
                      min="0"
                      max={duration || undefined}
                      className="flex-grow bg-black/40 border border-white/10 rounded-lg p-2 text-xs text-white outline-none focus:border-[#7f5af0] font-mono font-bold"
                      value={editPointA === null ? '' : editPointA}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditPointA(val === '' ? null : Math.max(0, Number(val)));
                      }}
                    />
                    {editPointA !== null && (
                      <button
                        type="button"
                        onClick={() => setEditPointA(null)}
                        className="px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-bold border border-red-500/20 transition-all active:scale-95"
                        title="清除起點設定"
                      >
                        清除
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditPointA(Math.round(currentTime * 100) / 100)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-[#2cb67d] text-[10px] font-bold active:scale-95 transition-all"
                    >
                      使用當前時間
                    </button>
                  </div>

                  {editPointA !== null && (
                    <div className="flex gap-1 items-center mt-1">
                      <button
                        type="button"
                        onClick={() => setEditPointA(Math.max(0, editPointA - 1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        -1秒
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPointA(Math.max(0, editPointA - 0.1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        -0.1秒
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPointA(Math.min(duration || 9999, editPointA + 0.1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        +0.1秒
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPointA(Math.min(duration || 9999, editPointA + 1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        +1秒
                      </button>
                    </div>
                  )}
                </div>

                {/* 循環 B 點 (pointB) */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">AB 循環：終點 B (秒)</label>
                    <span className="text-[9px] text-[#7f5af0] font-mono font-bold">
                      {editPointB !== null ? formatTime(editPointB) : '尚未設定'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input 
                      type="number"
                      placeholder="點 B 未設定 (使用預設終點)"
                      step="0.1"
                      min="0"
                      max={duration || undefined}
                      className="flex-grow bg-black/40 border border-white/10 rounded-lg p-2 text-xs text-white outline-none focus:border-[#7f5af0] font-mono font-bold"
                      value={editPointB === null ? '' : editPointB}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditPointB(val === '' ? null : Math.max(0, Number(val)));
                      }}
                    />
                    {editPointB !== null && (
                      <button
                        type="button"
                        onClick={() => setEditPointB(null)}
                        className="px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-bold border border-red-500/20 transition-all active:scale-95"
                        title="清除終點設定"
                      >
                        清除
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditPointB(Math.round(currentTime * 100) / 100)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-[#2cb67d] text-[10px] font-bold active:scale-95 transition-all"
                    >
                      使用當前時間
                    </button>
                  </div>

                  {editPointB !== null && (
                    <div className="flex gap-1 items-center mt-1">
                      <button
                        type="button"
                        onClick={() => setEditPointB(Math.max(0, editPointB - 1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        -1秒
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPointB(Math.max(0, editPointB - 0.1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        -0.1秒
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPointB(Math.min(duration || 9999, editPointB + 0.1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        +0.1秒
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditPointB(Math.min(duration || 9999, editPointB + 1))}
                        className="px-2 py-0.5 bg-white/5 border border-white/5 hover:bg-white/10 rounded text-[9px] font-mono text-white/75"
                      >
                        +1秒
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 底部控制鈕 */}
              <div className="flex items-center justify-between p-4 border-t border-white/5 bg-black/40">
                <button 
                  type="button"
                  onClick={() => {
                    if (confirm(`確認要刪除書籤「${editLabel}」嗎？`)) {
                      deleteBookmark(editingBookmark.id);
                      setEditingBookmark(null);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/20 text-[10px] font-bold transition-colors cursor-pointer"
                >
                  刪除此書籤
                </button>
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => setEditingBookmark(null)}
                    className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 hover:text-white hover:bg-white/5 text-[10px] font-bold transition-all cursor-pointer"
                  >
                    取消
                  </button>
                  <button 
                    type="button"
                    onClick={saveEditedBookmark}
                    className="px-5 py-1.5 rounded-lg bg-[#7f5af0] hover:bg-[#7f5af0]/90 text-white font-heavy text-[11px] flex items-center gap-1 border border-white/10 shadow-lg shadow-[#7f5af0]/15 active:scale-95 transition-all cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>儲存變更</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 分享與嵌入設定對話框互動式 Modal */}
        {showShareModal && (
          <div 
            className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setShowShareModal(false)}
          >
            <div 
              className="bg-[#16161a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col font-sans text-white text-xs select-none"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 頂部色彩視覺裝飾條 */}
              <div className="h-1.5 w-full bg-gradient-to-r from-[#7f5af0] to-[#2cb67d]" />

              {/* 標題欄 */}
              <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/10">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-[#7f5af0]" />
                  <span className="font-bold text-sm text-white/95 text-ellipsis overflow-hidden whitespace-nowrap">網站播放器嵌入與分享設定</span>
                </div>
                <button 
                  onClick={() => setShowShareModal(false)}
                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 主要設定區域 */}
              <div className="p-6 flex flex-col gap-5 max-h-[75vh] overflow-y-auto">
                
                {/* 1. 專屬分享連結區 */}
                <div className="bg-black/30 border border-white/5 rounded-xl p-4 flex flex-col gap-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 flex items-center gap-1">
                      <LinkIcon className="w-3.5 h-3.5 text-indigo-400" />
                      專屬學習分享網址
                    </span>
                    <span className="text-[9px] text-[#2cb67d] font-bold">已自動複製</span>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      readOnly 
                      value={sharingUrl}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-grow bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-[#a78bfa] font-mono font-bold outline-none select-all"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(sharingUrl);
                          setSuccessMessage('🔗 分享連結已成功複製！');
                          setTimeout(() => setSuccessMessage(''), 2000);
                        } catch (err) {
                          alert('無法複製連結，請手動複製學術框。');
                        }
                      }}
                      className="px-3.5 py-2 rounded-lg bg-[#7f5af0]/10 hover:bg-[#7f5af0]/20 border border-[#7f5af0]/30 text-[#a78bfa] text-xs font-bold active:scale-95 transition-all cursor-pointer"
                    >
                      複製
                    </button>
                  </div>
                  <p className="text-[10px] text-white/40 leading-relaxed">
                    本網址完美收納了目前播放的音源、您設定的 A/B 循環區間以及匯入的字幕逐字稿。任何人點開連結，都能重啟相同的學習場景！
                  </p>
                </div>

                {/* 2. 網站嵌入碼 (iFrame) 設定 */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="p-1 rounded bg-[#2cb67d]/10 text-[#2cb67d] flex items-center justify-center">
                      <Video className="w-3.5 h-3.5" />
                    </span>
                    <label className="text-[11px] font-extrabold uppercase tracking-widest text-[#2cb67d]">
                      網頁嵌入碼設定 (iFrame Embed HTML)
                    </label>
                  </div>

                  <p className="text-[10px] text-white/55 leading-relaxed">
                    您可以直接複製以下 HTML 嵌入碼，貼入您自己經營的網站、部落格 (Wordpress、Blogger 等)、或教學系統的 HTML 編輯器。播放器將完全自適應嵌入！
                  </p>

                  {/* 寬高控制面板 */}
                  <div className="grid grid-cols-2 gap-4 bg-black/20 p-3 rounded-xl border border-white/5">
                    <div>
                      <label className="text-[9px] font-bold text-white/40 block mb-1">自訂嵌入寬度</label>
                      <div className="flex gap-1.5">
                        {['100%', '800px', '640px'].map(val => (
                          <button
                            key={`w-${val}`}
                            type="button"
                            onClick={() => setEmbedWidth(val)}
                            className={`flex-grow py-1 rounded text-[10px] font-bold transition-all cursor-pointer border ${
                              embedWidth === val 
                                ? 'bg-white/5 border-[#2cb67d] text-white' 
                                : 'bg-black/40 border-transparent text-white/40 hover:text-white/70'
                            }`}
                          >
                            {val === '100%' ? '滿版 (100%)' : val}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-white/40 block mb-1">自訂嵌入高度</label>
                      <div className="flex gap-1.5">
                        {['700px', '600px', '500px'].map(val => (
                          <button
                            key={`h-${val}`}
                            type="button"
                            onClick={() => setEmbedHeight(val)}
                            className={`flex-grow py-1 rounded text-[10px] font-bold transition-all cursor-pointer border ${
                              embedHeight === val 
                                ? 'bg-white/5 border-[#2cb67d] text-white' 
                                : 'bg-black/40 border-transparent text-white/40 hover:text-white/70'
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 生產 HTML 輸出文字區 */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold text-white/40">HTML 嵌入代碼：</label>
                    <div className="relative">
                      <textarea
                        readOnly
                        rows={4}
                        value={`<iframe src="${sharingUrl}" width="${embedWidth}" height="${embedHeight}" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen style="border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"></iframe>`}
                        className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-[10px] text-emerald-400 font-mono select-all leading-normal outline-none focus:border-[#2cb67d]/50 pr-20 resize-none"
                        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const code = `<iframe src="${sharingUrl}" width="${embedWidth}" height="${embedHeight}" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen style="border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"></iframe>`;
                          try {
                            await navigator.clipboard.writeText(code);
                            setSuccessMessage('📋 HTML 嵌入碼已複製到剪貼簿！');
                            setTimeout(() => setSuccessMessage(''), 2000);
                          } catch (err) {
                            alert('複製失敗，請手動複選嵌入代碼區塊。');
                          }
                        }}
                        className="absolute right-2 bottom-3.5 px-2.5 py-1.5 rounded-lg bg-[#2cb67d] text-black text-[10px] font-black hover:bg-[#2cb67d]/95 active:scale-95 transition-all shadow-md cursor-pointer"
                      >
                        複製代碼
                      </button>
                    </div>
                  </div>
                </div>

                {/* 貼心小幫手卡片 */}
                <div className="flex gap-2.5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/15 text-indigo-200">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-80" />
                  <div className="flex flex-col gap-0.5 leading-normal">
                    <span className="font-bold text-[10px]">創作者 / 發佈者提示：</span>
                    <span className="text-[9px] opacity-75">
                      當您的讀者瀏覽您的網頁時，本款 A/B 循環語言學習播放器將完美在該容器內自適應渲染，並保持完整之互動能力與響應式功能。為獲得最佳閱讀視角，強烈推薦高度設定在 600px 以上。
                    </span>
                  </div>
                </div>

              </div>

              {/* 底部功能鈕 */}
              <div className="flex items-center justify-end p-4 border-t border-white/5 bg-black/40">
                <button 
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="px-6 py-2 rounded-xl bg-[#7f5af0] hover:bg-[#7f5af0]/95 text-white text-xs font-bold active:scale-95 transition-all cursor-pointer"
                >
                  確認完成
                </button>
              </div>
            </div>
          </div>
        )}

        <TranscriptPanel 

          playerRef={playerRef} 
          audioUrl={audioUrl} 
          currentTime={syncTime} 
          initialLines={transcriptLines}
          onLinesChange={setTranscriptLines}
        />
      </div>
    </div>
  );
}
