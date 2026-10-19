"""Create the small native app icon from the dashboard's pulse mark."""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / "web" / "src-tauri" / "icons"
out.mkdir(parents=True, exist_ok=True)
scale = 4
size = 256 * scale
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8 * scale, 8 * scale, 248 * scale, 248 * scale), radius=58 * scale, fill="#14232b", outline="#5ebc9a", width=3 * scale)
points = [(43, 133), (79, 133), (95, 86), (128, 191), (150, 113), (173, 133), (213, 133)]
draw.line([(x * scale, y * scale) for x, y in points], fill="#9cf1c1", width=10 * scale, joint="curve")
image = image.resize((256, 256), Image.Resampling.LANCZOS)
image.save(out / "icon.png")
image.save(out / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
