import sys

with open("src/App.tsx", "r") as f:
    lines = f.readlines()

new_content = """  const handleRelativeSeek = useCallback((delta: number) => {
    if (!playerRef.current) return;
    const baseTime = targetSeekRef.current !== null ? targetSeekRef.current : currentTime;
    let newTime = baseTime + delta;

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

    newTime = Math.max(0, newTime);
    if (duration) {
      newTime = Math.min(newTime, duration);
    }

    targetSeekRef.current = newTime;
    playerRef.current.seekTo(newTime, 'seconds');

    if (seekClearTimer.current) clearTimeout(seekClearTimer.current);
    seekClearTimer.current = setTimeout(() => {
      targetSeekRef.current = null;
    }, 500);
  }, [currentTime, duration, pointA, pointB, isRepeatEnabled]);
"""

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "const handleRelativeSeek = useCallback" in line:
        start_idx = i
    if "const jumpToAndPlay =" in line and start_idx != -1:
        end_idx = i - 1
        break

if start_idx != -1 and end_idx != -1:
    del lines[start_idx:end_idx+1]
    lines.insert(start_idx, new_content)
    with open("src/App.tsx", "w") as f:
        f.writelines(lines)
else:
    print("Not found")
