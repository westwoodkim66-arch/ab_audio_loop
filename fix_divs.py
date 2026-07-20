import sys

with open("src/App.tsx", "r") as f:
    lines = f.readlines()

new_content = """              {/* Bottom Row: A/B Controls */}
              <div className="flex flex-col xl:flex-row items-center justify-between gap-3 bg-[#1a1a1a] rounded-xl p-3 border border-white/5 shadow-sm">
                  
                {/* Point A Input */}
                <div className="flex items-center justify-between gap-2 bg-black/60 rounded-md px-2.5 py-1.5 border border-white/5 w-full xl:w-auto flex-1 xl:flex-none">
                  <span className="text-xs font-black opacity-60 ml-1">A</span>
                  <div className="flex items-center gap-1.5">
                    <button {...getHoldHandlers('A', -0.1)} className="hover:bg-white/20 rounded p-1"><Minus className="w-3.5 h-3.5 opacity-60" /></button>
                    <input type="text" value={inputA} onChange={(e) => setInputA(e.target.value)} onBlur={applyInputA} onKeyDown={(e) => e.key === 'Enter' && applyInputA()} placeholder="00:00" className="w-16 text-center font-mono text-[13px] bg-transparent outline-none" style={{ color: '#8cb1e3' }} />
                    <button {...getHoldHandlers('A', 0.1)} className="hover:bg-white/20 rounded p-1"><Plus className="w-3.5 h-3.5 opacity-60" /></button>
                    <button onClick={setA} className="ml-1 text-[11px] bg-white/10 hover:bg-white/20 rounded px-2.5 py-1 transition-colors whitespace-nowrap opacity-70 font-medium">設為當前</button>
                  </div>
                </div>

                {/* Point B Input */}
                <div className="flex items-center justify-between gap-2 bg-black/60 rounded-md px-2.5 py-1.5 border border-white/5 w-full xl:w-auto flex-1 xl:flex-none">
                  <span className="text-xs font-black ml-1" style={{ color: colors.button }}>B</span>
                  <div className="flex items-center gap-1.5">
                    <button {...getHoldHandlers('B', -0.1)} className="hover:bg-white/20 rounded p-1"><Minus className="w-3.5 h-3.5 opacity-60" /></button>
                    <input type="text" value={inputB} onChange={(e) => setInputB(e.target.value)} onBlur={applyInputB} onKeyDown={(e) => e.key === 'Enter' && applyInputB()} placeholder="00:00" className="w-16 text-center font-mono text-[13px] bg-transparent outline-none" style={{ color: colors.button }} />
                    <button {...getHoldHandlers('B', 0.1)} className="hover:bg-white/20 rounded p-1"><Plus className="w-3.5 h-3.5 opacity-60" /></button>
                    <button onClick={setB} className="ml-1 text-[11px] rounded px-2.5 py-1 transition-colors whitespace-nowrap font-medium" style={{ backgroundColor: colors.button, color: colors.buttonText }}>設為當前</button>
                  </div>
                </div>

                {/* Range Input */}
                <div className="flex items-center justify-between gap-2 bg-black/60 rounded-md px-3 py-1.5 border border-white/5 w-full xl:w-auto">
                  <span className="text-[11px] font-bold opacity-50 whitespace-nowrap ml-1">快速區間</span>
                  <div className="flex items-center">
                    <input type="text" value={rangeInput} onChange={(e) => setRangeInput(e.target.value)} onBlur={applyRange} onKeyDown={(e) => e.key === 'Enter' && applyRange()} placeholder="A~B" className="w-12 text-center font-mono text-[11px] bg-transparent outline-none border-b border-white/20 focus:border-white/50 transition-colors pb-0.5 opacity-70" />
                  </div>
                </div>

                {/* Actions Group */}
                <div className="flex items-center justify-between xl:justify-end gap-5 w-full xl:w-auto mt-1 xl:mt-0 px-2 xl:px-0">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={isRepeatEnabled} onChange={(e) => setIsRepeatEnabled(e.target.checked)} className="w-3.5 h-3.5 accent-[#7f5af0]" />
                      <span className={`text-[12px] font-bold whitespace-nowrap ${isRepeatEnabled ? 'text-white' : 'opacity-50'}`}>循環</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer" title="自動循環增強：超出 B 點時極短淡出再跳回 A 點，聽力練習流暢不刺耳">
                      <input type="checkbox" checked={isLoopFadeEnabled} onChange={(e) => setIsLoopFadeEnabled(e.target.checked)} className="w-3.5 h-3.5 accent-[#7f5af0]" />
                      <span className={`text-[12px] font-bold whitespace-nowrap ${isLoopFadeEnabled ? 'text-white' : 'opacity-50'}`}>淡出</span>
                    </label>
                  </div>
                  
                  <div className="hidden xl:block w-px h-5 bg-white/10 mx-1"></div>
                  
                  <div className="flex items-center gap-4">
                    <button onClick={clearAB} title="清除標記" className="hover:bg-white/10 rounded p-1 transition-colors text-red-400 group flex items-center justify-center"><Trash2 className="w-4 h-4 opacity-70 group-hover:opacity-100" /></button>
                    <button onClick={handleShare} title="產生分享連結" className="hover:bg-white/10 rounded p-1 transition-colors group flex items-center justify-center text-white"><Share2 className="w-4 h-4 opacity-50 group-hover:opacity-100" /></button>
                  </div>
                </div>
              </div>
            </div>
          </div>
"""

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "{/* Bottom Row: A/B Controls */}" in line:
        start_idx = i
    if "        {/* 書籤紀錄與重點標記 */}" in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    del lines[start_idx:end_idx]
    lines.insert(start_idx, new_content)
    with open("src/App.tsx", "w") as f:
        f.writelines(lines)
    print("Replaced successfully")
else:
    print(f"Not found: start_idx={start_idx}, end_idx={end_idx}")
