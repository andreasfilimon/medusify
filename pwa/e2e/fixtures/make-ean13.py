#!/usr/bin/env python3
"""Draws an EAN-13 on a white 1280x720 frame and writes a short Y4M clip (4:2:0; an MJPEG clip made by ffmpeg is 4:4:4 and Chromium shows it as a flat green picture): the fake camera of the scanner E2E.
   python3 make-ean13.py 2000000000008 ean13.y4m      (needs Pillow and ffmpeg; the code is from the in-store range)"""
import subprocess, sys, tempfile, os
from PIL import Image, ImageDraw, ImageFont

L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"]
G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"]
R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"]
FIRST = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"]

def encode(code: str) -> str:
    assert len(code) == 13 and code.isdigit()
    s = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(code[:12]))
    assert (10 - s % 10) % 10 == int(code[12]), "bad check digit"
    pat = FIRST[int(code[0])]
    left = "".join((L if pat[i] == "L" else G)[int(code[1 + i])] for i in range(6))
    right = "".join(R[int(d)] for d in code[7:])
    return "101" + left + "01010" + right + "101"

code, out = sys.argv[1], sys.argv[2]
bits = encode(code)
module = 6
quiet = 12 * module
w, h = 1280, 720
img = Image.new("RGB", (w, h), "white")
d = ImageDraw.Draw(img)
x0 = (w - len(bits) * module) // 2
top, bottom = 170, 520
for i, b in enumerate(bits):
    if b == "1":
        d.rectangle([x0 + i * module, top, x0 + (i + 1) * module - 1, bottom], fill="black")
try:
    font = ImageFont.truetype("DejaVuSansMono.ttf", 40)
except OSError:
    font = ImageFont.load_default()
d.text((x0, bottom + 12), code, fill="black", font=font)
with tempfile.TemporaryDirectory() as tmp:
    png = os.path.join(tmp, "ean.png")
    img.save(png)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", "2", "-r", "3", "-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe", out], check=True)
