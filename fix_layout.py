with open("src/App.tsx", "r") as f:
    lines = f.readlines()

new_block = """              {/* Bottom Row: A/B Controls (Compact) */}
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
              </div>"""

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "{/* Bottom Row: A/B Controls (Compact) */}" in line:
        start_idx = i
    if "          </div>" in line and start_idx != -1 and i > start_idx + 10 and end_idx == -1:
        # Actually, let's find the exact end div of the A/B controls.
        pass

for i in range(start_idx, len(lines)):
    if "              </div>" in line and "            </div>" in lines[i+1]:
        end_idx = i
        break

print(f"Start: {start_idx}, End: {end_idx}")

new_lines = []
for line in new_block.split('\n'):
    new_lines.append(line + '\n')

lines[start_idx:end_idx+1] = new_lines

with open("src/App.tsx", "w") as f:
    f.writelines(lines)
