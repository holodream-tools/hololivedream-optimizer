"""Draw public/og-image.png, the card social sites show for a shared link.

Kept as a script rather than a checked-in mystery binary: when the wording or
the palette changes, the image should be regenerated rather than reconstructed
by hand in an editor nobody has.

Every colour here is read off App.css rather than picked afresh -- the dark
palette, because that is what the site looks like to most people who have their
system set that way, and the five slot colours are the same array
SongTimeline.tsx uses to draw the real thing. The visual on the right is that
timeline, simplified: five rows, a Special window and a few Active windows
each, which is the one picture this tool has that nothing else does.

    python3 tools/make_og_image.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "public" / "og-image.png"
W, H = 1200, 630

# --- App.css, the dark palette -------------------------------------------
GROUND = "#131019"
SURFACE = "#1B1723"
SURFACE_2 = "#241F2E"
LINE = "#342D40"
INK = "#EFEAF2"
INK_2 = "#BCB4C7"
INK_3 = "#8E859C"
BRAND = "#F0819F"
# SongTimeline.tsx SLOT_COLORS, unchanged.
SLOTS = ["#ec6ea8", "#f3a64c", "#79c56d", "#56b7e9", "#ac8bea"]

CJK_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
CJK_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
# Face 0 of the .ttc is the Traditional Chinese cut.
TC = 0


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size, index=TC)


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, f, fill, spacing: float) -> None:
    """Letter-spaced text; .eyebrow uses .16em and PIL has no tracking."""
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=f, fill=fill)
        x += draw.textlength(char, font=f) + spacing


def main() -> int:
    image = Image.new("RGB", (W, H), GROUND)
    draw = ImageDraw.Draw(image)

    # A brand hairline down the left edge, the same 3px accent the first-run
    # hint and the leader row use to mark the thing that matters.
    draw.rectangle([0, 0, 5, H], fill=BRAND)

    pad = 72
    x = pad + 18

    # --- left column: the words ------------------------------------------
    tracked(draw, (x, 84), "HOLOLIVE DREAMS", font(CJK_BOLD, 21), BRAND, 3.4)

    draw.text((x, 132), "hololive Dreams", font=font(CJK_BOLD, 62), fill=INK)
    draw.text((x, 210), "隊伍最佳化", font=font(CJK_BOLD, 62), fill=INK)

    draw.text((x, 310), "歌曲分析・最佳站位・隊伍比較",
              font=font(CJK_REG, 35), fill=INK_2)
    draw.text((x, 372), "依持有卡、命座與歌曲譜面推薦隊伍",
              font=font(CJK_REG, 25), fill=INK_3)

    # --- right column: the timeline, simplified --------------------------
    card_x, card_y, card_w, card_h = 700, 132, 428, 300
    draw.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + card_h],
                           radius=14, fill=SURFACE, outline=LINE, width=1)

    draw.text((card_x + 24, card_y + 20), "技能時間軸",
              font=font(CJK_BOLD, 19), fill=INK_2)

    # Five rows: a short Special bar on top, longer Active bars under it --
    # the shape SongTimeline draws, with plausible windows rather than real
    # ones, since this is a picture and not a claim about any team.
    row_y = card_y + 62
    row_h = 44
    track_x = card_x + 24
    track_w = card_w - 48
    windows = [
        [(0.06, 0.20), (0.34, 0.46), (0.62, 0.74), (0.86, 1.00)],
        [(0.00, 0.12), (0.26, 0.40), (0.55, 0.66), (0.78, 0.92)],
        [(0.10, 0.24), (0.40, 0.52), (0.66, 0.80)],
        [(0.04, 0.16), (0.30, 0.44), (0.58, 0.70), (0.82, 0.96)],
        [(0.14, 0.28), (0.44, 0.58), (0.72, 0.88)],
    ]
    specials = [(0.30, 0.44), (0.10, 0.24), (0.52, 0.66), (0.70, 0.84), (0.36, 0.50)]

    for index, colour in enumerate(SLOTS):
        top = row_y + index * row_h
        draw.rounded_rectangle([track_x, top + 15, track_x + track_w, top + 25],
                               radius=5, fill=SURFACE_2)
        for start, end in windows[index]:
            x0 = track_x + track_w * start
            x1 = track_x + track_w * end
            draw.rounded_rectangle([x0, top + 15, x1, top + 25], radius=5, fill=colour)
        # The Special window sits above its Active row, shorter and solid.
        s0, s1 = specials[index]
        draw.rounded_rectangle([track_x + track_w * s0, top + 5,
                                track_x + track_w * s1, top + 11],
                               radius=3, fill=colour)

    # --- five member slots, along the bottom -----------------------------
    slot_y = 470
    slot_w, slot_h, gap = 132, 74, 14
    for index, colour in enumerate(SLOTS):
        sx = x + index * (slot_w + gap)
        draw.rounded_rectangle([sx, slot_y, sx + slot_w, slot_y + slot_h],
                               radius=11, fill=SURFACE, outline=LINE, width=1)
        # The attribute stripe each card tile carries down its left edge.
        draw.rounded_rectangle([sx, slot_y, sx + 4, slot_y + slot_h],
                               radius=2, fill=colour)
        draw.text((sx + 18, slot_y + 14), f"站位 {index + 1}",
                  font=font(CJK_REG, 15), fill=INK_3)
        draw.rounded_rectangle([sx + 18, slot_y + 44, sx + 18 + 74, slot_y + 52],
                               radius=4, fill=SURFACE_2)

    draw.text((x, H - 70), "holodream-tools.github.io/hololivedream-optimizer",
              font=font(CJK_REG, 21), fill=INK_3)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT}  {image.size[0]}x{image.size[1]}  {OUT.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
