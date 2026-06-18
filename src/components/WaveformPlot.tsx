import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Info, Volume2 } from 'lucide-react';

interface WaveformPlotProps {
  audioUrl: string;
  fileName: string;
  uploadedFile: File | null;
  currentTime: number;
  duration: number;
  pointA: number | null;
  pointB: number | null;
  onSeek: (time: number) => void;
  onSetPointA: (time: number) => void;
  onSetPointB: (time: number) => void;
}

export default function WaveformPlot({
  audioUrl,
  fileName,
  uploadedFile,
  currentTime,
  duration,
  pointA,
  pointB,
  onSeek,
  onSetPointA,
  onSetPointB
}: WaveformPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Zoom factor (1.0 = fully zoomed out, showing complete duration)
  const [zoom, setZoom] = useState<number>(1.0);
  // Visible viewport starting offset (0.0 to 1-1/zoom)
  const [scrollOffset, setScrollOffset] = useState<number>(0.0);

  // Drag states for horizontal panning
  const [isPanningWaveform, setIsPanningWaveform] = useState(false);
  const dragStartTime = useRef<number>(0);
  const dragStartOffset = useRef<number>(0);

  // Scrollbar drag states
  const [isDraggingScrollbar, setIsDraggingScrollbar] = useState(false);
  const scrollbarDragStart = useRef<number>(0);
  const scrollbarOffsetStart = useRef<number>(0);

  // Keep a cache of decoded peaks to avoid re-decoding if the same file is selected again
  const peaksCache = useRef<Record<string, number[]>>({});

  // High resolution peak sample array size for zoomed precision
  const largeBarCount = 1200;

  // 1. Decode local audio file when uploadedFile changes
  useEffect(() => {
    if (!uploadedFile) {
      setPeaks([]);
      setZoom(1.0);
      setScrollOffset(0.0);
      return;
    }

    const cacheKey = `${uploadedFile.name}_${uploadedFile.size}_${uploadedFile.lastModified}`;
    if (peaksCache.current[cacheKey]) {
      setPeaks(peaksCache.current[cacheKey]);
      setZoom(1.0);
      setScrollOffset(0.0);
      return;
    }

    let isSubscribed = true;
    setIsDecoding(true);

    const decode = async () => {
      try {
        const arrayBuffer = await uploadedFile.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('Web Audio API not supported in this browser');
        }
        
        const audioCtx = new AudioContextClass();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        if (!isSubscribed) {
          audioCtx.close();
          return;
        }

        const channelData = audioBuffer.getChannelData(0);
        const step = Math.floor(channelData.length / largeBarCount);
        const extractedPeaks: number[] = [];

        for (let i = 0; i < largeBarCount; i++) {
          let maxVal = 0;
          const startIdx = i * step;
          const endIdx = Math.min(startIdx + step, channelData.length);
          
          for (let j = startIdx; j < endIdx; j += Math.max(1, Math.floor(step / 60))) {
            const val = Math.abs(channelData[j]);
            if (val > maxVal) {
              maxVal = val;
            }
          }
          extractedPeaks.push(maxVal);
        }

        // Normalize peaks so the highest is 1.0
        const maxPeak = Math.max(...extractedPeaks, 0.001);
        const normalized = extractedPeaks.map(p => p / maxPeak);

        if (isSubscribed) {
          peaksCache.current[cacheKey] = normalized;
          setPeaks(normalized);
          setIsDecoding(false);
          setZoom(1.0);
          setScrollOffset(0.0);
        }
        audioCtx.close();
      } catch (err) {
        console.warn('Silent local audio decoding error (falling back to generated peaks):', err);
        if (isSubscribed) {
          generateFallbackPeaks();
          setIsDecoding(false);
          setZoom(1.0);
          setScrollOffset(0.0);
        }
      }
    };

    decode();

    return () => {
      isSubscribed = false;
    };
  }, [uploadedFile]);

  // Generate ultra-realistic spoken phrasing waveform
  const generateFallbackPeaks = () => {
    const rawPeaks: number[] = [];
    const seedString = fileName || audioUrl || 'ab_repeat_default_seed';
    let seed = 0;
    for (let i = 0; i < seedString.length; i++) {
      seed += seedString.charCodeAt(i);
    }

    const randomWithSeed = (s: number) => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };

    for (let i = 0; i < largeBarCount; i++) {
      // Create spoken phrasing peaks (vocal burst and pause templates)
      const speechEnvelope = Math.max(0, 0.6 * Math.sin(i * 0.025 + seed) + 0.4 * Math.sin(i * 0.008 - seed * 0.5));
      const microDetail = 0.3 * randomWithSeed(seed + i) + 0.2 * Math.sin(i * 0.3);
      
      let combined = speechEnvelope > 0.15 ? (speechEnvelope * 0.75 + microDetail * 0.25) : 0.03;
      combined = Math.max(0.03, Math.min(0.95, combined + 0.02 * randomWithSeed(seed - i)));
      rawPeaks.push(combined);
    }
    
    setPeaks(rawPeaks);
  };

  // 2. Fallbacks for online URLs (YouTube, etc.) where peaks array is empty
  useEffect(() => {
    if (!uploadedFile && audioUrl) {
      generateFallbackPeaks();
      setZoom(1.0);
      setScrollOffset(0.0);
    }
  }, [audioUrl, uploadedFile, fileName]);

  // Downsample high-resolution peaks to match active 180 bar display representation for viewport
  const visiblePeaks = useMemo(() => {
    if (peaks.length === 0) return [];
    
    const targetBars = 180;
    const result: number[] = [];
    
    const sliceStart = Math.floor(scrollOffset * peaks.length);
    const sliceEnd = Math.min(peaks.length, Math.ceil((scrollOffset + 1 / zoom) * peaks.length));
    const sliceLength = sliceEnd - sliceStart;
    const step = sliceLength / targetBars;

    for (let i = 0; i < targetBars; i++) {
      const idx = Math.floor(sliceStart + i * step);
      const endIdx = Math.min(peaks.length, Math.floor(sliceStart + (i + 1) * step));
      
      let maxVal = 0.03;
      if (endIdx > idx) {
        for (let j = idx; j < endIdx; j++) {
          if (peaks[j] > maxVal) {
            maxVal = peaks[j];
          }
        }
      }
      result.push(maxVal);
    }
    return result;
  }, [peaks, zoom, scrollOffset]);

  // Click / Mouse helper for converting canvas pixel coordinate to absolute seconds
  const getTimeForX = (x: number) => {
    if (duration === 0) return 0;
    const visibleDuration = duration / zoom;
    const visibleStart = scrollOffset * duration;
    return visibleStart + (x / (canvasRef.current?.getBoundingClientRect().width || 1)) * visibleDuration;
  };

  // 3. Wheel event handling with scroll-locking and zoom centered at pointer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // Stop window scrolling
      
      if (duration === 0) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      // Handle shift-key or scroll deltaX to scroll horizontally (panning)
      if (Math.abs(e.deltaX) > 0 || e.shiftKey) {
        const scrollSpeed = 0.003 / zoom;
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        let newScrollOffset = scrollOffset + (delta > 0 ? 1 : -1) * scrollSpeed;
        const maxScrollOffset = 1 - 1 / zoom;
        newScrollOffset = Math.max(0, Math.min(maxScrollOffset, newScrollOffset));
        setScrollOffset(newScrollOffset);
        return;
      }

      // Handle vertical wheel rolling to Zoom centered at mouse pointer coordinate
      const mouseTime = getTimeForX(mouseX);
      const zoomFactor = 1.15;
      let newZoom = zoom;

      if (e.deltaY < 0) {
        // Zoom in
        newZoom = Math.min(30, zoom * zoomFactor);
      } else {
        // Zoom out
        newZoom = Math.max(1, zoom / zoomFactor);
      }

      if (newZoom === zoom) return;

      const newVisibleDuration = duration / newZoom;
      const newVisibleStart = mouseTime - (mouseX / rect.width) * newVisibleDuration;
      let newScrollOffset = newVisibleStart / duration;
      const maxScrollOffset = 1 - 1 / newZoom;
      newScrollOffset = Math.max(0, Math.min(maxScrollOffset, newScrollOffset));

      setZoom(newZoom);
      setScrollOffset(newScrollOffset);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [zoom, scrollOffset, duration]);

  // Track global scrollbar dragging
  useEffect(() => {
    if (!isDraggingScrollbar) return;

    const handleMouseMoveGlobal = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const deltaX = e.clientX - scrollbarDragStart.current;
      const pctMove = deltaX / rect.width;
      
      let newOffset = scrollbarOffsetStart.current + pctMove;
      const maxOffset = 1 - 1 / zoom;
      newOffset = Math.max(0, Math.min(maxOffset, newOffset));
      setScrollOffset(newOffset);
    };

    const handleMouseUpGlobal = () => {
      setIsDraggingScrollbar(false);
    };

    window.addEventListener('mousemove', handleMouseMoveGlobal);
    window.addEventListener('mouseup', handleMouseUpGlobal);
    return () => {
      window.removeEventListener('mousemove', handleMouseMoveGlobal);
      window.removeEventListener('mouseup', handleMouseUpGlobal);
    };
  }, [isDraggingScrollbar, zoom]);

  // Canvases responsive redrawing logic
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    if (peaks.length === 0 || visiblePeaks.length === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '11px sans-serif';
      ctx.fillText(isDecoding ? '正在分析音檔波形...' : '等待音檔載入中...', width / 2, height / 2);
      return;
    }

    const totalBars = visiblePeaks.length;
    const gap = 2;
    const barWidth = (width - (totalBars - 1) * gap) / totalBars;
    const centerY = height / 2;

    const visibleDuration = duration / zoom;
    const visibleStart = scrollOffset * duration;

    // Helper to calculate X-coordinate on the canvas for any given timestamp
    const getXForTime = (time: number | null) => {
      if (time === null || duration === 0) return null;
      const pct = (time - visibleStart) / visibleDuration;
      return pct * width;
    };

    // 1. Render loop overlay region (Point A to Point B)
    const xA = getXForTime(pointA);
    const xB = getXForTime(pointB);

    if (xA !== null && xB !== null) {
      const renderXStart = Math.max(0, Math.min(width, xA));
      const renderXEnd = Math.max(0, Math.min(width, xB));

      if (renderXEnd > renderXStart) {
        ctx.fillStyle = 'rgba(44, 182, 125, 0.08)'; // Tertiary green overlay
        ctx.fillRect(renderXStart, 0, renderXEnd - renderXStart, height);

        ctx.strokeStyle = 'rgba(44, 182, 125, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(renderXStart, 0, renderXEnd - renderXStart, height);
        ctx.setLineDash([]); // Reset
      }
    }

    // 2. Draw vocal peaks soundwave bars
    for (let i = 0; i < totalBars; i++) {
      const val = visiblePeaks[i];
      const barX = i * (barWidth + gap);
      const barHeight = Math.max(4, val * (height - 12));
      const y = centerY - barHeight / 2;

      // Determine absolute audio seconds representing this column
      const barTime = visibleStart + (i / totalBars) * visibleDuration;
      const isPastCurrent = barTime <= currentTime;

      let barColor = 'rgba(255, 255, 255, 0.15)'; // Default unplayed translucent white

      if (pointA !== null && pointB !== null) {
        if (barTime >= pointA && barTime <= pointB) {
          barColor = isPastCurrent 
            ? '#2cb67d' // Played loop path (Emerald Green)
            : 'rgba(44, 182, 125, 0.4)'; // Remaining loop path
        } else {
          barColor = isPastCurrent 
            ? 'rgba(255, 255, 255, 0.35)' 
            : 'rgba(255, 255, 255, 0.1)';
        }
      } else {
        barColor = isPastCurrent 
          ? '#7f5af0' // Primary Purple
          : 'rgba(255, 255, 255, 0.18)';
      }

      ctx.fillStyle = barColor;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(barX, y, barWidth, barHeight, 1.5);
      } else {
        ctx.rect(barX, y, barWidth, barHeight);
      }
      ctx.fill();
    }

    // 3. Draw Point A vertical demarcation line and flag
    if (xA !== null && xA >= 0 && xA <= width) {
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xA, 0);
      ctx.lineTo(xA, height);
      ctx.stroke();

      ctx.fillStyle = '#7f5af0';
      ctx.beginPath();
      ctx.arc(xA, 4, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#7f5af0';
      ctx.font = 'bold 8px sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillText('A', xA, 8);
    }

    // 4. Draw Point B vertical demarcation line and flag
    if (xB !== null && xB >= 0 && xB <= width) {
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xB, 0);
      ctx.lineTo(xB, height);
      ctx.stroke();

      ctx.fillStyle = '#2cb67d';
      ctx.beginPath();
      ctx.arc(xB, 4, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#2cb67d';
      ctx.font = 'bold 8px sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillText('B', xB, 8);
    }

    // 5. Draw Current Playhead indicator vertical tracking line
    const xCurrent = getXForTime(currentTime);
    if (xCurrent !== null && xCurrent >= 0 && xCurrent <= width) {
      ctx.strokeStyle = '#fffffe';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(xCurrent, 0);
      ctx.lineTo(xCurrent, height);
      ctx.stroke();
      ctx.shadowBlur = 0; // Reset shadow

      ctx.fillStyle = '#fffffe';
      ctx.beginPath();
      ctx.arc(xCurrent, centerY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

  }, [visiblePeaks, peaks, currentTime, duration, pointA, pointB, isDecoding, audioUrl, fileName, zoom, scrollOffset]);

  // Click & Drag Scrub helper
  const handleTimelineScrub = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));

    const visibleDuration = duration / zoom;
    const visibleStart = scrollOffset * duration;
    const targetSeconds = visibleStart + percentage * visibleDuration;
    
    onSeek(targetSeconds);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (duration === 0) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left;
    const clickedTime = getTimeForX(clickX);

    // If Shift key is held, or Middle mouse button (button 1) is clicked, perform viewport panning
    if (e.shiftKey || e.button === 1) {
      setIsPanningWaveform(true);
      dragStartTime.current = e.clientX;
      dragStartOffset.current = scrollOffset;
      return;
    }

    if (e.button === 0) {
      // Left click: set point A and seek/navigate playhead
      onSetPointA(clickedTime);
      onSeek(clickedTime);
      setIsScrubbing(true);
    } else if (e.button === 2) {
      // Right click: set point B
      onSetPointB(clickedTime);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    
    const visibleDuration = duration / zoom;
    const visibleStart = scrollOffset * duration;
    const hoverSeconds = visibleStart + percentage * visibleDuration;

    setHoverX(x);
    setHoverTime(hoverSeconds);

    if (isPanningWaveform) {
      const deltaX = e.clientX - dragStartTime.current;
      const pctMove = deltaX / rect.width;
      
      let newOffset = dragStartOffset.current - pctMove;
      const maxOffset = 1 - 1 / zoom;
      newOffset = Math.max(0, Math.min(maxOffset, newOffset));
      setScrollOffset(newOffset);
    } else if (isScrubbing) {
      handleTimelineScrub(e.clientX);
    }
  };

  const handleMouseLeave = () => {
    setIsScrubbing(false);
    setIsPanningWaveform(false);
    setHoverTime(null);
    setHoverX(null);
  };

  const handleMouseUp = () => {
    setIsScrubbing(false);
    setIsPanningWaveform(false);
  };

  const handleScrollbarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingScrollbar(true);
    scrollbarDragStart.current = e.clientX;
    scrollbarOffsetStart.current = scrollOffset;
  };

  const handleZoomChange = (zoomIn: boolean) => {
    if (duration === 0) return;
    const zoomFactor = 1.35;
    let newZoom = zoom;
    if (zoomIn) {
      newZoom = Math.min(30, zoom * zoomFactor);
    } else {
      newZoom = Math.max(1, zoom / zoomFactor);
    }
    
    if (newZoom === zoom) return;

    // Centered around the current viewport center
    const centerPct = scrollOffset + 0.5 / zoom;
    const newVisibleDuration = 1 / newZoom;
    let newScrollOffset = centerPct - 0.5 * newVisibleDuration;
    
    const maxScrollOffset = 1 - newVisibleDuration;
    newScrollOffset = Math.max(0, Math.min(maxScrollOffset, newScrollOffset));

    setZoom(newZoom);
    setScrollOffset(newScrollOffset);
  };

  const handleResetZoom = () => {
    setZoom(1.0);
    setScrollOffset(0.0);
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="flex flex-col gap-3 mt-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs font-semibold opacity-90" style={{ color: '#fffffe' }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7f5af0] animate-pulse"></span>
          <span>智慧音軌波形圖</span>
          {isDecoding && <span className="text-[10px] text-[#7f5af0] animate-pulse">(背景解碼中...)</span>}
        </div>
        
        {/* Zoom adjustment toolbars */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white/5 rounded-lg p-1 border border-white/10">
            <button 
              type="button"
              onClick={() => handleZoomChange(false)}
              disabled={zoom <= 1}
              className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/80 active:scale-95 disabled:opacity-30 disabled:scale-100 disabled:pointer-events-none transition-all flex items-center justify-center font-bold text-[10px] h-5 w-5"
              title="縮小 Zoom Out"
            >
              －
            </button>
            <span className="font-mono text-[10px] text-white/90 min-w-[36px] text-center">
              {zoom.toFixed(1)}x
            </span>
            <button 
              type="button"
              onClick={() => handleZoomChange(true)}
              disabled={zoom >= 30}
              className="p-1 rounded bg-white/5 hover:bg-white/10 text-white/80 active:scale-95 disabled:opacity-30 disabled:scale-100 disabled:pointer-events-none transition-all flex items-center justify-center font-bold text-[10px] h-5 w-5"
              title="放大 Zoom In"
            >
              ＋
            </button>
            {zoom > 1 && (
              <button 
                type="button"
                onClick={handleResetZoom}
                className="px-1.5 py-0.5 rounded text-[9px] bg-[#7f5af0]/20 hover:bg-[#7f5af0]/40 border border-[#7f5af0]/30 transition-all text-[#fffffe] hover:scale-105 active:scale-95"
              >
                自適應
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Waveform container */}
      <div 
        ref={containerRef}
        className="relative h-24 rounded-xl border border-white/5 bg-black/40 overflow-hidden cursor-crosshair select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{ borderColor: 'rgba(255, 255, 255, 0.05)' }}
      >
        <canvas 
          ref={canvasRef} 
          className="w-full h-full block" 
        />

        {/* Floating Tooltip during Hover */}
        {hoverX !== null && hoverTime !== null && duration > 0 && (
          <div 
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-30 transition-shadow"
            style={{ 
              left: `${Math.max(10, Math.min(hoverX, (containerRef.current?.getBoundingClientRect().width || 0) - 130))}px`,
            }}
          >
            <div className="bg-black/90 border border-[#7f5af0]/40 px-2.5 py-1.5 rounded-lg shadow-xl text-center flex flex-col gap-0.5 max-w-[130px]">
              <span className="font-mono text-[10px] font-extrabold text-[#7f5af0]">
                {formatSeconds(hoverTime)}
              </span>
              <span className="text-[8px] text-white/50 whitespace-nowrap">
                左鍵設 A，右鍵設 B
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Navigational scrollbar tracker (only displayed during zoomed states) */}
      {zoom > 1 && duration > 0 && (
        <div className="flex flex-col gap-1 px-1">
          <div className="relative h-2.5 rounded bg-black/60 border border-white/5 overflow-hidden">
            <div 
              className="absolute top-0 bottom-0 rounded bg-[#7f5af0]/35 border border-[#7f5af0]/60 cursor-grab active:cursor-grabbing hover:bg-[#7f5af0]/45 transition-colors"
              style={{
                left: `${scrollOffset * 100}%`,
                width: `${(1 / zoom) * 100}%`
              }}
              onMouseDown={handleScrollbarMouseDown}
            />
          </div>
          <div className="flex justify-between text-[8px] opacity-40 font-mono">
            <span>開始: {formatSeconds(scrollOffset * duration)}</span>
            <span>可拖曳滑桿來微調顯示範圍</span>
            <span>結束: {formatSeconds((scrollOffset + 1 / zoom) * duration)}</span>
          </div>
        </div>
      )}

      {/* A/B Quick Setter Tools beneath track */}
      {duration > 0 && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-1.5 text-[11px] opacity-75">
          <div className="flex items-center gap-3">
            <div className="text-[10px] uppercase font-bold tracking-widest opacity-50">滑鼠輔助標記：</div>
            {hoverTime !== null ? (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <button 
                  type="button"
                  onClick={() => onSetPointA(hoverTime)}
                  className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#7f5af0]/15 hover:bg-[#7f5af0]/30 transition-all text-[#a78bfa] border border-[#7f5af0]/20 active:scale-95"
                >
                  設 A 點於 {formatSeconds(hoverTime)}
                </button>
                <button 
                  type="button"
                  onClick={() => onSetPointB(hoverTime)}
                  className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#2cb67d]/15 hover:bg-[#2cb67d]/30 transition-all text-[#6ee7b7] border border-[#2cb67d]/20 active:scale-95"
                >
                  設 B 點於 {formatSeconds(hoverTime)}
                </button>
              </div>
            ) : (
              <span className="text-[11px] opacity-40 italic">將滑鼠游標停在波形圖上以快速標記 A/B 點</span>
            )}
          </div>
          
          <div className="flex items-center gap-1 opacity-55 text-[10px]">
            <Info className="w-3 h-3" />
            <span>左鍵點擊設 A 點並定位，右鍵點擊設 B 點。旋轉滾輪來放大/縮小，按住 Shift 鍵拖曳可平移視角</span>
          </div>
        </div>
      )}
    </div>
  );
}
