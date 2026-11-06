"""Build assets/fonts/texscan-psc902.ttf, the Trilithic PSC-902 / Texscan-MSI SpectraGen
Z-Series EAS screen font (GH #164), from the character generator's font ROM.

    python tools/build-texscan-psc902-font.py --rom tests/z4000_roms.zip
    python tools/build-texscan-psc902-font.py --rom "U6 FONTS AM27C2048.BIN" --check

The ROM (cg-wiki.org/texscan_msi/z-series, "z4000_roms.zip" -> "U6 FONTS AM27C2048.BIN") is not
in the repository. Its glyphs sit in the even bytes of the 16-bit EPROM: 32x64 cells, MSB first,
inverted (0 = ink), 256 bytes each, 128 per font, fonts 1-4 at glyph 0/128/256/384. The PSC-902
uses font 1 with the overrides in OVERRIDES, matched by eye against off-air captures.

One 64-pixel cell is one em (2048 units, 32 units per pixel), so the font renders pixel-exact
at multiples of 64 px; the baseline sits under row 45, where the capitals end.
"""

import argparse
import hashlib
import io
import sys
import zipfile
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables.O_S_2f_2 import Panose

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'assets' / 'fonts' / 'texscan-psc902.ttf'
ROM_NAME = 'U6 FONTS AM27C2048.BIN'
ROM_SHA256 = 'a77b01f631834e0f90ba7637e90b21a4dbd3fadd2c0a4379a14e0c5e6ecb8ad1'
FAMILY = 'Texscan PSC-902'

CELL_W, CELL_H = 32, 64
UNIT = 32
BASELINE_ROW = 46
FONT_INDEX = 0


def read_rom(path):
    path = Path(path)
    if path.suffix.lower() == '.zip':
        with zipfile.ZipFile(path) as archive:
            data = archive.read(ROM_NAME)
    else:
        data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != ROM_SHA256:
        raise SystemExit(f'{ROM_NAME}: sha256 {digest} is not the dump this font was built from')
    return data


def glyph_from_rom(rom, code):
    even = rom[0::2]
    start = (FONT_INDEX * 128 + code) * CELL_W * CELL_H // 8
    rows = []
    for r in range(CELL_H):
        bits = []
        for b in range(CELL_W // 8):
            byte = even[start + r * (CELL_W // 8) + b] ^ 0xFF
            bits.extend(bool(byte & (0x80 >> i)) for i in range(8))
        rows.append(bits)
    return rows


def blank():
    return [[False] * CELL_W for _ in range(CELL_H)]


def fill(g, r0, r1, c0, c1):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            g[r][c] = True


def comma_glyph(source):
    g = blank()
    for r in range(46, CELL_H):
        for c in range(CELL_W - 1):
            g[r][c] = source[r][c + 1]
    fill(g, 38, 45, 12, 19)
    return g


def apply_overrides(glyphs):
    glyphs[ord('I')] = [row[:] for row in glyphs[ord('l')]]
    period = blank()
    fill(period, 39, 46, 12, 19)
    glyphs[ord('.')] = period
    colon = blank()
    fill(colon, 24, 31, 12, 19)
    fill(colon, 38, 45, 12, 19)
    glyphs[ord(':')] = colon
    comma = comma_glyph(glyphs[ord(',')])
    glyphs[ord(',')] = comma
    semicolon = [row[:] for row in comma]
    fill(semicolon, 24, 31, 12, 19)
    glyphs[ord(';')] = semicolon
    j = [row[:] for row in glyphs[ord('J')]]
    for r in range(7, 13):
        j[r] = [18 <= c <= 23 for c in range(CELL_W)]
    glyphs[ord('J')] = j
    glyphs[ord('R')] = r_glyph(glyphs[ord('P')])
    return glyphs


R_BITMAP = (
    '....################............',
    '....##################..........',
    '....####################........',
    '....#####################.......',
    '....######################......',
    '....######################......',
    '....######........#########.....',
    '....######..........#######.....',
    '....######...........#######....',
    '....######...........#######....',
    '....######............#######...',
    '....######............#######...',
    '....######...........########...',
    '....######...........########...',
    '....######..........#########...',
    '....######........###########...',
    '....########################....',
    '....########################....',
    '....#######################.....',
    '....#######################.....',
    '....######################......',
    '....######..........######......',
    '....######...........######.....',
    '....######............#####.....',
    '....######.............#####....',
    '....######..............####....',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######..............#####...',
    '....######...............#####..',
)


def r_glyph(_p):
    r = blank()
    top = BASELINE_ROW - len(R_BITMAP)
    for i, line in enumerate(R_BITMAP):
        r[top + i] = [ch == '#' for ch in line]
    return r


OVERRIDES = 'I = bare stem (font 1 "l"); . : , ; = 8x8 boxes (comma/semicolon tail moved 1 column left); J without its top bar; R = hand-drawn to match off-air footage (R_BITMAP, bottom row on the baseline)'


def boundary_edges(g):
    def ink(r, c):
        return 0 <= r < CELL_H and 0 <= c < CELL_W and g[r][c]

    edges = []
    for r in range(CELL_H):
        for c in range(CELL_W):
            if not g[r][c]:
                continue
            top, bottom = BASELINE_ROW - r, BASELINE_ROW - r - 1
            if not ink(r - 1, c):
                edges.append(((c, top), (c + 1, top)))
            if not ink(r, c + 1):
                edges.append(((c + 1, top), (c + 1, bottom)))
            if not ink(r + 1, c):
                edges.append(((c + 1, bottom), (c, bottom)))
            if not ink(r, c - 1):
                edges.append(((c, bottom), (c, top)))
    return edges


def contours(g):
    outgoing = {}
    for start, end in boundary_edges(g):
        outgoing.setdefault(start, []).append(end)
    loops = []
    while outgoing:
        start = next(iter(outgoing))
        loop = [start]
        point = start
        while True:
            ends = outgoing[point]
            end = ends.pop()
            if not ends:
                del outgoing[point]
            if end == start:
                break
            loop.append(end)
            point = end
        loops.append(simplify(loop))
    return loops


def simplify(loop):
    out = []
    n = len(loop)
    for i in range(n):
        prev, cur, nxt = loop[i - 1], loop[i], loop[(i + 1) % n]
        if (prev[0] == cur[0] == nxt[0]) or (prev[1] == cur[1] == nxt[1]):
            continue
        out.append(cur)
    return out


def draw(g):
    pen = TTGlyphPen(None)
    for loop in contours(g):
        pen.moveTo((loop[0][0] * UNIT, loop[0][1] * UNIT))
        for x, y in loop[1:]:
            pen.lineTo((x * UNIT, y * UNIT))
        pen.closePath()
    return pen.glyph()


def monospace_panose():
    panose = Panose()
    panose.bFamilyType = 2
    panose.bProportion = 9
    return panose


def build(rom):
    glyphs = {code: glyph_from_rom(rom, code) for code in range(32, 127)}
    glyphs = apply_overrides(glyphs)
    names = ['.notdef'] + [f'uni{code:04X}' for code in range(32, 127)]
    cmap = {code: f'uni{code:04X}' for code in range(32, 127)}
    advance = CELL_W * UNIT
    ascent = BASELINE_ROW * UNIT
    descent = (CELL_H - BASELINE_ROW) * UNIT

    fb = FontBuilder(CELL_H * UNIT, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(cmap)
    notdef = blank()
    fill(notdef, 7, 45, 6, 25)
    for r in range(9, 44):
        for c in range(8, 24):
            notdef[r][c] = False
    tt_glyphs = {'.notdef': draw(notdef)}
    for code in range(32, 127):
        tt_glyphs[f'uni{code:04X}'] = draw(glyphs[code])
    fb.setupGlyf(tt_glyphs)
    metrics = {}
    for name, glyph in tt_glyphs.items():
        glyph.recalcBounds(fb.font['glyf'])
        metrics[name] = (advance, getattr(glyph, 'xMin', 0) or 0)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ascent, descent=-descent, lineGap=0)
    fb.setupNameTable({
        'familyName': FAMILY,
        'styleName': 'Regular',
        'uniqueFontIdentifier': 'EAS Tools: Texscan PSC-902',
        'fullName': FAMILY,
        'psName': 'TexscanPSC-902',
        'version': 'Version 1.000',
        'description': 'Trilithic PSC-902 / Texscan-MSI SpectraGen Z-Series font 1 from the character generator ROM, with the PSC-902 overrides: ' + OVERRIDES,
    })
    fb.setupOS2(
        sTypoAscender=ascent, sTypoDescender=-descent, sTypoLineGap=0,
        usWinAscent=ascent, usWinDescent=descent, xAvgCharWidth=advance,
        fsType=0, achVendID='EAST', panose=monospace_panose(),
    )
    fb.setupPost(isFixedPitch=1)
    fb.font['head'].created = fb.font['head'].modified = 3786825600
    buffer = io.BytesIO()
    fb.font.save(buffer)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--rom', required=True, help='z4000_roms.zip or the U6 FONTS AM27C2048.BIN inside it')
    parser.add_argument('--check', action='store_true', help='fail if the shipped font differs from a fresh build')
    args = parser.parse_args()
    data = build(read_rom(args.rom))
    if args.check:
        current = TARGET.read_bytes() if TARGET.exists() else b''
        if current != data:
            print(f'{TARGET.relative_to(ROOT)} is out of date; rerun without --check', file=sys.stderr)
            return 1
        print(f'{TARGET.relative_to(ROOT)} is current.')
        return 0
    TARGET.write_bytes(data)
    print(f'Wrote {TARGET.relative_to(ROOT)} ({len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()[:16]}).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
