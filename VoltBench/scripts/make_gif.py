import sys
from pathlib import Path

from PIL import Image

frames_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "out/frames")
target = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/dashboard.gif")
width = 1000

frames = []
for path in sorted(frames_dir.glob("*.png")):
    img = Image.open(path).convert("RGB")
    height = round(img.height * width / img.width)
    frames.append(img.resize((width, height), Image.LANCZOS).quantize(colors=96, method=Image.MEDIANCUT, dither=Image.NONE))

target.parent.mkdir(parents=True, exist_ok=True)
frames[0].save(target, save_all=True, append_images=frames[1:], duration=850, loop=0, optimize=True, disposal=2)
print(f"{len(frames)} frames, {target.stat().st_size / 1e6:.2f} MB")
