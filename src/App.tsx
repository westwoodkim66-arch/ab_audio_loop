/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Settings2, Trash2, Volume2, Link as LinkIcon, Info, Upload, FileAudio, Share2, Minus, Plus } from 'lucide-react';
import ReactPlayer from 'react-player';

import TranscriptPanel from './components/TranscriptPanel';

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

  const [audioUrl, setAudioUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [pointA, setPointA] = useState<number | null>(null);
  const [pointB, setPointB] = useState<number | null>(null);
  const [inputA, setInputA] = useState('');
  const [inputB, setInputB] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  const [isRepeatEnabled, setIsRepeatEnabled] = useState(true);
  const [error, setError] = useState('');
  const lastLoadedUrl = useRef('');
  const [draggingMarker, setDraggingMarker] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [shareData, setShareData] = useState<{isOpen: boolean, url: string, status: 'idle' | 'loading' | 'success'} | null>(null);
  const [successMessage, setSuccessMessage] = useState('');

  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [isHoveringBar, setIsHoveringBar] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const playerRef = useRef<any>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isVideo = useMemo(() => {
    if (!audioUrl) return false;
    return audioUrl.includes('youtube.com') || 
           audioUrl.includes('youtu.be') || 
           audioUrl.includes('vimeo.com') ||
           audioUrl.includes('dailymotion.com') ||
           audioUrl.includes('twitch.tv') ||
           audioUrl.includes('facebook.com') ||
           audioUrl.includes('.mp4');
  }, [audioUrl]);

  // 用來在長按 interval 或鍵盤監聽中取得最新狀態，避免閉包問題
  const stateRef = useRef({ pointA, pointB, currentTime, duration, isRepeatEnabled, audioUrl, isPlaying, volume });
  useEffect(() => {
    stateRef.current = { pointA, pointB, currentTime, duration, isRepeatEnabled, audioUrl, isPlaying, volume };
  }, [pointA, pointB, currentTime, duration, isRepeatEnabled, audioUrl, isPlaying, volume]);

  // 鍵盤快捷鍵處理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果正在輸入框、或是按下組合鍵（如 Ctrl+S），則不觸發
      const activeElement = document.activeElement;
      const isInput = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || (activeElement as HTMLElement).isContentEditable);
      if (isInput) return;

      const { audioUrl: currentUrl, currentTime: currentPos, volume: currentVolume } = stateRef.current;

      if (e.code === 'Space') {
        // 空白鍵：暫停/播放
        if (!currentUrl) return;
        e.preventDefault();
        setIsPlaying(prev => !prev);
      } else if (e.code === 'ArrowLeft') {
        // 左鍵：倒退 5 秒
        e.preventDefault();
        if (playerRef.current) {
          playerRef.current.seekTo(currentPos - 5, 'seconds');
        }
      } else if (e.code === 'ArrowRight') {
        // 右鍵：快轉 5 秒
        e.preventDefault();
        if (playerRef.current) {
          playerRef.current.seekTo(currentPos + 5, 'seconds');
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

  // 初始化：檢查網址參數是否有分享進來的設定
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    
    // 支援原本的 url 參數，和更短的 u 參數
    let urlParam = searchParams.get('url') || hashParams.get('url') || searchParams.get('u') || hashParams.get('u');
    
    // 獨立平台極致縮短支援
    const vParam = searchParams.get('v') || hashParams.get('v');     // YouTube
    const vmParam = searchParams.get('vm') || hashParams.get('vm');  // Vimeo
    
    if (vParam) {
      urlParam = `https://www.youtube.com/watch?v=${vParam}`;
    } else if (vmParam) {
      urlParam = `https://vimeo.com/${vmParam}`;
    }

    const aParam = searchParams.get('a') || hashParams.get('a');
    const bParam = searchParams.get('b') || hashParams.get('b');

    if (urlParam) {
      setAudioUrl(urlParam);
      setIsPlaying(true); // 分享連結進來後嘗試自動播放
    }
    if (aParam !== null && !isNaN(parseFloat(aParam))) setPointA(parseFloat(aParam));
    if (bParam !== null && !isNaN(parseFloat(bParam))) setPointB(parseFloat(bParam));
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

  const handleFile = (file: File) => {
    if (file) {
      const isValidAudio = file.type.startsWith('audio/') || /\.(m4a|aac|mp3|wav|ogg|flac)$/i.test(file.name);
      if (!isValidAudio) {
        setError('請上傳有效的音檔格式 (支援 MP3, WAV, M4A, AAC 等)');
        return;
      }
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setFileName(file.name);
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

  const startPlaybackAtA = (targetA: number) => {
    if (targetA !== null && playerRef.current) {
      playerRef.current.seekTo(targetA, 'seconds');
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (!draggingMarker || !progressBarRef.current || duration === 0) return;
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
    };
    const handleEnd = () => {
      if (draggingMarker && pointA !== null && pointB !== null && isRepeatEnabled) {
        startPlaybackAtA(pointA);
      }
      setDraggingMarker(null);
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
    if (isRepeatEnabled && pointA !== null && pointB !== null && currentTime >= pointB) {
      startPlaybackAtA(pointA);
    }
  }, [currentTime, pointA, pointB, isRepeatEnabled]);

  const togglePlay = () => {
    if (!audioUrl) return;
    if (!isPlaying) {
      // 解決部分內嵌瀏覽器 (如 Line) 除非手動改變音量否則沒有聲音的問題
      setTimeout(() => setVolume(v => v >= 1 ? 0.99 : v + 0.01), 50);
      // 同步觸發底層播放器，避免 React 狀態更新延遲導致 iOS/Line 判定非使用者主動操作
      const internal = playerRef.current?.getInternalPlayer();
      if (internal) {
        if (typeof internal.playVideo === 'function') internal.playVideo();
        else if (typeof internal.play === 'function') internal.play().catch(() => {});
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
    if (pointB !== null && isRepeatEnabled) startPlaybackAtA(currentTime); 
  };

  const setB = () => {
    if (pointA !== null && currentTime <= pointA) {
      setError('點 B 必須在點 A 之後');
      setTimeout(() => setError(''), 3000);
      return;
    }
    setPointB(currentTime);
    if (pointA !== null && isRepeatEnabled) startPlaybackAtA(pointA);
  };

  const applyInputA = () => {
    const parsed = parseTimeInput(inputA);
    if (parsed !== null && !isNaN(parsed)) {
      const finalA = duration ? Math.min(parsed, duration) : parsed;
      setPointA(finalA);
      if (pointB !== null && isRepeatEnabled) startPlaybackAtA(finalA);
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
      if (pointA !== null && isRepeatEnabled) startPlaybackAtA(pointA);
    }
  };

  const applyRange = () => {
    const parts = rangeInput.split(/[-~]/);
    if (parts.length === 2) {
      const start = parseTimeInput(parts[0].trim());
      const end = parseTimeInput(parts[1].trim());
      if (start !== null && end !== null && start < end) {
        setPointA(start); 
        setPointB(end);
        if (isRepeatEnabled) startPlaybackAtA(start);
      }
    }
  };

  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
  };

  const adjustAInner = (delta: number) => {
    setPointA(prevA => {
      const { pointB: pB, currentTime: cT } = stateRef.current;
      let current = prevA !== null ? prevA : cT;
      let newA = current + delta;
      newA = Math.max(0, newA);
      newA = Math.round(newA * 10) / 10;
      if (pB !== null && newA >= pB) newA = Math.max(0, pB - 0.1);
      playerRef.current?.seekTo(newA, 'seconds');
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
      playerRef.current?.seekTo(newB, 'seconds');
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

  const handleHoldEnd = () => {
    stopHold();
    const { pointA: pA, isRepeatEnabled: rep } = stateRef.current;
    if (pA !== null && rep) {
      startPlaybackAtA(pA);
    }
  };

  const getHoldHandlers = (type: string, delta: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      handleHold(type, delta);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      handleHoldEnd();
    },
    onPointerCancel: (e: React.PointerEvent) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      stopHold();
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
      setShareData({ isOpen: true, url: '', status: 'idle' });
      // Temporary toast replacement:
      alert("❌ 目前沒有可分享的音檔。");
      setShareData(null);
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
    
    if (ytMatch && ytMatch[1]) {
      // YouTube 只留 v=ID
      params.set('v', ytMatch[1]);
    } else if (vmMatch && vmMatch[1]) {
      // Vimeo 只留 vm=ID
      params.set('vm', vmMatch[1]);
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

    // 直接顯示分享連結（不依賴後端 API 也就是實作純前端的「假短網址」）
    setShareData({ isOpen: true, url: finalUrl, status: 'success' });
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
      setShareData(null);
    } else {
      alert("❌ 複製失敗，請手動長按選取網址。");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 font-sans relative" style={{ backgroundColor: colors.background, color: colors.paragraph }}>
      
      {shareData?.isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 mobile-touch-none">
          <div className="max-w-md w-full rounded-2xl border aspect-video flex flex-col justify-center items-center shadow-2xl relative" style={{ backgroundColor: colors.background, borderColor: colors.stroke }}>
            <button onClick={() => setShareData(null)} className="absolute top-4 right-4 opacity-50 hover:opacity-100 transition-opacity">✕</button>
            {shareData.status === 'loading' ? (
              <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: `${colors.button}40`, borderTopColor: colors.button }}></div>
                <h3 className="text-lg font-bold" style={{ color: colors.headline }}>正在產生短網址...</h3>
                <p className="text-sm mt-2 opacity-60" style={{ color: colors.paragraph }}>請稍候片刻</p>
              </div>
            ) : (
              <div className="flex flex-col items-center px-6 w-full animate-in fade-in zoom-in duration-300">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2" style={{ color: colors.headline }}>🔗 分享連結已產生！</h3>
                
                <div className="w-full bg-black/40 border border-white/10 rounded-lg p-3 overflow-hidden">
                  <div className="w-full font-mono text-sm break-all select-all text-center leading-relaxed" style={{ color: colors.paragraph }}>
                    {shareData.url}
                  </div>
                </div>

                <div className="flex w-full gap-3 mt-6">
                  {navigator.share && (
                    <button 
                      onClick={() => {
                        navigator.share({ title: 'A-B Loop 分享', url: shareData.url })
                        .then(() => setShareData(null))
                        .catch(() => {});
                      }}
                      className="flex-1 py-4 rounded-xl flex items-center justify-center gap-2 font-black transition-all hover:scale-105 active:scale-95"
                      style={{ backgroundColor: colors.tertiary, color: colors.background }}
                    >
                      <span>💌</span> 傳送朋友
                    </button>
                  )}
                  <button 
                    onClick={() => copyToClipboard(shareData.url)}
                    className="flex-1 py-4 rounded-xl flex items-center justify-center gap-2 font-black transition-all hover:scale-105 active:scale-95"
                    style={{ backgroundColor: colors.button, color: colors.buttonText }}
                  >
                    <span>📋</span> 點擊複製
                  </button>
                </div>
                <p className="text-xs text-center opacity-40 mt-4" style={{ color: colors.paragraph }}>如遇到無法產生短網址的狀況，我們已為您準備好安全的長網址，請直接複製或分享即可。</p>
              </div>
            )}
          </div>
        </div>
      )}

      {successMessage && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 px-6 py-4 border shadow-2xl font-bold z-50 transition-all flex items-center gap-3 animate-in fade-in slide-in-from-top-4" style={{ backgroundColor: colors.tertiary, color: colors.background, borderColor: colors.stroke }}>
          <FileAudio className="w-5 h-5" />
          {successMessage}
        </div>
      )}

      <div className="max-w-3xl w-full overflow-hidden shadow-2xl border" style={{ borderColor: colors.stroke, backgroundColor: colors.background }}>
        
        <div className="p-10 text-center border-b border-opacity-5" style={{ borderColor: colors.paragraph }}>
          <h1 className="text-4xl font-bold mb-3 flex items-center justify-center gap-3" style={{ color: colors.headline }}>
            <RotateCcw className="w-10 h-10" />
            AB Repeat 點讀助手
          </h1>
          <p className="text-lg opacity-90" style={{ color: colors.paragraph }}>精準控制 • 反覆練習 • 輕鬆分享</p>
        </div>

        <div className="p-8 md:p-12">
          <div className="mb-10 flex flex-col gap-4">
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
              <p className="font-bold mb-1" style={{ color: colors.headline }}>點擊或拖曳音檔至此處</p>
              <p className="text-xs opacity-60 mb-3" style={{ color: colors.paragraph }}>支援 MP3, WAV, M4A, AAC 等格式</p>
              {fileName && (
                <div className="flex items-center gap-2 px-3 py-1.5 border mt-2" style={{ backgroundColor: colors.background, borderColor: colors.stroke }}>
                  <FileAudio className="w-4 h-4" style={{ color: colors.button }} />
                  <span className="text-sm font-mono truncate max-w-[200px] md:max-w-[300px]" style={{ color: colors.headline }}>{fileName}</span>
                </div>
              )}
              <input type="file" ref={fileInputRef} className="hidden" accept="audio/*,.m4a,.aac" onChange={(e) => { if(e.target.files && e.target.files[0]) handleFile(e.target.files[0]); }} />
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
                  placeholder="輸入音檔或 YouTube 連結..." 
                  className="w-full pl-12 pr-4 py-4 outline-none focus:ring-2 transition-all border-none" 
                  style={{ backgroundColor: 'transparent', color: colors.headline }} 
                  value={audioUrl} 
                  onChange={(e) => { 
                    setAudioUrl(e.target.value); 
                    setFileName(''); 
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

          <div className={`mb-10 overflow-hidden transition-all duration-500 border ${isVideo ? 'shadow-2xl h-auto opacity-100' : 'h-1 opacity-0 pointer-events-none mb-0 border-none m-0'}`} style={{ borderColor: colors.stroke }}>
            <div className="aspect-video w-full">
               <Player
                 ref={playerRef}
                 url={audioUrl}
                 playing={isPlaying}
                 volume={volume}
                 playbackRate={playbackRate}
                 loop={isRepeatEnabled && pointA === null && pointB === null}
                 onPlay={() => setIsPlaying(true)}
                 onPause={() => setIsPlaying(false)}
                 onEnded={() => {
                   if (isRepeatEnabled) {
                     if (pointA !== null) {
                       startPlaybackAtA(pointA);
                     } else {
                       startPlaybackAtA(0);
                     }
                   } else {
                     setIsPlaying(false);
                   }
                 }}
                 onProgress={(state: any) => {
                   setCurrentTime(state.playedSeconds);
                 }}
                 onDuration={(dur: number) => setDuration(dur)}
                 onReady={() => {
                   // 防止重複觸發成功的提示
                   if (lastLoadedUrl.current === audioUrl) return;
                   lastLoadedUrl.current = audioUrl;

                   const searchParams = new URLSearchParams(window.location.search);
                   const hashParams = new URLSearchParams(window.location.hash.slice(1));
                   const aParam = searchParams.get('a') || hashParams.get('a');
                   if (aParam && playerRef.current) {
                     playerRef.current.seekTo(parseFloat(aParam), 'seconds');
                   }
                   setError(''); // 載入成功則清除錯誤
                   setSuccessMessage(isVideo ? '影片載入成功！' : '音檔載入成功！');
                   setTimeout(() => setSuccessMessage(''), 3000);
                 }}
                 onError={() => {
                   // 如果是 YouTube 等影片來源且網址為空，不報錯
                   if (!audioUrl) return;
                   setError('載入失敗，可能原因：連結無效、該網站禁止嵌入、或 CORS 權限限制。');
                   setSuccessMessage('');
                 }}
                 width="100%"
                 height="100%"
                 playsinline={true}
                 style={{ backgroundColor: '#000' }}
                 config={{
                   file: { attributes: { playsInline: true, webkitplaysinline: "true" } },
                   youtube: { playerVars: { origin: window.location.origin, autoplay: 1, playsinline: 1 } },
                   vimeo: { playerOptions: { playsinline: true, autoplay: true } }
                 } as any}
               />
            </div>
          </div>

          <div className="p-8 mb-10 border shadow-inner" style={{ backgroundColor: colors.background, borderColor: colors.stroke }}>
            <div className="flex flex-wrap justify-between items-end gap-x-4 gap-y-4 mb-6">
              <div>
                <span className="text-4xl sm:text-5xl font-mono font-bold tracking-tighter" style={{ color: colors.headline }}>{formatTime(currentTime)}</span>
                <span className="font-mono ml-2 sm:ml-3 text-lg sm:text-xl opacity-40">/ {formatTime(duration)}</span>
              </div>
              <div className="hidden sm:flex items-center gap-6">
                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold uppercase tracking-widest opacity-60">速度</span>
                    <button onClick={() => setPlaybackRate(v => Math.max(0.1, v - 0.1))} className="p-1 hover:bg-white/10 rounded">-</button>
                    <span className="text-sm font-mono font-bold">{playbackRate.toFixed(1)}x</span>
                    <button onClick={() => setPlaybackRate(v => Math.min(3.0, v + 0.1))} className="p-1 hover:bg-white/10 rounded">+</button>
                </div>
                <div className="flex items-center gap-3">
                  <Volume2 className="w-5 h-5 opacity-50 flex-shrink-0" />
                  <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-24 sm:w-28 h-1 appearance-none cursor-pointer accent-[#7f5af0] flex-shrink-0" style={{ backgroundColor: colors.stroke }} />
                </div>
              </div>
            </div>

            <div className="relative h-20 flex items-center">
              <div 
                ref={progressBarRef} 
                onMouseDown={onProgressMouseDown}
                onTouchStart={onProgressMouseDown}
                onMouseMove={onProgressMouseMove}
                onTouchMove={onProgressMouseMove}
                onMouseEnter={() => setIsHoveringBar(true)}
                onMouseLeave={() => { if (!isScrubbing) { setIsHoveringBar(false); setPreviewTime(null); } }}
                className="relative w-full h-8 cursor-pointer overflow-hidden shadow-inner group/bar rounded-full" 
                style={{ backgroundColor: colors.stroke }}
              >
                {/* 預覽條 (滑鼠移入或按住時顯示) */}
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
                  <div className="absolute top-0 h-full opacity-30" style={{ left: `${(pointA / duration) * 100}%`, width: `${((pointB - pointA) / duration) * 100}%`, backgroundColor: colors.tertiary }} />
                )}
              </div>

              {/* 預覽時間標籤 (懸浮) */}
              {(isHoveringBar || isScrubbing) && previewTime !== null && (
                <div 
                  className={`absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none px-2 py-1 text-[10px] font-mono font-bold shadow-xl border z-50 animate-in fade-in zoom-in-95 duration-200 ${isScrubbing ? 'scale-110' : ''}`}
                  style={{ left: `${(previewTime / duration) * 100}%`, backgroundColor: isScrubbing ? colors.button : colors.background, color: colors.headline, borderColor: isScrubbing ? colors.headline : colors.stroke }}
                >
                  {formatTime(previewTime)}
                </div>
              )}
              {pointA !== null && (
                <div 
                  className="absolute top-0 flex flex-col items-center -translate-x-1/2 cursor-ew-resize z-30 group select-none touch-none" 
                  style={{ left: `${(pointA / duration) * 100}%` }}
                  onMouseDown={(e) => { e.stopPropagation(); setDraggingMarker('A'); }}
                  onTouchStart={(e) => { e.stopPropagation(); setDraggingMarker('A'); }}
                >
                  <div className={`text-[10px] px-2 py-0.5 font-bold shadow-lg mb-1 transition-all border ${draggingMarker === 'A' ? 'scale-125 -translate-y-2' : 'group-hover:scale-125'}`} style={{ backgroundColor: colors.background, color: colors.headline, borderColor: colors.headline }}>
                    {draggingMarker === 'A' ? formatTime(pointA) : 'A'}
                  </div>
                  <div className="w-0.5 h-16" style={{ backgroundColor: colors.headline }}></div>
                </div>
              )}
              {pointB !== null && (
                <div 
                  className="absolute top-0 flex flex-col items-center -translate-x-1/2 cursor-ew-resize z-30 group select-none touch-none" 
                  style={{ left: `${(pointB / duration) * 100}%` }}
                  onMouseDown={(e) => { e.stopPropagation(); setDraggingMarker('B'); }}
                  onTouchStart={(e) => { e.stopPropagation(); setDraggingMarker('B'); }}
                >
                  <div className={`text-[10px] px-2 py-0.5 font-bold shadow-lg mb-1 transition-all border ${draggingMarker === 'B' ? 'scale-125 -translate-y-2' : 'group-hover:scale-125'}`} style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.button }}>
                    {draggingMarker === 'B' ? formatTime(pointB) : 'B'}
                  </div>
                  <div className="w-0.5 h-16" style={{ backgroundColor: colors.button }}></div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-8">
            <div className="flex items-center justify-center gap-6 sm:gap-10">
              <button onClick={() => skip(-5)} className="p-4 transition-all hover:scale-110 active:scale-95 flex-shrink-0" style={{ color: colors.paragraph }}><SkipBack className="w-8 h-8" /></button>
              <button onClick={togglePlay} className="flex-shrink-0 aspect-square w-24 h-24 sm:w-28 sm:h-28 border flex items-center justify-center hover:scale-105 active:scale-90 transition-all font-bold" style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.stroke }}>{isPlaying ? <Pause className="w-10 h-10 fill-current" /> : <Play className="w-10 h-10 fill-current ml-1" />}</button>
              <button onClick={() => skip(5)} className="p-4 transition-all hover:scale-110 active:scale-95 flex-shrink-0" style={{ color: colors.paragraph }}><SkipForward className="w-8 h-8" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-50 px-2">起點 A</span>
                  <div className="flex items-center w-full overflow-hidden touch-none border" style={{ backgroundColor: 'transparent', color: colors.headline, borderColor: colors.stroke }}>
                    <button {...getHoldHandlers('A', -0.1)} className="p-2 sm:p-3 hover:bg-white/10 active:bg-white/20 transition-all focus:outline-none select-none flex-shrink-0"><Minus className="w-4 h-4 sm:w-5 sm:h-5 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                    <input type="text" value={inputA} onChange={(e) => setInputA(e.target.value)} onBlur={applyInputA} onKeyDown={(e) => e.key === 'Enter' && applyInputA()} placeholder="00:00" className="flex-1 w-0 text-center font-mono text-sm sm:text-base md:text-lg font-bold py-3 border-none outline-none bg-transparent px-0" />
                    <button {...getHoldHandlers('A', 0.1)} className="p-2 sm:p-3 hover:bg-white/10 active:bg-white/20 transition-all focus:outline-none select-none flex-shrink-0"><Plus className="w-4 h-4 sm:w-5 sm:h-5 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                  </div>
                  <button onClick={setA} className="py-2 text-xs font-bold transition-all hover:opacity-80 border" style={{ borderColor: colors.stroke, color: colors.headline }}>📍 抓取當前</button>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-50 px-2">終點 B</span>
                  <div className="flex items-center w-full overflow-hidden touch-none border" style={{ backgroundColor: colors.background, color: colors.headline, borderColor: colors.stroke }}>
                    <button {...getHoldHandlers('B', -0.1)} className="p-2 sm:p-3 hover:bg-white/10 active:bg-white/20 transition-all focus:outline-none select-none flex-shrink-0"><Minus className="w-4 h-4 sm:w-5 sm:h-5 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                    <input type="text" value={inputB} onChange={(e) => setInputB(e.target.value)} onBlur={applyInputB} onKeyDown={(e) => e.key === 'Enter' && applyInputB()} placeholder="00:00" className="flex-1 w-0 text-center font-mono text-sm sm:text-base md:text-lg font-bold py-3 border-none outline-none bg-transparent px-0" />
                    <button {...getHoldHandlers('B', 0.1)} className="p-2 sm:p-3 hover:bg-white/10 active:bg-white/20 transition-all focus:outline-none select-none flex-shrink-0"><Plus className="w-4 h-4 sm:w-5 sm:h-5 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                  </div>
                  <button onClick={setB} className="py-2 text-xs font-bold transition-all hover:opacity-80 border" style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.stroke }}>📍 抓取當前</button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex gap-3 h-full items-end">
                  <button onClick={() => setIsRepeatEnabled(!isRepeatEnabled)} className={`flex-grow py-3 font-bold transition-all border ${isRepeatEnabled ? '' : 'opacity-40'}`} style={{ backgroundColor: isRepeatEnabled ? colors.button : 'transparent', color: isRepeatEnabled ? colors.buttonText : colors.paragraph, borderColor: colors.button }}>重複播放: {isRepeatEnabled ? 'ON' : 'OFF'}</button>
                  <button onClick={clearAB} title="清除標記" className="p-3 transition-all border hover:bg-red-900/40 hover:text-red-400" style={{ borderColor: colors.stroke, color: colors.headline }}><Trash2 className="w-6 h-6" /></button>
                  <button onClick={handleShare} title="產生分享連結" className="p-3 transition-all border hover:bg-white/20" style={{ borderColor: colors.stroke, color: colors.headline }}><Share2 className="w-6 h-6" /></button>
                </div>
                <div className="flex gap-2 items-center p-2 border" style={{ backgroundColor: 'transparent', borderColor: colors.stroke }}>
                   <span className="text-[10px] font-black uppercase tracking-widest opacity-60 px-2 whitespace-nowrap" style={{ color: colors.headline }}>快速區間:</span>
                   <input type="text" value={rangeInput} onChange={(e) => setRangeInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyRange()} placeholder="1:19~2:16" className="w-full bg-transparent border-none outline-none font-mono text-sm" style={{ color: colors.headline }} />
                   <button onClick={applyRange} className="px-4 py-1.5 text-xs font-black whitespace-nowrap border" style={{ backgroundColor: colors.tertiary, color: colors.background, borderColor: colors.stroke }}>套用</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 border-t border-opacity-5 flex items-start gap-4" style={{ borderColor: colors.paragraph, backgroundColor: colors.background }}>
          <Info className="w-5 h-5 flex-shrink-0 mt-1 opacity-40" />
          <div className="text-xs leading-relaxed opacity-60">
            <p className="font-bold mb-1" style={{ color: colors.headline }}>使用指南</p>
            <ul className="space-y-1">
              <li>• 滑鼠點擊進度條可跳轉，按住 <strong style={{ color: colors.headline }}>A/B 標記</strong> 可直接左右拖動設定範圍。</li>
              <li>• 支援快速格式輸入，例如輸入 `1:15` 或 `75` (秒)；點擊時間旁的 <strong style={{ color: colors.headline }}>+/-</strong> 可微調 0.1 秒，<strong style={{ color: colors.button }}>長按可連續增減</strong>。</li>
              <li>• 點擊 <strong style={{ color: colors.headline }}>分享圖示 ( <Share2 className="w-3 h-3 inline" /> )</strong> 可以產生專屬連結，方便傳送給朋友或在不同裝置繼續學習。</li>
            </ul>
          </div>
        </div>
        
        <TranscriptPanel playerRef={playerRef} audioUrl={audioUrl} currentTime={currentTime} />
      </div>
    </div>
  );
}
