/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Keyboard, Play, Pause, RotateCcw, SkipBack, SkipForward, Settings2, Trash2, Volume2, Link as LinkIcon, Info, Upload, FileAudio, FileText, Share2, Minus, Plus, Bookmark as BookmarkIcon, Tag, Search, Video, Sparkles } from 'lucide-react';
import ReactPlayer from 'react-player';
import LZString from 'lz-string';

import TranscriptPanel, { SubtitleLine } from './components/TranscriptPanel';
import { DailymotionPlayer } from './DailymotionPlayer';

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
    { value: 'gray', label: '預設', bg: 'bg-white/10', border: 'border-white/20', text: 'text-white/80', dot: '#ffffff' },
    { value: 'red', label: '待加強', bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', dot: '#ef4444' },
    { value: 'green', label: '已掌握', bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', dot: '#2cb67d' },
    { value: 'blue', label: '生字區', bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', dot: '#3d8bff' },
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
      color: selectedColorForNewBookmark
    };
    setBookmarks(prev => [...prev, newB].sort((a, b) => a.time - b.time));
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
      setSuccessMessage('🔗 連結已成功複製到剪貼簿！');
    } catch (err) {
      setSuccessMessage('🔗 連結產生成功，但無法自動複製！');
    }
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
            <div className={`mb-3 overflow-hidden transition-all duration-500 border rounded-lg ${isVideo ? 'shadow-md h-auto opacity-100 max-h-32 md:max-h-48' : 'h-1 opacity-0 pointer-events-none mb-0 border-none m-0'}`} style={{ borderColor: colors.stroke }}>
              <div className="relative aspect-video w-full h-full max-h-32 md:max-h-48 object-contain bg-black flex justify-center">
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
              <div className="flex items-center gap-4">
                <button onClick={togglePlay} className="flex-shrink-0 aspect-square w-12 h-12 rounded-full flex items-center justify-center hover:scale-105 active:scale-90 transition-all shadow-md" style={{ backgroundColor: colors.button, color: colors.buttonText }}>
                   {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
                </button>
                
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
                      className="relative w-full h-3 cursor-pointer overflow-hidden shadow-inner group-hover/bar:h-4 transition-all rounded-full" 
                      style={{ backgroundColor: colors.stroke }}
                    >
                      {/* 預覽條 */}
                      {previewTime !== null && (
                        <div 
                          className="absolute top-0 left-0 h-full opacity-20 pointer-events-none transition-all duration-75" 
                          style={{ width: `${(previewTime / duration) * 100}%`, backgroundColor: colors.button }} 
                        />
                      )}
                      {/* 當前進度 */}
                      <div className="absolute top-0 left-0 h-full opacity-40 transition-all pointer-events-none" style={{ width: `${(currentTime / duration) * 100}%`, backgroundColor: colors.button }} />
                      {/* AB 區間填充 */}
                      {pointA !== null && pointB !== null && (
                        <div className="absolute top-0 h-full opacity-40" style={{ left: `${(pointA / duration) * 100}%`, width: `${((pointB - pointA) / duration) * 100}%`, backgroundColor: colors.tertiary }} />
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
                        className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center -translate-x-1/2 cursor-ew-resize z-30 group select-none touch-none w-11 h-11" 
                        style={{ left: `${(pointA / duration) * 100}%` }}
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingMarker('A'); }}
                        onTouchStart={(e) => { e.stopPropagation(); setDraggingMarker('A'); }}
                      >
                        {/* Large invisible hit area visual cue */}
                        <div className="absolute inset-0 rounded-full bg-[#7f5af0]/0 group-hover:bg-[#7f5af0]/5 group-active:bg-[#7f5af0]/15 transition-all duration-200 pointer-events-none scale-75" />
                        
                        <div className={`text-[9px] px-1.5 py-0.5 font-bold shadow-md transition-all border rounded-sm relative z-10 ${draggingMarker === 'A' ? 'scale-125' : 'group-hover:scale-110'}`} style={{ backgroundColor: colors.background, color: colors.headline, borderColor: colors.headline }}>
                          {draggingMarker === 'A' ? formatTime(pointA) : 'A'}
                        </div>
                      </div>
                    )}
                    {pointB !== null && (
                      <div 
                        className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center -translate-x-1/2 cursor-ew-resize z-30 group select-none touch-none w-11 h-11" 
                        style={{ left: `${(pointB / duration) * 100}%` }}
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingMarker('B'); }}
                        onTouchStart={(e) => { e.stopPropagation(); setDraggingMarker('B'); }}
                      >
                        {/* Large invisible hit area visual cue */}
                        <div className="absolute inset-0 rounded-full bg-[#2cb67d]/0 group-hover:bg-[#2cb67d]/5 group-active:bg-[#2cb67d]/15 transition-all duration-200 pointer-events-none scale-75" />
                        
                        <div className={`text-[9px] px-1.5 py-0.5 font-bold shadow-md transition-all border rounded-sm relative z-10 ${draggingMarker === 'B' ? 'scale-125' : 'group-hover:scale-110'}`} style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.button }}>
                          {draggingMarker === 'B' ? formatTime(pointB) : 'B'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Compact Speed, Sync & Volume */}
                <div className="hidden md:flex flex-shrink-0 flex-col items-end gap-1 px-1">
                    <div className="flex items-center gap-4 h-full">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">速度</span>
                        <div className="flex bg-white/5 rounded px-1 py-0.5 mr-1">
                          <button onClick={() => setPlaybackRate(v => Math.max(0.1, v - 0.1))} className="px-1.5 hover:bg-white/10 rounded text-xs">-</button>
                          <span className="text-xs font-mono font-bold w-6 text-center">{playbackRate.toFixed(1)}</span>
                          <button onClick={() => setPlaybackRate(v => Math.min(3.0, v + 0.1))} className="px-1.5 hover:bg-white/10 rounded text-xs">+</button>
                        </div>
                        {/* 預設播放速度切換 */}
                        <div className="flex gap-1">
                          {[0.5, 0.75, 1.0].map((rate) => {
                            const isSelected = Math.abs(playbackRate - rate) < 0.01;
                            return (
                              <button
                                key={rate}
                                onClick={() => setPlaybackRate(rate)}
                                className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-all hover:scale-105 active:scale-95 ${
                                  isSelected 
                                    ? 'text-white font-black' 
                                    : 'text-white/60 hover:text-white/90 bg-white/5 hover:bg-white/10'
                                }`}
                                style={isSelected ? { backgroundColor: colors.button } : undefined}
                                title={`${rate}x 快速練習語速`}
                              >
                                {rate.toFixed(1) === '1.0' ? '1.0' : rate.toString()}x
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 字幕微調控制項 (桌機版) */}
                      <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-50" title="調整字幕與聲音的相對延遲。若高亮太慢，請增加秒數；若太快，請減少秒數。">字幕同步</span>
                        <div className="flex bg-white/5 rounded px-1 py-0.5">
                          <button onClick={() => setSubtitleOffset(o => Math.max(-2.0, Math.round((o - 0.05) * 20) / 20))} className="px-1 py-0.5 hover:bg-white/10 rounded text-[10px] font-mono font-bold" title="提前字幕">-0.05s</button>
                          <span className="text-[11px] font-mono font-bold w-14 text-center" style={{ color: subtitleOffset === 0 ? colors.paragraph : subtitleOffset > 0 ? '#2cb67d' : '#ef4444' }}>
                            {subtitleOffset >= 0 ? `+${subtitleOffset.toFixed(2)}` : subtitleOffset.toFixed(2)}s
                          </span>
                          <button onClick={() => setSubtitleOffset(o => Math.min(2.0, Math.round((o + 0.05) * 20) / 20))} className="px-1 py-0.5 hover:bg-white/10 rounded text-[10px] font-mono font-bold" title="延後字幕">+0.05s</button>
                        </div>
                        <button onClick={() => setSubtitleOffset(0.15)} className="text-[9px] bg-white/10 hover:bg-white/20 px-1 py-0.5 rounded text-white/70 hover:text-white" title="重設為預設最佳值 (0.15s)">重設</button>
                      </div>

                      <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
                        <Volume2 className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
                        <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-16 h-1 appearance-none cursor-pointer accent-[#7f5af0] flex-shrink-0" style={{ backgroundColor: colors.stroke }} />
                      </div>
                    </div>
                </div>
              </div>

              {/* Mobile-only Speed, Sync & Volume Controls */}
              <div className="flex md:hidden flex-col gap-2 bg-white/5 rounded-lg px-2.5 py-2 border border-white/5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">速度</span>
                    <div className="flex bg-white/5 rounded px-1 py-0.5 mr-0.5">
                      <button onClick={() => setPlaybackRate(v => Math.max(0.1, v - 0.1))} className="px-1.5 py-0.5 hover:bg-white/10 rounded text-[11px] font-bold">-</button>
                      <span className="text-xs font-mono font-bold w-6 text-center leading-normal">{playbackRate.toFixed(1)}</span>
                      <button onClick={() => setPlaybackRate(v => Math.min(3.0, v + 0.1))} className="px-1.5 py-0.5 hover:bg-white/10 rounded text-[11px] font-bold">+</button>
                    </div>
                    
                    {/* Preset rates */}
                    <div className="flex gap-1">
                      {[0.5, 0.75, 1.0].map((rate) => {
                        const isSelected = Math.abs(playbackRate - rate) < 0.01;
                        return (
                          <button
                            key={rate}
                            onClick={() => setPlaybackRate(rate)}
                            className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-all active:scale-95 ${
                              isSelected 
                                ? 'text-white font-black' 
                                : 'text-white/60 hover:text-white/90 bg-white/5'
                            }`}
                            style={isSelected ? { backgroundColor: colors.button } : undefined}
                          >
                            {rate.toFixed(1) === '1.0' ? '1.0' : rate.toString()}x
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
                    <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-16 h-1 appearance-none cursor-pointer accent-[#7f5af0] flex-shrink-0" style={{ backgroundColor: colors.stroke }} />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/5 pt-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">字幕同步</span>
                  <div className="flex items-center gap-1.5">
                    <div className="flex bg-white/5 rounded px-1 py-0.5">
                      <button onClick={() => setSubtitleOffset(o => Math.max(-2.0, Math.round((o - 0.05) * 20) / 20))} className="px-1.5 py-0.5 hover:bg-white/10 rounded text-[11px] font-bold">-0.05s</button>
                      <span className="text-xs font-mono font-bold w-14 text-center leading-loose" style={{ color: subtitleOffset === 0 ? colors.paragraph : subtitleOffset > 0 ? '#2cb67d' : '#ef4444' }}>
                        {subtitleOffset >= 0 ? `+${subtitleOffset.toFixed(2)}` : subtitleOffset.toFixed(2)}s
                      </span>
                      <button onClick={() => setSubtitleOffset(o => Math.min(2.0, Math.round((o + 0.05) * 20) / 20))} className="px-1.5 py-0.5 hover:bg-white/10 rounded text-[11px] font-bold">+0.05s</button>
                    </div>
                    <button onClick={() => setSubtitleOffset(0.15)} className="text-[10px] bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded text-white/70 hover:text-white">重設</button>
                  </div>
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
                          color: selectedColorForNewBookmark
                        };
                        setBookmarks(prev => [...prev, newB].sort((a, b) => a.time - b.time));
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
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white/5 rounded-lg px-3 py-3 md:py-2 border border-white/5">
                
                {/* A & B Group */}
                <div className="flex flex-wrap items-center gap-2 md:gap-4 w-full sm:w-auto">
                  {/* Point A Input */}
                  <div className="flex items-center justify-between sm:justify-start gap-1.5 bg-black/40 rounded px-2 py-1.5 sm:px-1.5 sm:py-1 border border-white/10 w-full sm:w-auto">
                    <span className="text-[10px] sm:hidden font-black opacity-50 ml-1">起點 A</span>
                    <span className="text-[10px] hidden sm:inline font-black opacity-50">A</span>
                    <div className="flex items-center gap-1.5">
                      <button {...getHoldHandlers('A', -0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Minus className="w-3 h-3 opacity-70" /></button>
                      <input type="text" value={inputA} onChange={(e) => setInputA(e.target.value)} onBlur={applyInputA} onKeyDown={(e) => e.key === 'Enter' && applyInputA()} placeholder="00:00" className="w-14 text-center font-mono text-[11px] bg-transparent outline-none" />
                      <button {...getHoldHandlers('A', 0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Plus className="w-3 h-3 opacity-70" /></button>
                      <button onClick={setA} className="ml-1 text-[11px] sm:text-[10px] bg-white/10 hover:bg-white/20 rounded px-2 py-1 sm:px-1.5 sm:py-0.5 transition-colors">設為當前</button>
                    </div>
                  </div>

                  {/* Point B Input */}
                  <div className="flex items-center justify-between sm:justify-start gap-1.5 bg-[#7f5af0]/10 sm:bg-black/40 rounded px-2 py-1.5 sm:px-1.5 sm:py-1 border border-[#7f5af0]/30 sm:border-white/10 w-full sm:w-auto mt-1 sm:mt-0">
                    <span className="text-[10px] sm:hidden font-black ml-1" style={{ color: colors.button }}>終點 B</span>
                    <span className="text-[10px] hidden sm:inline font-black" style={{ color: colors.button }}>B</span>
                    <div className="flex items-center gap-1.5">
                      <button {...getHoldHandlers('B', -0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Minus className="w-3 h-3 opacity-70" /></button>
                      <input type="text" value={inputB} onChange={(e) => setInputB(e.target.value)} onBlur={applyInputB} onKeyDown={(e) => e.key === 'Enter' && applyInputB()} placeholder="00:00" className="w-14 text-center font-mono text-[11px] bg-transparent outline-none" style={{ color: colors.button }} />
                      <button {...getHoldHandlers('B', 0.1)} className="hover:bg-white/20 rounded p-1 sm:p-0.5"><Plus className="w-3 h-3 opacity-70" /></button>
                      <button onClick={setB} className="ml-1 text-[11px] sm:text-[10px] rounded px-2 py-1 sm:px-1.5 sm:py-0.5 transition-colors" style={{ backgroundColor: colors.button, color: colors.buttonText }}>設為當前</button>
                    </div>
                  </div>
                </div>

                {/* Range, Repeat, and Actions Group */}
                <div className="flex flex-row flex-wrap items-center justify-between sm:justify-end gap-3 sm:gap-4 flex-grow w-full sm:w-auto mt-1 sm:mt-0">
                  <div className="flex items-center gap-1.5 bg-black/40 rounded px-2 py-1.5 sm:px-2 sm:py-1 border border-white/10 flex-grow sm:flex-grow-0 justify-center">
                    <span className="text-[11px] sm:text-[10px] font-black opacity-50 whitespace-nowrap">快速區間</span>
                    <input type="text" value={rangeInput} onChange={(e) => setRangeInput(e.target.value)} onBlur={applyRange} onKeyDown={(e) => e.key === 'Enter' && applyRange()} placeholder="A~B" className="w-14 text-center font-mono text-[11px] bg-transparent outline-none border-b border-white/20 focus:border-white/50 transition-colors pb-0" />
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={isRepeatEnabled} onChange={(e) => setIsRepeatEnabled(e.target.checked)} className="w-4 h-4 sm:w-3 sm:h-3 accent-[#7f5af0]" />
                    <span className={`text-sm sm:text-xs font-bold ${isRepeatEnabled ? 'text-white' : 'opacity-50'}`}>循環</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer" title="自動循環增強：超出 B 點時極短淡出再跳回 A 點，聽力練習流暢不刺耳">
                    <input type="checkbox" checked={isLoopFadeEnabled} onChange={(e) => setIsLoopFadeEnabled(e.target.checked)} className="w-4 h-4 sm:w-3 sm:h-3 accent-[#7f5af0]" />
                    <span className={`text-sm sm:text-xs font-bold ${isLoopFadeEnabled ? 'text-white' : 'opacity-50'}`}>淡出循環</span>
                  </label>

                  <div className="flex items-center justify-end gap-1.5 sm:border-l sm:border-white/10 sm:pl-3 ml-auto sm:ml-0">
                    <button onClick={clearAB} title="清除標記" className="p-2 sm:p-1.5 hover:bg-white/10 rounded transition-colors text-red-400 group flex items-center justify-center bg-black/20 sm:bg-transparent"><Trash2 className="w-4 h-4 opacity-70 group-hover:opacity-100" /></button>
                    <button onClick={handleShare} title="產生分享連結" className="p-2 sm:p-1.5 hover:bg-white/10 rounded transition-colors group flex items-center justify-center bg-black/20 sm:bg-transparent"><Share2 className="w-4 h-4 opacity-70 group-hover:opacity-100" /></button>
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

            {/* 搜尋過濾 */}
            <div className="relative w-full md:w-64">
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
          </div>

          {/* 書籤分類過濾面板 */}
          {bookmarks.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-2 bg-black/10 border border-white/5 rounded-xl text-xs">
              <div className="flex items-center gap-2">
                <span className="opacity-40 font-bold tracking-wider uppercase text-[10px]">顏色篩選：</span>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setBookmarkColorFilter('all')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      bookmarkColorFilter === 'all'
                        ? 'bg-white/10 border border-white/20 text-white'
                        : 'opacity-40 hover:opacity-100 text-white/60'
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
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all flex items-center gap-1 border ${
                          bookmarkColorFilter === c.value
                            ? `${c.bg} ${c.border} ${c.text}`
                            : 'bg-transparent border-transparent opacity-40 hover:opacity-100 text-white/60'
                        }`}
                      >
                        <span className="w-1 h-1 rounded-full inline-block" style={{ backgroundColor: c.dot }} />
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
          )}

          {/* 書籤列表 */}
          {bookmarks.length === 0 ? (
            <div className="py-6 text-center rounded-xl border border-dashed border-white/5 text-xs opacity-50 flex flex-col items-center gap-1">
              <BookmarkIcon className="w-6 h-6 opacity-30 mb-1" />
              <span>尚未建立任何書籤。</span>
              <span>您可以在上方文字框輸入備忘描述，然後點擊「新增當前時間」按鈕。</span>
            </div>
          ) : filteredBookmarks.length === 0 ? (
            <div className="py-6 text-center text-xs opacity-50">
              找不到符合「{bookmarkSearchQuery}」與篩選條件的書籤。
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1 font-sans">
              {filteredBookmarks.map((bookmark) => {
                const isCurrentActive = Math.abs(currentTime - bookmark.time) < 0.5;
                const bColorObj = bookmarkColors.find(c => c.value === (bookmark.color || 'gray')) || bookmarkColors[0];
                return (
                  <div 
                    key={bookmark.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-white/5 bg-black/20 hover:bg-white/[0.03] transition-all duration-200 group/item border-l-4"
                    style={{ 
                      borderColor: isCurrentActive ? `${colors.button}40` : undefined,
                      borderLeftColor: bColorObj.dot
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-grow">
                      {/* 縮圖（支援截圖或預設美化 fallback） */}
                      <div 
                        className="flex-shrink-0 w-14 h-9 rounded bg-black/40 overflow-hidden border border-white/10 select-none relative group-hover/item:border-white/20 transition-all shadow-sm cursor-pointer"
                        onClick={() => jumpToAndPlay(bookmark.time)}
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
                            <Video className="w-3.5 h-3.5 opacity-40 text-white" />
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
                            onClick={() => jumpToAndPlay(bookmark.time)}
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
                            onClick={() => {
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
                            <span className="w-1 h-1 rounded-full inline-block" style={{ backgroundColor: bColorObj.dot }} />
                            <span>{bColorObj.label}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 控制動作與刪除 */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button 
                        onClick={() => {
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
                        onClick={() => {
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
                        onClick={() => deleteBookmark(bookmark.id)}
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
            </ul>
          </div>
        </div>
        
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
