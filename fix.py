with open("src/App.tsx", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "微型書籤時間軸" in line:
        print(f"微型書籤時間軸: {i+1}")
    if "當前 A/B 循環區間對應的字幕名稱與建議" in line:
        print(f"當前 A/B 循環區間對應的字幕名稱與建議: {i+1}")
