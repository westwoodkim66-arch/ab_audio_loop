with open("src/App.tsx", "r") as f:
    lines = f.readlines()

new_block = """                        }`} style={{ backgroundColor: colors.button, color: colors.buttonText, borderColor: colors.button }}>
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
"""

new_lines = []
for line in new_block.split('\n'):
    new_lines.append(line + '\n')

lines[2346:2470] = new_lines

with open("src/App.tsx", "w") as f:
    f.writelines(lines)
