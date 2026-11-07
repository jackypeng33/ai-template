"""Generate the RapVideoMaker vector masters from the bundled Geist typeface.

Requires fonttools for regeneration. Raster exports are produced by
scripts/generate-rap-brand.mjs using the project's existing sharp dependency.
"""

from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "brand"
OUT.mkdir(parents=True, exist_ok=True)
FONTS = ROOT / "node_modules" / "geist" / "dist" / "fonts" / "geist-sans"

COLORS = {
    "dark": ("#B6FF3B", "#F8FAFC"),
    "light": ("#386A00", "#0B0B0F"),
    "white": ("#FFFFFF", "#FFFFFF"),
    "black": ("#000000", "#000000"),
}

# Three transparent rhythm cuts share the play silhouette. At 16px the
# compact master keeps this same outer shape without tiny interior detail.
SILHOUETTE = "M9 7C9 4 12 3 15 5L55 28C58 30 58 34 55 36L15 59C12 61 9 60 9 56Z"
CUTS = "M20 28H24V42H20ZM29 20H33V44H29ZM38 26H42V40H38Z"


def svg(content, width, height, viewbox=None):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="{viewbox or f"0 0 {width} {height}"}">{content}</svg>\n')


def save(name, content):
    (OUT / name).write_text(content, encoding="utf-8")


def mark(color, compact=False):
    if compact:
        return f'<path fill="{color}" d="{SILHOUETTE}"/>'
    return f'<path fill="{color}" fill-rule="evenodd" d="{SILHOUETTE} {CUTS}"/>'


def glyphs(label, font_file, size, start_x, baseline, tracking):
    font = TTFont(font_file)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    units = font["head"].unitsPerEm
    scale = size / units
    x = start_x
    parts = []
    for letter in label:
        name = cmap[ord(letter)]
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(pen)
        path = pen.getCommands()
        parts.append(f'<path transform="translate({x:.3f} {baseline}) scale({scale:.6f} {-scale:.6f})" d="{path}"/>')
        x += font["hmtx"][name][0] * scale + tracking
    return "".join(parts), x - tracking


RAP, rap_end = glyphs("RAP", FONTS / "Geist-Black.ttf", 54, 0, 57, -1.3)
REST, word_end = glyphs("videomaker", FONTS / "Geist-Medium.ttf", 46, rap_end + 2.2, 57, -1.05)
WORD_WIDTH = round(word_end + 2)
WORD_HEIGHT = 64


def wordmark(primary, secondary):
    return f'<g fill="{primary}">{RAP}</g><g fill="{secondary}">{REST}</g>'


for name, (primary, secondary) in COLORS.items():
    save(f"logo-wordmark-{name}.svg", svg(wordmark(primary, secondary), WORD_WIDTH, WORD_HEIGHT))
    save(f"logo-horizontal-{name}.svg", svg(
        f'<g transform="translate(0 0)">{mark(primary)}</g>'
        f'<g transform="translate(78 0)">{wordmark(primary, secondary)}</g>',
        WORD_WIDTH + 78, WORD_HEIGHT))

save("logo-wordmark.svg", svg(wordmark(*COLORS["dark"]), WORD_WIDTH, WORD_HEIGHT))
save("logo-symbol.svg", svg(mark(COLORS["dark"][0]), 64, 64))
save("logo-symbol-light.svg", svg(mark(COLORS["light"][0]), 64, 64))
save("logo-symbol-white.svg", svg(mark("#FFFFFF"), 64, 64))
save("logo-symbol-black.svg", svg(mark("#000000"), 64, 64))
save("logo-symbol-compact.svg", svg(mark(COLORS["dark"][0], compact=True), 64, 64))
save("icon.svg", svg(mark(COLORS["dark"][0], compact=True), 64, 64))

og_word = wordmark(*COLORS["dark"])
tagline, _ = glyphs("AI RAP VIDEO GENERATOR", FONTS / "Geist-Medium.ttf", 30, 0, 32, 1.5)
og = svg(
    '<rect width="1200" height="630" fill="#0B0B0F"/>'
    '<rect x="64" y="64" width="1072" height="502" rx="28" fill="#15151B" stroke="#27272F" stroke-width="2"/>'
    '<rect x="105" y="119" width="54" height="6" rx="3" fill="#B6FF3B"/>'
    '<g transform="translate(105 240) scale(1.85)">' + mark("#B6FF3B") + '</g>'
    '<g transform="translate(250 235) scale(1.8)">' + og_word + '</g>'
    '<g transform="translate(105 432)" fill="#A1A1AA">' + tagline + '</g>'
    '<path d="M105 493H1095" stroke="#27272F" stroke-width="2"/>'
    '<rect x="105" y="492" width="218" height="3" fill="#B6FF3B"/>',
    1200, 630)
save("og-rapvideomaker.svg", og)
print(f"Generated vector masters; wordmark {WORD_WIDTH} x {WORD_HEIGHT}")
