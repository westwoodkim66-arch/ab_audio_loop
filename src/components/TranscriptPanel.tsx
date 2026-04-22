import React, { useState, useRef, useEffect } from 'react';
import { Type, GoogleGenAI } from "@google/genai";
import { Copy, Upload, Youtube, Image as ImageIcon, FileText, Loader2, PlayCircle, Settings2 } from 'lucide-react';

interface POSWord {
  word: string;
  furigana: string;
  romaji: string;
  pos: string;
}

interface SubtitleLine {
  id: string;
  startTime: number | null;
  endTime: number | null;
  originalText: string;
  translation: string;
  words: POSWord[];
}

export interface TranscriptPanelProps {
  playerRef: React.RefObject<any>;
  audioUrl: string;
  currentTime: number;
}

// POS Colors Configuration (Dark Mode Optimized Highlights)
const POS_STYLES: Record<string, string> = {
  noun: "bg-[#e2b714]/20 text-[#e2b714] border-b border-[#e2b714]/40 px-1.5 py-0.5 rounded-md",
  verb: "bg-[#ef4444]/20 text-[#ef4444] border-b border-[#ef4444]/40 px-1.5 py-0.5 rounded-md",
  particle: "bg-[#3b82f6]/20 text-[#3b82f6] border-b border-[#3b82f6]/40 px-1.5 py-0.5 rounded-md",
  adjective: "bg-[#a855f7]/20 text-[#a855f7] border-b border-[#a855f7]/40 px-1.5 py-0.5 rounded-md",
  pronoun: "bg-[#14b8a6]/20 text-[#14b8a6] border-b border-[#14b8a6]/40 px-1.5 py-0.5 rounded-md",
  adverb: "bg-[#f97316]/20 text-[#f97316] border-b border-[#f97316]/40 px-1.5 py-0.5 rounded-md",
  punctuation: "text-[#fffffe]/30 px-0 py-1",
  misc: "bg-[#94a1b2]/10 text-[#94a1b2] border-b border-[#94a1b2]/30 px-1.5 py-0.5 rounded-md",
};

export default function TranscriptPanel({ playerRef, audioUrl, currentTime }: TranscriptPanelProps) {
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [inputText, setInputText] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Update active index
  useEffect(() => {
    if (lines.length === 0) return;
    
    // 1. Try to find the exact line we are currently inside
    let idx = lines.findIndex(line => 
        line.startTime !== undefined && line.endTime !== undefined && 
        line.startTime !== -1 && line.endTime !== -1 &&
        currentTime >= line.startTime && currentTime <= line.endTime
    );
    
    // 2. If in a gap between lines, find the last spoken line (keeps it active)
    if (idx === -1 && lines[0]?.startTime !== -1 && lines[0]?.startTime !== undefined) {
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].startTime !== undefined && lines[i].startTime !== -1 && currentTime >= (lines[i].startTime as number)) {
                idx = i;
                break;
            }
        }
    }

    if (idx !== -1 && idx !== activeIndex) {
        setActiveIndex(idx);
    }
  }, [currentTime, lines, activeIndex]);

  // Scroll when index changes
  useEffect(() => {
    if (activeIndex !== -1 && scrollContainerRef.current) {
        const activeElement = scrollContainerRef.current.querySelector(`[data-index="${activeIndex}"]`) as HTMLElement;
        if (activeElement) {
            const container = scrollContainerRef.current;
            
            // Calculate position to snap the element into the exact center of the container
            const elementTop = activeElement.offsetTop;
            const elementHeight = activeElement.offsetHeight;
            const containerHeight = container.clientHeight;
            
            const targetScrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);
            
            container.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth'
            });
        }
    }
  }, [activeIndex]);

  const getGeminiClient = () => {
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  };

  const processTextWithGemini = async (text: string, existingLines?: any[]) => {
    try {
      const ai = getGeminiClient();
      
      // Data to process - split more aggressively by commas and other marks to keep segments short
      let rawData = existingLines ? [...existingLines] : text.split(/[。\n!?.?;,，]/).filter(t => t.trim().length > 0).map((t, i) => ({ id: `manual_${Date.now()}_${i}`, originalText: t.trim(), startTime: -1, endTime: -1 }));

      const CHUNK_SIZE = 8; // Process fewer lines per chunk for better split focus
      let allProcessedLines: SubtitleLine[] = [];
      setLines([]); // Clear existing

      for (let i = 0; i < rawData.length; i += CHUNK_SIZE) {
        const chunk = rawData.slice(i, i + CHUNK_SIZE);
        setStatusText(`正在處理第 ${i + 1} ~ ${Math.min(i + CHUNK_SIZE, rawData.length)} 段 (共 ${rawData.length} 段)...`);
        
        const prompt = `You are an expert bilingual linguist (Japanese and English). Process the following transcript segment into very short subtitle-style chunks.
CRITICAL RULES:
- Output ONLY valid JSON.
- DO NOT add prefix text like "Tagging:" or markdown code blocks (e.g. \`\`\`json).
- Keep each segment VERY SHORT (ideally 3-8 words). If the input is long, split it into multiple JSON objects in the array.
- "originalText" MUST match input snippet EXACTLY.
- If the input object contains a "providedTranslation" that is NOT empty, USE IT EXACTLY as the "translation" value. DO NOT generate a new translation. Only provide a new one if "providedTranslation" is empty/missing.

For each chunk:
1. Provide translation (use "providedTranslation" directly if available).
2. Tokenize the "originalText" into very granular units to ensure accurate furigana alignment. CRITICAL: You MUST separate Kanji from Okurigana (trailing kana). For example, "呼び方" MUST be split into 3 tokens: ["呼", "び", "方"]. "伝わりました" MUST be split into ["伝", "わりました"].
   *IMPORTANT*: If the source text contains inline furigana in parentheses like "日本(にほん)", you MUST strip the parentheses from the 'word', place "にほん" into the 'furigana' field, and output 'word' simply as "日本". Do not leave parentheses in the word.
3. For each token: word (cleaned of parentheses), furigana (If the token contains Kanji, output its reading in Hiragana. If the token is ALREADY exclusively Hiragana or Katakana, output ""), romaji (if JP), pos (noun, verb, particle, adjective, pronoun, adverb, punctuation, misc). Assign the root word's POS to its split okurigana as well.

Expectation: Short, punchy lines suitable for a karaoke-style display.

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

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
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
                        pos: { type: Type.STRING }
                      }
                    }
                  }
                }
              }
            }
          }
        });
        
        let resText = response.text || "[]";
        if(resText.startsWith("\`\`\`json")) {
          resText = resText.replace(/^\`\`\`json\n/, "").replace(/\n\`\`\`$/, "");
        }
        
        const parsed = JSON.parse(resText);
        // Ensure unique IDs in case AI split segments or reused input IDs
        const uniqueParsed = parsed.map((item: any, pIdx: number) => ({
            ...item,
            id: item.id ? `${item.id}_${i}_${pIdx}` : `line_${Date.now()}_${i}_${pIdx}`
        }));
        
        allProcessedLines = [...allProcessedLines, ...uniqueParsed];
        setLines([...allProcessedLines]); // Progressive update
      }
      
      setStatusText("所有文稿處理完成！");
      setTimeout(() => setStatusText(""), 3000);
    } catch (e: any) {
      setStatusText(`處理中斷: ${e.message}`);
      console.error(e);
    }
    setIsProcessing(false);
  };

  const loadYoutubeTranscript = async () => {
    if (!audioUrl || (!audioUrl.includes('youtube.com') && !audioUrl.includes('youtu.be'))) {
      setStatusText("請先載入有效的 YouTube 網址！");
      setTimeout(() => setStatusText(""), 3000);
      return;
    }
    setIsProcessing(true);
    setStatusText("正在讀取 YouTube 字幕...");
    try {
      const res = await fetch(`/api/yt-transcript?url=${encodeURIComponent(audioUrl)}`);
      if (!res.ok) throw new Error("無可用字幕或發生錯誤");
      const data = await res.json();
      
      // format to match prompt mapping
      const mapped = data.map((d: any, idx: number) => ({
        id: `yt_${idx}`,
        originalText: d.text,
        startTime: d.offset / 1000,
        endTime: (d.offset + d.duration) / 1000
      }));
      
      setStatusText("正在進行語言分析與翻譯...");
      // Now that we have chunking, we can process all lines reliably.
      await processTextWithGemini("", mapped); 
      
    } catch(e: any) {
      setStatusText("讀取失敗：" + e.message);
      setIsProcessing(false);
    }
  };

  const handleManualInput = () => {
    if(!inputText.trim()) return;
    setIsProcessing(true);
    setStatusText("正在進行語言分析與翻譯...");
    processTextWithGemini(inputText);
  };

  const [isPanelDragging, setIsPanelDragging] = useState(false);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setStatusText("正在讀取檔案...");
    
    if (file.type.startsWith('image/')) {
        try {
            // handle image to base64
            const reader = new FileReader();
            reader.onload = async (event) => {
                const base64Data = event.target?.result?.toString().split(',')[1];
                if(base64Data) {
                    setStatusText("正在分析圖片結構...");
                    const ai = getGeminiClient();
                    const response = await ai.models.generateContent({
                        model: "gemini-2.5-pro",
                        contents: {
                            parts: [
                                { text: `Extract ALL text from this image completely and accurately. DO NOT OMIT ANY TEXT. Be extremely careful to include the very last words and sentences (e.g. sentence endings).
CRITICAL INSTRUCTION:
Return ONLY a raw valid JSON array of objects (no markdown, no backticks).
Analyze the layout. If the image contains foreign language text (English or Japanese) accompanied by Chinese translation, pair them together accurately paragraph by paragraph.
Each object MUST have:
- "originalText": "The foreign text completely transcribed without truncation."
- "providedTranslation": "The Chinese translation found in the image. Leave empty if none exists."` },
                                { inlineData: { data: base64Data, mimeType: file.type } }
                            ]
                        }
                    });
                    
                    let resText = (response.text || "[]").trim();
                    if(resText.startsWith("```json")) {
                      resText = resText.replace(/^```json\n?/, "").replace(/\n?```$/, "");
                    }
                    
                    try {
                        const parsedImageLines = JSON.parse(resText);
                        setStatusText("圖片讀取成功，開始詞性標記...");
                        const mappedLines = parsedImageLines.map((line: any, idx: number) => ({
                            id: `img_${Date.now()}_${idx}`,
                            originalText: line.originalText,
                            providedTranslation: line.providedTranslation || "",
                            startTime: -1,
                            endTime: -1
                        })).filter((L: any) => L.originalText.trim() !== "");
                        
                        await processTextWithGemini("", mappedLines);
                    } catch(err) {
                        // Fallback
                        setInputText(resText);
                        setStatusText("未能自動解析對照結構，已轉為純文字，請點擊分析！");
                        setIsProcessing(false);
                    }
                }
            };
            reader.readAsDataURL(file);
        } catch(e) {
             setStatusText("圖片分析失敗");
             setIsProcessing(false);
        }
    } else {
        // assume text file like srt, vtt, txt
        const text = await file.text();
        setInputText(text);
        setStatusText("檔案載入完成，請點擊「分析文稿」!");
        setIsProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handlePanelDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsPanelDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const seekToLine = (time: number | undefined | null) => {
    if (time !== undefined && time !== null && time !== -1 && playerRef.current) {
        playerRef.current.seekTo(time, 'seconds');
    }
  };

  return (
    <div className="w-full mt-6 bg-[#16161a] border border-[#010101] shadow-2xl rounded-2xl overflow-hidden font-sans">
      <div className="p-4 border-b border-[#010101]/20 flex flex-wrap gap-4 items-center justify-between">
        <h2 className="text-xl font-bold text-[#fffffe] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#7f5af0]" />
            智慧雙語點讀字幕
        </h2>
        
        <div className="flex flex-wrap gap-2">
            <button 
               onClick={loadYoutubeTranscript}
               disabled={isProcessing}
               className="px-3 py-1.5 rounded-lg bg-[#2cb67d] text-white flex items-center gap-1.5 text-sm font-bold opacity-90 hover:opacity-100 disabled:opacity-50 transition-all">
                <Youtube className="w-4 h-4" />
                讀取 YT 字幕
            </button>
            <button 
               onClick={() => fileInputRef.current?.click()}
               disabled={isProcessing}
               className="px-3 py-1.5 rounded-lg bg-[#72757e] text-white flex items-center gap-1.5 text-sm font-bold opacity-90 hover:opacity-100 disabled:opacity-50 transition-all">
                <Upload className="w-4 h-4" />
                上傳圖檔/字幕
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,.srt,.vtt,.txt" className="hidden" />
        </div>
      </div>

      {lines.length === 0 && (
         <div 
            className="p-6 transition-all"
            onDragOver={(e) => { e.preventDefault(); setIsPanelDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsPanelDragging(false); }}
            onDrop={handlePanelDrop}
         >
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
        <div ref={scrollContainerRef} className="p-4 bg-[#16161a] rounded-b-2xl max-h-[420px] overflow-y-auto w-full border-t border-white/5 custom-scrollbar">
            <div className="flex border-b border-white/5 pb-4 mb-4 gap-4 items-center">
              <span className="text-sm font-bold text-[#94a1b2]">詞性標記：</span>
              <div className="flex flex-wrap gap-2 text-[10px] items-center">
                 <span className="px-2 py-0.5 rounded-md bg-[#e2b714]/20 text-[#e2b714] border border-[#e2b714]/30">名詞</span>
                 <span className="px-2 py-0.5 rounded-md bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/30">動詞</span>
                 <span className="px-2 py-0.5 rounded-md bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30">助詞</span>
                 <span className="px-2 py-0.5 rounded-md bg-[#a855f7]/20 text-[#a855f7] border border-[#a855f7]/30">形容詞</span>
                 <span className="px-2 py-0.5 rounded-md bg-[#14b8a6]/20 text-[#14b8a6] border border-[#14b8a6]/30">代名詞</span>
              </div>
              <button onClick={() => setLines([])} className="ml-auto text-xs text-[#94a1b2] hover:text-red-400 transition-colors">清除分析</button>
            </div>

            <div className="flex flex-col gap-4 w-full pb-24">
               {lines.map((line, lIdx) => {
                   const isActive = lIdx === activeIndex;
                   
                   return (
                       <div 
                         key={line.id} 
                         data-index={lIdx}
                         onClick={() => seekToLine(line.startTime)}
                         className={`w-full flex flex-col gap-2 p-4 rounded-3xl transition-all cursor-pointer ${isActive ? 'bg-white/5 border border-[#7f5af0]/50 shadow-2xl shadow-[#7f5af0]/10 scale-[1.02] z-10' : 'hover:bg-white/5 border border-transparent opacity-40 hover:opacity-80'}`}
                       >
                            <div className="flex flex-wrap items-end gap-y-4 gap-x-2 mb-1 max-w-[90%]">
                                {line.words.map((word, idx) => (
                                    <div key={idx} className="flex flex-col items-center mx-[1px] leading-none shrink-0 group">
                                        <span className="text-[10px] text-[#94a1b2] font-medium h-3 mb-1 tracking-wider opacity-90">{word.furigana}</span>
                                        <span className={`text-2xl font-bold ${POS_STYLES[word.pos] || POS_STYLES['misc']} group-hover:brightness-125 transition-all text-[#fffffe] shadow-sm`}>
                                            {word.word}
                                        </span>
                                        <span className="text-xs text-[#94a1b2]/80 mt-1.5 font-mono italic opacity-90 group-hover:opacity-100 transition-opacity tracking-wide">{word.romaji}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[#94a1b2] text-lg border-t border-white/5 pt-2 mt-1 w-full pl-2 italic">
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
