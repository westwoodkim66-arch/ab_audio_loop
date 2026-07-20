import sys

with open("src/App.tsx", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "let newTime = baseTime + delta;" in line:
        new_logic = """          let newTime = baseTime + delta;
          if (pointA !== null && pointB !== null && baseTime >= pointA && baseTime <= pointB) {
            if (newTime < pointA) {
              newTime = pointA;
            } else if (newTime >= pointB) {
              if (isRepeatEnabled) {
                newTime = pointA;
              } else {
                newTime = pointB;
              }
            }
          }
"""
        # Find where newTime = Math.max(0, newTime) is
        for j in range(i, i+15):
            if "newTime = Math.max(0, newTime);" in lines[j]:
                del lines[i:j]
                lines.insert(i, new_logic)
                break
        break

with open("src/App.tsx", "w") as f:
    f.writelines(lines)
