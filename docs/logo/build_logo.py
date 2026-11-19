"""Medusify-Logo „Dach abgehoben“ (Wahl Andreas 2026-11-19, Konzept 28 aus waben-runde4-sonnet).

Idea / Idee: eine gerundete Wabe als Ring, das Dach schwebt abgehoben über dem Boden — headless, wie Medusa. Das Dach ist
Medusify-Blau, der Boden Tinte. Einzige Quelle aller Logo-Dateien; Aufruf:
  uv run --no-project --with shapely python build_logo.py
"""
import math
import os

from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

INK, PAPER, BLUE = "#18181B", "#FFFFFF", "#3B82F6"
TILE_DARK, TILE_LIGHT = "#18181B", "#F4F4F5"
S3 = math.sqrt(3)


def hexagon(R, cx, cy):
    return Polygon([(cx + R * math.cos(math.radians(a)), cy + R * math.sin(math.radians(a))) for a in range(-90, 270, 60)])


def soften(g, r):
    return g.buffer(-r, join_style="round", quad_segs=32).buffer(r, join_style="round", quad_segs=32)


def ring(R, w, cx, cy, ro=16):
    return soften(hexagon(R, cx, cy), ro).difference(soften(hexagon(R - w * 2 / S3, cx, cy), max(ro - w * 0.55, 4)))


def mark(width=30, gap=20, lift=14):
    """Boden und Dach, gemeinsam auf (128, 128) zentriert. width = Ringstärke, gap/lift = Fuge und Abheben."""
    R = 98
    rg = ring(R, width, 128, 128)
    cut = 128 - R * 0.12
    roof = affinity.translate(rg.intersection(box(0, 0, 256, cut)), 0, -lift)
    base = rg.intersection(box(0, cut + gap, 256, 256))
    x0, y0, x1, y1 = unary_union([roof, base]).bounds
    dx, dy = 128 - (x0 + x1) / 2, 128 - (y0 + y1) / 2
    return affinity.translate(base, dx, dy), affinity.translate(roof, dx, dy)


def d_of(g, tol=0.02):
    g = g.simplify(tol)
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    return " ".join("M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in list(r.coords)[:-1]) + "Z" for p in polys for r in [p.exterior, *p.interiors])


def svg(body, title, w=256, h=256):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"><title>{title}</title>{body}</svg>\n'


def paths(base, roof, fg, accent, transform=""):
    g = f'<path d="{d_of(base)}" fill="{fg}"/><path d="{d_of(roof)}" fill="{accent}"/>'
    return f'<g transform="{transform}">{g}</g>' if transform else g


def write(name, content):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(content)


def fit(scale):
    """Zeichen (Mitte 128/128) auf `scale` der Kachel verkleinern, Mitte bleibt."""
    off = 128 * (1 - scale)
    return f"translate({off:.3f} {off:.3f}) scale({scale})"


base, roof = mark()
# Kleinschnitt für 16–32 px: kräftigerer Ring, breitere Fuge, damit Dach und Boden getrennt lesbar bleiben.
base_s, roof_s = mark(width=38, gap=26, lift=16)

T = "Medusify"
# Zeichen allein
write("medusify-symbol.svg", svg(paths(base, roof, INK, BLUE), T))
write("medusify-symbol-auf-dunkel.svg", svg(paths(base, roof, PAPER, BLUE), T))
write("medusify-symbol-schwarz.svg", svg(paths(base, roof, "#000000", "#000000"), T))
write("medusify-symbol-weiss.svg", svg(paths(base, roof, "#FFFFFF", "#FFFFFF"), T))
write("medusify-symbol-klein.svg", svg(paths(base_s, roof_s, INK, BLUE), T))
# Kacheln (App-Symbol, Favicon). Zeichen auf 68,75 % wie bei der Wahl gezeigt.
for tag, bg, fg in (("dunkel", TILE_DARK, PAPER), ("hell", TILE_LIGHT, INK)):
    write(f"medusify-kachel-{tag}.svg", svg(f'<rect width="256" height="256" rx="58" fill="{bg}"/>' + paths(base, roof, fg, BLUE, fit(0.6875)), T))
# Vollflächig für Systeme, die selbst maskieren (iOS apple-touch-icon, Android maskable: sichere Zone = Kreis mit 40 % Radius).
write("medusify-app-ios.svg", svg(f'<rect width="256" height="256" fill="{TILE_DARK}"/>' + paths(base, roof, PAPER, BLUE, fit(0.6875)), T))
write("medusify-app-maskable.svg", svg(f'<rect width="256" height="256" fill="{TILE_DARK}"/>' + paths(base, roof, PAPER, BLUE, fit(0.56)), T))
# Favicon: Kleinschnitt, größer in der Kachel, Kachel trägt das Zeichen auch in dunklen Tabs.
write("medusify-favicon.svg", svg(f'<rect width="256" height="256" rx="56" fill="{TILE_DARK}"/>' + paths(base_s, roof_s, PAPER, BLUE, fit(0.8)), T))
print("ok", sorted(os.listdir(OUT)))
