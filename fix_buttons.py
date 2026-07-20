import sys

with open("src/App.tsx", "r") as f:
    content = f.read()

content = content.replace(
    "onClick={() => { if (playerRef.current) playerRef.current.seekTo(Math.max(0, currentTime - 3), 'seconds'); }}",
    "onClick={() => handleRelativeSeek(-3)}"
)

content = content.replace(
    "onClick={() => { if (playerRef.current) playerRef.current.seekTo(Math.min(duration, currentTime + 3), 'seconds'); }}",
    "onClick={() => handleRelativeSeek(3)}"
)

with open("src/App.tsx", "w") as f:
    f.write(content)
