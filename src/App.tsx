/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Settings2, Trash2, Volume2, Link as LinkIcon, Info, Upload, FileAudio, Share2, Minus, Plus } from 'lucide-react';

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
  const [pointA, setPointA] = useState<number | null>(null);
  const [pointB, setPointB] = useState<number | null>(null);
  const [inputA, setInputA] = useState('');
  const [inputB, setInputB] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  const [isRepeatEnabled, setIsRepeatEnabled] = useState(true);
  const [error, setError] = useState('');
  const [draggingMarker, setDraggingMarker] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 用來在長按 interval 中取得最新狀態，避免閉包問題
  const stateRef = useRef({ pointA, pointB, currentTime, duration, isRepeatEnabled });
  useEffect(() => {
    stateRef.current = { pointA, pointB, currentTime, duration, isRepeatEnabled };
  }, [pointA, pointB, currentTime, duration, isRepeatEnabled]);

  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const holdInterval = useRef<NodeJS.Timeout | null>(null);

  // 初始化：檢查網址參數是否有分享進來的設定
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    const aParam = params.get('a');
    const bParam = params.get('b');

    if (urlParam) {
      setAudioUrl(urlParam);
      
      const setupAutoPlay = () => {
        if (!audioRef.current) return;
        
        const startA = aParam ? parseFloat(aParam) : 0;
        
        const onCanPlay = () => {
          if (audioRef.current) {
            audioRef.current.currentTime = startA;
            audioRef.current.play()
              .then(() => setIsPlaying(true))
              .catch((e) => console.warn('自動播放受瀏覽器限制，請點擊播放：', e));
          }
        };

        // 同時監聽多個事件以確保在不同瀏覽器都能觸發
        audioRef.current.addEventListener('canplay', onCanPlay, { once: true });
        audioRef.current.addEventListener('loadedmetadata', onCanPlay, { once: true });
        audioRef.current.load();
      };

      // 稍微延遲確保 audioRef 已綁定
      setTimeout(setupAutoPlay, 300);
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
      setTimeout(() => {
        if (audioRef.current) audioRef.current.load();
      }, 0);
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
    if (targetA !== null && audioRef.current) {
      audioRef.current.currentTime = targetA;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
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
    const audio = audioRef.current;
    if (!audio) return;
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (isRepeatEnabled && pointA !== null && pointB !== null) {
        if (audio.currentTime >= pointB) {
          audio.currentTime = pointA;
          if (!isPlaying) audio.play().then(() => setIsPlaying(true)).catch(() => {});
        }
      }
    };
    const handleLoadedMetadata = () => { setDuration(audio.duration); setError(''); };
    const handleError = () => { 
      setError('音檔載入失敗，請確認網址正確且為有效連結。'); 
      setIsPlaying(false); 
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
    };
  }, [pointA, pointB, isRepeatEnabled, isPlaying]);

  const togglePlay = () => {
    if (isPlaying) { 
      audioRef.current?.pause(); 
      setIsPlaying(false); 
    } else {
      if (!audioUrl) return;
      audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const handleSeek = (e: React.MouseEvent) => {
    if (!progressBarRef.current || !audioRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 1);
    const newTime = percent * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

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
      if (audioRef.current) audioRef.current.currentTime = newA;
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
      if (audioRef.current) audioRef.current.currentTime = newB;
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

  const skip = (amount: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime += amount;
    }
  };

  const handleShare = async () => {
    if (!audioUrl) {
      setError('目前沒有可分享的音檔。');
      setTimeout(() => setError(''), 3000);
      return;
    }
    if (audioUrl.startsWith('blob:')) {
      setError('本機上傳的音檔無法透過連結分享，請使用「音檔來源網址」載入網路檔案。');
      setTimeout(() => setError(''), 4500);
      return;
    }
    const params = new URLSearchParams();
    params.set('url', audioUrl);
    if (pointA !== null) params.set('a', pointA.toFixed(2));
    if (pointB !== null) params.set('b', pointB.toFixed(2));
    const longUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    
    setShareMessage('正在產生短網址...');
    
    let finalUrl = longUrl;
    try {
      // 使用 is.gd 產生短網址
      const response = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}`);
      const data = await response.json();
      if (data.shorturl) finalUrl = data.shorturl;
    } catch (err) {
      console.warn('短網址產生失敗，改用原始網址');
    }

    const textArea = document.createElement("textarea");
    textArea.value = finalUrl;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      setShareMessage('短網址已複製到剪貼簿！');
      setTimeout(() => setShareMessage(''), 4000);
    } catch (err) {
      setError('複製失敗，請手動複製網址。');
      setTimeout(() => setError(''), 3000);
    }
    document.body.removeChild(textArea);
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 font-sans relative" style={{ backgroundColor: colors.background, color: colors.paragraph }}>
      
      {shareMessage && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 px-6 py-4 border shadow-2xl font-bold z-50 transition-all flex items-center gap-3 animate-bounce" style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.stroke }}>
          <Share2 className="w-5 h-5" />
          {shareMessage}
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
                <input type="text" placeholder="輸入音檔連結..." className="w-full pl-12 pr-4 py-4 outline-none focus:ring-2 transition-all border-none" style={{ backgroundColor: 'transparent', color: colors.headline }} value={audioUrl} onChange={(e) => { setAudioUrl(e.target.value); setFileName(''); }} />
              </div>
              <button 
                onClick={() => { 
                  if(audioRef.current) {
                    audioRef.current.load();
                    setSuccessMessage('音檔網址載入成功！');
                    setTimeout(() => setSuccessMessage(''), 3000);
                  }
                }} 
                className="px-8 py-4 font-black transition-all hover:opacity-90 active:scale-95 whitespace-nowrap uppercase tracking-widest text-xs border" 
                style={{ backgroundColor: 'transparent', color: colors.headline, borderColor: colors.headline }}
              >
                載入網址
              </button>
            </div>
            {error && <div className="mt-1 text-red-400 text-sm flex items-center gap-2 px-2"><Info className="w-4 h-4 flex-shrink-0" /> {error}</div>}
          </div>

          <audio ref={audioRef} src={audioUrl || undefined} preload="auto" hidden />

          <div className="p-8 mb-10 border shadow-inner" style={{ backgroundColor: colors.background, borderColor: colors.stroke }}>
            <div className="flex justify-between items-end mb-6">
              <div>
                <span className="text-5xl font-mono font-bold tracking-tighter" style={{ color: colors.headline }}>{formatTime(currentTime)}</span>
                <span className="font-mono ml-3 text-xl opacity-40">/ {formatTime(duration)}</span>
              </div>
              <div className="flex items-center gap-3">
                <Volume2 className="w-5 h-5 opacity-50" />
                <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => { const v = parseFloat(e.target.value); setVolume(v); if(audioRef.current) audioRef.current.volume = v; }} className="w-24 h-1 appearance-none cursor-pointer accent-[#7f5af0]" style={{ backgroundColor: colors.stroke }} />
              </div>
            </div>

            <div className="relative h-16 flex items-center">
              <div ref={progressBarRef} onClick={handleSeek} className="relative w-full h-4 cursor-pointer overflow-hidden shadow-inner" style={{ backgroundColor: colors.stroke }}>
                <div className="absolute top-0 left-0 h-full opacity-30 transition-all" style={{ width: `${(currentTime / duration) * 100}%`, backgroundColor: colors.button }} />
                {pointA !== null && pointB !== null && (
                  <div className="absolute top-0 h-full opacity-40" style={{ left: `${(pointA / duration) * 100}%`, width: `${((pointB - pointA) / duration) * 100}%`, backgroundColor: colors.tertiary }} />
                )}
              </div>
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
            <div className="flex items-center justify-center gap-10">
              <button onClick={() => skip(-5)} className="p-4 transition-all hover:scale-110 active:scale-95" style={{ color: colors.paragraph }}><SkipBack className="w-8 h-8" /></button>
              <button onClick={togglePlay} className="w-24 h-24 border flex items-center justify-center hover:scale-105 active:scale-90 transition-all font-bold" style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.stroke }}>{isPlaying ? <Pause className="w-10 h-10 fill-current" /> : <Play className="w-10 h-10 fill-current ml-1" />}</button>
              <button onClick={() => skip(5)} className="p-4 transition-all hover:scale-110 active:scale-95" style={{ color: colors.paragraph }}><SkipForward className="w-8 h-8" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-50 px-2">起點 A</span>
                  <div className="flex items-center w-full overflow-hidden touch-none border" style={{ backgroundColor: 'transparent', color: colors.headline, borderColor: colors.stroke }}>
                    <button {...getHoldHandlers('A', -0.1)} className="p-3 hover:bg-white hover:bg-opacity-10 active:bg-opacity-20 transition-all focus:outline-none select-none"><Minus className="w-4 h-4 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                    <input type="text" value={inputA} onChange={(e) => setInputA(e.target.value)} onBlur={applyInputA} onKeyDown={(e) => e.key === 'Enter' && applyInputA()} placeholder="00:00" className="w-full text-center font-mono text-lg font-bold py-3 border-none outline-none bg-transparent min-w-0 px-0" />
                    <button {...getHoldHandlers('A', 0.1)} className="p-3 hover:bg-white hover:bg-opacity-10 active:bg-opacity-20 transition-all focus:outline-none select-none"><Plus className="w-4 h-4 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                  </div>
                  <button onClick={setA} className="py-2 text-xs font-bold transition-all hover:bg-opacity-80 border" style={{ borderColor: colors.stroke, color: colors.headline }}>📍 抓取當前</button>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-50 px-2">終點 B</span>
                  <div className="flex items-center w-full overflow-hidden touch-none border" style={{ backgroundColor: colors.background, color: colors.headline, borderColor: colors.stroke }}>
                    <button {...getHoldHandlers('B', -0.1)} className="p-3 hover:bg-white hover:bg-opacity-10 active:bg-opacity-20 transition-all focus:outline-none select-none"><Minus className="w-4 h-4 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                    <input type="text" value={inputB} onChange={(e) => setInputB(e.target.value)} onBlur={applyInputB} onKeyDown={(e) => e.key === 'Enter' && applyInputB()} placeholder="00:00" className="w-full text-center font-mono text-lg font-bold py-3 border-none outline-none bg-transparent min-w-0 px-0" />
                    <button {...getHoldHandlers('B', 0.1)} className="p-3 hover:bg-white hover:bg-opacity-10 active:bg-opacity-20 transition-all focus:outline-none select-none"><Plus className="w-4 h-4 opacity-70 hover:opacity-100 pointer-events-none" /></button>
                  </div>
                  <button onClick={setB} className="py-2 text-xs font-bold transition-all hover:bg-opacity-80 border" style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.stroke }}>📍 抓取當前</button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex gap-3 h-full items-end">
                  <button onClick={() => setIsRepeatEnabled(!isRepeatEnabled)} className={`flex-grow py-3 font-bold transition-all border ${isRepeatEnabled ? '' : 'opacity-40'}`} style={{ backgroundColor: isRepeatEnabled ? colors.button : 'transparent', color: isRepeatEnabled ? colors.buttonText : colors.paragraph, borderColor: colors.button }}>重複播放: {isRepeatEnabled ? 'ON' : 'OFF'}</button>
                  <button onClick={clearAB} title="清除標記" className="p-3 transition-all border hover:bg-red-900 hover:bg-opacity-20" style={{ borderColor: colors.stroke, color: colors.headline }}><Trash2 className="w-6 h-6" /></button>
                  <button onClick={handleShare} title="產生分享連結" className="p-3 transition-all border hover:bg-opacity-20 hover:bg-white" style={{ borderColor: colors.stroke, color: colors.headline }}><Share2 className="w-6 h-6" /></button>
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
      </div>
    </div>
  );
}
