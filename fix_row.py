import sys

with open("src/App.tsx", "r") as f:
    lines = f.readlines()

new_content = """              {/* Bottom Row: A/B Controls */}
              <div className="flex flex-col gap-3 bg-white/5 rounded-xl p-3 md:p-4 border border-white/5">
                
                <div className="flex flex-col lg:flex-row gap-3 w-full">
                  {/* Point A Input */}
                  <div className="flex-1 flex items-center justify-between gap-3 bg-black/40 rounded-lg px-3 py-2 border border-white/10 w-full">
                    <span className="text-xs font-black opacity-50 ml-1 whitespace-nowrap">起點 A</span>
                    <div className="flex items-center gap-1.5">
                      <button {...getHoldHandlers('A', -0.1)} className="hover:bg-white/20 rounded p-1.5"><Minus className="w-3.5 h-3.5 opacity-70" /></button>
                      <input type="text" value={inputA} onChange={(e) => setInputA(e.target.value)} onBlur={applyInputA} onKeyDown={(e) => e.key === 'Enter' && applyInputA()} placeholder="00:00" className="w-16 text-center font-mono text-xs bg-transparent outline-none" />
                      <button {...getHoldHandlers('A', 0.1)} className="hover:bg-white/20 rounded p-1.5"><Plus className="w-3.5 h-3.5 opacity-70" /></button>
                      <button onClick={setA} className="ml-2 text-xs bg-white/10 hover:bg-white/20 rounded px-3 py-1.5 transition-colors whitespace-nowrap">設為當前</button>
                    </div>
                  </div>

                  {/* Point B Input */}
                  <div className="flex-1 flex items-center justify-between gap-3 bg-[#7f5af0]/10 rounded-lg px-3 py-2 border border-[#7f5af0]/30 w-full">
                    <span className="text-xs font-black ml-1 whitespace-nowrap" style={{ color: colors.button }}>終點 B</span>
                    <div className="flex items-center gap-1.5">
                      <button {...getHoldHandlers('B', -0.1)} className="hover:bg-white/20 rounded p-1.5"><Minus className="w-3.5 h-3.5 opacity-70" /></button>
                      <input type="text" value={inputB} onChange={(e) => setInputB(e.target.value)} onBlur={applyInputB} onKeyDown={(e) => e.key === 'Enter' && applyInputB()} placeholder="00:00" className="w-16 text-center font-mono text-xs bg-transparent outline-none" style={{ color: colors.button }} />
                      <button {...getHoldHandlers('B', 0.1)} className="hover:bg-white/20 rounded p-1.5"><Plus className="w-3.5 h-3.5 opacity-70" /></button>
                      <button onClick={setB} className="ml-2 text-xs rounded px-3 py-1.5 transition-colors whitespace-nowrap" style={{ backgroundColor: colors.button, color: colors.buttonText }}>設為當前</button>
                    </div>
                  </div>

                  {/* Range Input */}
                  <div className="flex-1 flex items-center justify-between gap-3 bg-black/40 rounded-lg px-3 py-2 border border-white/10 w-full">
                    <span className="text-xs font-black opacity-50 whitespace-nowrap ml-1">快速區間</span>
                    <div className="flex items-center gap-2">
                      <input type="text" value={rangeInput} onChange={(e) => setRangeInput(e.target.value)} onBlur={applyRange} onKeyDown={(e) => e.key === 'Enter' && applyRange()} placeholder="A~B" className="w-20 text-center font-mono text-xs bg-transparent outline-none border-b border-white/20 focus:border-white/50 transition-colors pb-0.5" />
                    </div>
                  </div>
                </div>

                {/* Actions Group (Repeat, LoopFade, Trash, Share) */}
"""

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "{/* Bottom Row: A/B Controls */}" in line:
        start_idx = i
    if "{/* Actions Group (Repeat, LoopFade, Trash, Share) */}" in line and start_idx != -1:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    del lines[start_idx:end_idx+1]
    lines.insert(start_idx, new_content)
    with open("src/App.tsx", "w") as f:
        f.writelines(lines)
else:
    print("Not found")

