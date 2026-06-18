# Gera src/font_p.h: fonte mono (Menlo) rasterizada pro render girado em retrato.
# Uso: python tools/gen_font.py   (precisa de Pillow; usa uma TTF mono do macOS)
import os
from PIL import Image, ImageDraw, ImageFont

SIZE = 26
PATH = "/System/Library/Fonts/Menlo.ttc"  # mono
font = ImageFont.truetype(PATH, SIZE, index=0)
ascent, descent = font.getmetrics()
cellH = ascent + descent + 2
cellW = round(font.getlength("M"))

FIRST, LAST = 32, 126
data = bytearray()
for code in range(FIRST, LAST + 1):
    img = Image.new("L", (cellW, cellH), 0)
    d = ImageDraw.Draw(img)
    d.text((0, 1), chr(code), font=font, fill=255)
    data.extend(img.tobytes())  # cellW*cellH bytes, gray 0..255 (ink amount)

out = []
out.append("#pragma once")
out.append("// Fonte mono gerada de Menlo pra render girado (retrato). gray: 255=tinta.")
out.append(f"#define PFONT_W {cellW}")
out.append(f"#define PFONT_H {cellH}")
out.append(f"#define PFONT_FIRST {FIRST}")
out.append(f"#define PFONT_LAST {LAST}")
out.append(f"#define PFONT_ASCENT {ascent}")
out.append(f"const unsigned char PFONT_BMP[{len(data)}] = {{")
line = "  "
for i, b in enumerate(data):
    line += f"{b},"
    if len(line) > 110:
        out.append(line); line = "  "
if line.strip():
    out.append(line)
out.append("};")
dest = os.path.join(os.path.dirname(__file__), "..", "src", "font_p.h")
open(dest, "w").write("\n".join(out) + "\n")
print(f"cellW={cellW} cellH={cellH} ascent={ascent} bytes={len(data)} chars={LAST-FIRST+1}")
