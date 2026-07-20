import sys

with open("src/App.tsx", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "let newTime = Math.max(0, baseTime + delta);" in line:
        lines[i] = """          let newTime = baseTime + delta;
          if (pointA !== null && pointB !== null && baseTime >= pointA && baseTime <= pointB) {
            if (newTime < pointA) {
              newTime = pointA;
            }
          }
          newTime = Math.max(0, newTime);
"""
        break

with open("src/App.tsx", "w") as f:
    f.writelines(lines)
