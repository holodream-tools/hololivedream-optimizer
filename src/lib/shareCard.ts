/**
 * The share card: the team on screen, drawn as a picture worth posting.
 *
 * This draws only. Every number it renders arrives already formatted by the
 * page that produced it, from the same expression that printed it on screen --
 * there is no arithmetic here and no second copy of any formula, so the card
 * cannot drift from the page it came from. What varies between the two kinds
 * of card is the data handed in, not the drawing.
 *
 * The layout, the palette and the visual grammar are the site's, and are the
 * ones tools/make_og_image.py already draws the static Open Graph image with:
 * the dark ground, the brand hairline down the left edge, rounded surfaces on
 * a hairline border, and the attribute stripe every card tile carries. The
 * palette is pinned to the dark one rather than read from the viewer's theme,
 * so one team produces one picture whoever generated it.
 *
 * Artwork is the portrait layer, not the card art. That is not a preference:
 * the card art is hot-linked from a host that sends no CORS header, so drawing
 * it would taint the canvas and `toBlob` would refuse to export at all. The
 * portraits are served with `Access-Control-Allow-Origin: *`, cover every card,
 * and come from the same ImageSource mapping the interface already uses.
 */
import type { ImageSource } from './images';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/* ---- App.css, the dark palette. Same values make_og_image.py copies. ---- */
const GROUND = '#131019';
const SURFACE = '#1B1723';
const SURFACE_2 = '#241F2E';
const LINE = '#342D40';
const INK = '#EFEAF2';
const INK_2 = '#BCB4C7';
const INK_3 = '#8E859C';
const BRAND = '#F0819F';

/** The three attribute colours, dark cut. Hex because a canvas has no vars. */
const ATTRIBUTE_INK: Record<string, string> = {
  cute: '#F085AF', happy: '#E0AC58', pure: '#6BBBD4',
};

const FAMILY = 'system-ui, "Noto Sans TC", "Hiragino Sans", sans-serif';
const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

export interface ShareCardMember {
  cardId: string;
  name: string;
  /** The costume title, as the card tiles show it. */
  title: string;
  /** Attribute as the interface writes it: cute / happy / pure. */
  type: string;
  bloom: number;
  /** 站位 n, on a card that came from a standing order. */
  slot?: string;
  /** Up to two short lines under the name; song coverage, where there is any. */
  notes?: string[];
  /** Whether the Leader Outfit is this member's card. */
  isLeader?: boolean;
}

export interface ShareCardStat {
  label: string;
  value: string;
}

export interface ShareCardData {
  /** 自選隊伍, or the song's title when the card came from a song analysis. */
  subject: string;
  /** The line under it: the difficulty, note count and length of a chart. */
  subjectMeta?: string;
  /** The one big number, whichever quantity this card is about. */
  headline: ShareCardStat;
  /** Everything else, in the page's own words. Four to a row. */
  stats: ShareCardStat[];
  members: ShareCardMember[];
  /** 隊長服裝：… — the Outfit lends its skill whether or not it also plays. */
  leaderLine?: string;
}

/** Rounded rectangle, without depending on roundRect being present. */
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number,
                 w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Letter-spaced text; .eyebrow uses .16em and a canvas has no tracking. */
function tracked(ctx: CanvasRenderingContext2D, text: string,
                 x: number, y: number, spacing: number): void {
  let at = x;
  for (const char of text) {
    ctx.fillText(char, at, y);
    at += ctx.measureText(char).width + spacing;
  }
}

/** As much of `text` as fits, with an ellipsis when that is not all of it. */
function clipped(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > max) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

/**
 * `text` broken over at most `maxLines`, with the last one ellipsised if that
 * still is not enough.
 *
 * Breaks on a space where the line has one and on any character where it does
 * not, which is what both halves of this catalogue need: a name like
 * "Ninomae Ina'nis" has words to break between and アキ・ローゼンタール has
 * none. The caller sets the font first, as it does for `clipped`.
 */
function wrapped(ctx: CanvasRenderingContext2D, text: string,
                 max: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = text.trim();
  while (rest) {
    if (ctx.measureText(rest).width <= max) { lines.push(rest); break; }
    if (lines.length === maxLines - 1) { lines.push(clipped(ctx, rest, max)); break; }
    let cut = rest.length;
    while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > max) cut--;
    const space = rest.lastIndexOf(' ', cut);
    if (space > 0) cut = space;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return lines;
}

function write(ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
               { size, weight = 400, colour = INK, max }: {
                 size: number; weight?: number; colour?: string; max?: number;
               }): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = colour;
  ctx.fillText(max === undefined ? text : clipped(ctx, text, max), x, y);
}

/**
 * `crossOrigin` is what keeps the canvas exportable, so a host that does not
 * allow it fails here rather than at `toBlob`, and the tile falls back to the
 * typographic panel the interface uses when there is no artwork either.
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Cover the box, centred, cropping the overflowing axis rather than squashing. */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement,
                   x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - width) / 2, y + (h - height) / 2, width, height);
}

/* ---- layout, in the 1200x630 the card is posted at ---- */
const LEFT = 72;
const RIGHT = CARD_WIDTH - 72;
const SPAN = RIGHT - LEFT;
const TILE_GAP = 14;
const TILE_W = (SPAN - TILE_GAP * 4) / 5;
const TILE_Y = 148;
const TILE_H = 250;
const TILE_TEXT_W = TILE_W - 24;

/* The writing under the artwork, and what each line of it costs. */
const NAME_SIZE = 18;
const NAME_LH = 21;
const TITLE_SIZES = [13, 12, 11];
const TOP_GAP = 10;      // artwork to the first line of the name
const NAME_GAP = 3;
const TITLE_GAP = 7;
const META_LH = 17;
const NOTE_LH = 17;
const BOTTOM_PAD = 8;
/**
 * Below this the portrait stops being a portrait, so the costume gives up a
 * point of size first. A threshold for that choice, never a clamp: the artwork
 * is whatever the writing leaves, and forcing it taller would push the writing
 * out through the bottom of the tile. The worst case the data allows -- two
 * lines of name, two of costume, two of coverage, at the smallest costume
 * size -- lands at 99, which is why the ladder ends where it does.
 */
const MIN_ART = 100;

interface TileText {
  name: string[];
  title: string[];
  titleSize: number;
}

/**
 * How the writing on one tile breaks, at a given size for the costume.
 *
 * Two lines each for the member and the costume: these are real names, and
 * cutting アキ・ローゼンタール to アキ・ローゼンタ… to save a line is not a
 * saving worth making.
 */
function measureTile(ctx: CanvasRenderingContext2D, member: ShareCardMember,
                     titleSize: number): TileText {
  ctx.font = font(NAME_SIZE, 700);
  const name = wrapped(ctx, member.name, TILE_TEXT_W, 2);
  ctx.font = font(titleSize);
  const title = wrapped(ctx, member.title || '—', TILE_TEXT_W, 2);
  return { name, title, titleSize };
}

interface TileLayout {
  artH: number;
  /** Where the attribute row starts, the same on all five. */
  metaY: number;
}

/**
 * Where the writing sits, decided for the row rather than per tile.
 *
 * The name and the costume each get as many lines as the longest of the five
 * needs, so the attribute row and the coverage under it start at one height
 * across the row. A tile with less to say simply has more ground under its
 * costume; a tile whose neighbours all wrapped does not sit a line high.
 */
function tileLayout(rows: TileText[], noteLines: number): TileLayout {
  const names = Math.max(...rows.map((row) => row.name.length));
  const titles = Math.max(...rows.map((row) => row.title.length));
  const above = TOP_GAP + names * NAME_LH + NAME_GAP + titles * (rows[0].titleSize + 4)
    + TITLE_GAP;
  const artH = TILE_H - (above + META_LH + noteLines * NOTE_LH + BOTTOM_PAD);
  return { artH, metaY: TILE_Y + artH + above };
}

function drawTile(ctx: CanvasRenderingContext2D, member: ShareCardMember, text: TileText,
                  image: HTMLImageElement | null, x: number, layout: TileLayout): void {
  const { artH, metaY } = layout;
  const accent = ATTRIBUTE_INK[member.type.toLowerCase()] ?? INK_3;
  const label = member.type ? member.type[0].toUpperCase() + member.type.slice(1) : '—';

  rounded(ctx, x, TILE_Y, TILE_W, TILE_H, 12);
  ctx.fillStyle = SURFACE;
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  // The artwork, clipped to the tile's own top corners.
  ctx.save();
  rounded(ctx, x + 1, TILE_Y + 1, TILE_W - 2, artH, 11);
  ctx.clip();
  ctx.fillStyle = SURFACE_2;
  ctx.fillRect(x + 1, TILE_Y + 1, TILE_W - 2, artH);
  if (image) {
    drawCover(ctx, image, x + 1, TILE_Y + 1, TILE_W - 2, artH);
  } else {
    ctx.textAlign = 'center';
    write(ctx, label, x + TILE_W / 2, TILE_Y + artH / 2 - 11, { size: 18, weight: 700, colour: INK_3 });
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // The attribute stripe every card tile in the interface carries.
  ctx.fillStyle = accent;
  ctx.fillRect(x, TILE_Y + 6, 3, TILE_H - 12);

  // The Leader's mark: the same word the team rows use, and nothing else --
  // the tile stays exactly the size of the other four.
  if (member.isLeader) {
    ctx.font = font(13, 700);
    const width = ctx.measureText('隊長').width + 16;
    rounded(ctx, x + 9, TILE_Y + 9, width, 22, 6);
    ctx.fillStyle = 'rgba(19, 16, 25, .82)';
    ctx.fill();
    write(ctx, '隊長', x + 17, TILE_Y + 14, { size: 13, weight: 700, colour: BRAND });
  }
  if (member.slot) {
    ctx.textAlign = 'right';
    ctx.font = font(13, 700);
    const width = ctx.measureText(member.slot).width + 16;
    rounded(ctx, x + TILE_W - 9 - width, TILE_Y + 9, width, 22, 6);
    ctx.fillStyle = 'rgba(19, 16, 25, .82)';
    ctx.fill();
    write(ctx, member.slot, x + TILE_W - 17, TILE_Y + 14, { size: 13, weight: 700, colour: INK_2 });
    ctx.textAlign = 'left';
  }

  const inner = TILE_TEXT_W;
  let y = TILE_Y + artH + TOP_GAP;
  for (const line of text.name) {
    write(ctx, line, x + 12, y, { size: NAME_SIZE, weight: 700 });
    y += NAME_LH;
  }
  y += NAME_GAP;
  for (const line of text.title) {
    write(ctx, line, x + 12, y, { size: text.titleSize, colour: INK_3 });
    y += text.titleSize + 4;
  }

  // Attribute and Bloom on one line, the attribute in its own colour.
  write(ctx, label, x + 12, metaY, { size: 13, weight: 700, colour: accent });
  ctx.font = font(13, 700);
  const after = x + 12 + ctx.measureText(label).width;
  write(ctx, ` · 命座 ${member.bloom}`, after, metaY, { size: 13, colour: INK_2 });

  let noteY = metaY + META_LH;
  for (const note of (member.notes ?? []).slice(0, 2)) {
    write(ctx, note, x + 12, noteY, { size: 12.5, colour: INK_3, max: inner });
    noteY += 17;
  }
}

/**
 * Draw the card and hand back the PNG.
 *
 * `images` may be null, and any one portrait may fail to load; both leave the
 * typographic panel in place rather than failing the card.
 */
export async function renderShareCard(data: ShareCardData,
                                      images: ImageSource | null): Promise<Blob> {
  const artwork = await Promise.all(data.members.map((member) => {
    const url = images?.portraitAt(member.cardId, 360);
    return url ? loadImage(url) : Promise.resolve(null);
  }));

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('這個瀏覽器無法產生圖卡');
  ctx.textBaseline = 'top';

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  // The 3px accent edge the first-run hint and the leader row both use, at the
  // scale this picture is posted.
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 0, 5, CARD_HEIGHT);

  ctx.font = font(17, 700);
  ctx.fillStyle = BRAND;
  tracked(ctx, 'HOLOLIVE DREAMS TEAM ANALYSIS', LEFT, 44, 2.8);

  write(ctx, data.subject, LEFT, 72, { size: 34, weight: 700, max: SPAN });
  if (data.subjectMeta) {
    write(ctx, data.subjectMeta, LEFT, 114, { size: 16, colour: INK_3, max: SPAN });
  }

  /*
   * One line budget for all five tiles, not one each: the tiles are the same
   * size and sit in a row, so a name that needs two lines moves every artwork
   * up, and they stay level. The costume gives up a point of size before the
   * portrait is allowed to shrink past being recognisable.
   */
  const shown = data.members.slice(0, 5);
  const noteLines = Math.max(0, ...shown.map((member) =>
    Math.min(member.notes?.length ?? 0, 2)));
  let text = shown.map((member) => measureTile(ctx, member, TITLE_SIZES[0]));
  let layout = tileLayout(text, noteLines);
  for (const size of TITLE_SIZES.slice(1)) {
    if (layout.artH >= MIN_ART) break;
    text = shown.map((member) => measureTile(ctx, member, size));
    layout = tileLayout(text, noteLines);
  }

  shown.forEach((member, index) => {
    drawTile(ctx, member, text[index], artwork[index],
             LEFT + index * (TILE_W + TILE_GAP), layout);
  });

  let y = TILE_Y + TILE_H + 10;
  if (data.leaderLine) {
    write(ctx, data.leaderLine, LEFT, y, { size: 14.5, colour: INK_2, max: SPAN });
    y += 24;
  }

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LEFT, y + 4.5);
  ctx.lineTo(RIGHT, y + 4.5);
  ctx.stroke();

  // The headline sits alone on the left at the size of the thing it names; the
  // rest run four to a row beside it, in the page's own words. One row of
  // figures leaves a band of ground under it, so the whole block drops to sit
  // in the middle of that space rather than at the top of it.
  const rows = Math.ceil(Math.min(data.stats.length, 8) / 4);
  const bodyY = y + 22 + (rows < 2 ? 22 : 0);
  write(ctx, data.headline.label, LEFT, bodyY, { size: 14, weight: 700, colour: INK_3, max: 300 });
  write(ctx, data.headline.value, LEFT, bodyY + 22, { size: 46, weight: 700, colour: INK });

  const gridX = LEFT + 336;
  const columns = 4;
  const cellW = (RIGHT - gridX) / columns;
  data.stats.slice(0, 8).forEach((stat, index) => {
    const cx = gridX + (index % columns) * cellW;
    const cy = bodyY + Math.floor(index / columns) * 62;
    write(ctx, stat.label, cx, cy, { size: 13, colour: INK_3, max: cellW - 12 });
    write(ctx, stat.value, cx, cy + 20, { size: 23, weight: 700, colour: INK, max: cellW - 12 });
  });

  write(ctx, 'hololive Dreams Optimizer', LEFT, CARD_HEIGHT - 44,
        { size: 15, weight: 700, colour: INK_2 });
  ctx.textAlign = 'right';
  write(ctx, 'holodream-tools.github.io/hololivedream-optimizer', RIGHT, CARD_HEIGHT - 42,
        { size: 13.5, colour: INK_3 });
  ctx.textAlign = 'left';

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('圖卡輸出失敗'))),
      'image/png',
    );
  });
}
