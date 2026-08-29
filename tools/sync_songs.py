"""Keep the chart bundle current, from two sources with different standards.

A song reaches the site through one of two doors, and every chart records
which one it came through in `provenance`:

  exact        Holodori's own chart pack, taken verbatim. This is where the
               bundle has always come from: tools/export_data.py copies
               `base64decode(pack['data'])` straight into charts.bin without
               re-encoding anything, so "exact" means byte-for-byte what the
               reference produced. Verified: the published R54 pack is
               byte-identical to the bundle this repository already ships.

  provisional  Rebuilt from Hololive Dreams Lab's per-chart events, for a song
               that is live in the game but that Holodori has not published a
               pack for yet. Note times, note counts and Special activations
               come out exact; the per-note weight does not, because the
               source has lost which hold group a flick belonged to and that
               is what decides a flick's 1.05 multiplier. Measured against the
               746 charts we can check both ways, the resulting score is
               within 0.45%. The UI says so wherever such a chart is used.

A provisional chart is temporary by construction: as soon as Holodori
publishes a pack containing it, this tool replaces it with the exact bytes and
the notice disappears. Exact data is never rebuilt from the Lab.

Only songs a public catalogue lists as playable are added at all, which is how
a song that exists in the game's files but has not been released -- Backseat
(m0359) at the time of writing -- stays out.

    python3 tools/sync_songs.py            # report what would change
    python3 tools/sync_songs.py --apply    # write it
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import struct
import unicodedata
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "public" / "data"
CHARTS_JSON = DATA / "charts.json"
CHARTS_BIN = DATA / "charts.bin"

# --- exact source: Holodori's published pack --------------------------------
HOLODORI_PAGE = "https://ace-ks-dev.github.io/holodori-optimizer/index.html"
HOLODORI_RELEASE = "https://ace-ks-dev.github.io/holodori-optimizer/release.json"
PACK_ASSIGNMENT = re.compile(r"globalThis\.HOLODORI_CHART_PACK_R\d+\s*=")

# --- provisional source: Hololive Dreams Lab --------------------------------
LAB_SIMULATOR = "https://dreams.wf-calc.net/simulator"
LAB_ORIGIN = "https://dreams.wf-calc.net"
INDEX_PATTERN = re.compile(r'src="(/assets/index-[^"]+\.js)"')
ASSET_PATTERN = re.compile(r"assets/UnitSimulatorPage-[A-Za-z0-9_-]+\.js")
SONG_PATTERN = re.compile(
    r'\{"id":"(m\d+)","title":"(.*?)".*?"is_tutorial":(true|false),'
    r'.*?"duration_seconds":(\d+),"charts":\[(.*?)\]\}')
CHUNK_PATTERN = re.compile(
    r'"\.\./\.\./\.\./data/holodori/charts/(m\d+)\.([a-z]+)-(\d+)\.json":\(\)=>'
    r'i\(\(\)=>import\("\./([^"]+)"\)')
RATIO_PATTERN = re.compile(
    r'"key":"([^"]+)","songKey":"([^"]+)".*?'
    r'"difficulty":"([^"]+)".*?"scoreRatio":([0-9.]+)')
PAYLOAD_PATTERN = re.compile(r"JSON\.parse\('(.*)'\)", re.S)

# --- playable gate ----------------------------------------------------------
# A maintained public catalogue of what the game actually offers. The game's
# own files carry charts for songs that have not been released, so "there is
# chart data" is not the same question as "a player can pick this".
PLAYABLE_CATALOGUE = "https://www.horodori.com/songs"
LD_JSON = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)

DIFFICULTY_INDEX = {"easy": 1, "normal": 2, "hard": 3, "expert": 4}
DIFFICULTY_LABEL = {"easy": "Easy", "normal": "Normal", "hard": "Hard", "expert": "Expert"}
EXACT, PROVISIONAL = "exact", "provisional"

BYTES_PER_NOTE = 4
SPECIAL_SLOTS = 5
SPECIAL_BYTES = SPECIAL_SLOTS * 4
UINT16_MAX = 65535

EXPECTED_FORMAT = "holodori-chart-v1"
EXPECTED_TRANSCRIPTION = "exact_from_decrypted_sus"
MIN_SOURCE_SONGS = 150
MIN_PLAYABLE_SONGS = 150


def download(url: str, timeout: int = 300) -> bytes:
    request = urllib.request.Request(url, headers={
        "User-Agent": "hololivedream-optimizer song sync",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def text(url: str, timeout: int = 300) -> str:
    return download(url, timeout).decode("utf-8", "replace")


def normalise_title(value: str) -> str:
    folded = unicodedata.normalize("NFKC", value)
    for fancy, plain in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"')):
        folded = folded.replace(fancy, plain)
    return "".join(folded.split()).lower()


def combo_bonus(combo: int) -> float:
    """Mirror of comboBonus in src/engine/chartScore.ts."""
    if combo >= 1000:
        return 0.10
    if combo >= 100:
        return (combo // 100) / 100
    return 0.0


# --------------------------------------------------------------------------
# exact source
# --------------------------------------------------------------------------

def fetch_exact_pack() -> tuple[dict, bytes, dict]:
    """Holodori's index and timeline blob, checked against the pack's own hash."""
    release = json.loads(text(HOLODORI_RELEASE, 120))
    page = text(HOLODORI_PAGE)
    found = PACK_ASSIGNMENT.search(page)
    if not found:
        raise SystemExit("FAILED: no chart pack in the Holodori build; its shape changed")
    pack, _ = json.JSONDecoder().raw_decode(page[found.end():].lstrip())
    blob = base64.b64decode(pack["data"])
    # The pack states the hash of its own binary; a truncated or rewritten
    # download is caught here rather than by the site.
    digest = hashlib.sha256(blob).hexdigest()
    if pack.get("binarySha256") and digest != pack["binarySha256"]:
        raise SystemExit("FAILED: the Holodori pack does not match its own binarySha256")
    if pack.get("encoding") and "u16le-delta-ms" not in pack["encoding"]:
        raise SystemExit(f"FAILED: unexpected pack encoding {pack['encoding']!r}")
    return pack["index"], blob, release


# --------------------------------------------------------------------------
# playable gate
# --------------------------------------------------------------------------

def fetch_playable_titles() -> set[str]:
    page = text(PLAYABLE_CATALOGUE, 120)
    titles: set[str] = set()
    for block in LD_JSON.findall(page):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        if data.get("@type") != "ItemList":
            continue
        for item in data.get("itemListElement", []):
            if item.get("name"):
                titles.add(normalise_title(item["name"]))
    if len(titles) < MIN_PLAYABLE_SONGS:
        raise SystemExit(f"FAILED: the playable catalogue lists only {len(titles)} songs;"
                         f" refusing to treat that as authoritative")
    return titles


# --------------------------------------------------------------------------
# provisional source
# --------------------------------------------------------------------------

def fetch_lab_source() -> str:
    page = text(LAB_SIMULATOR, 120)
    index = INDEX_PATTERN.search(page)
    if not index:
        raise SystemExit("FAILED: the Lab index asset was not found; its page changed")
    asset = ASSET_PATTERN.search(text(LAB_ORIGIN + index.group(1)))
    if not asset:
        raise SystemExit("FAILED: the Lab simulator asset was not found; its page changed")
    return text(f"{LAB_ORIGIN}/{asset.group(0)}")


def parse_lab_catalogue(source: str) -> dict[str, dict]:
    songs: dict[str, dict] = {}
    for music_id, title, tutorial, duration, charts in SONG_PATTERN.findall(source):
        if tutorial == "true":
            continue
        difficulties = {}
        for difficulty, level in re.findall(r"charts/m\d+\.([a-z]+)-(\d+)\.json", charts):
            if difficulty in DIFFICULTY_INDEX:
                difficulties[difficulty] = int(level)
        if difficulties:
            songs[music_id] = {
                "title": json.loads(f'"{title}"') if "\\" in title else title,
                "duration_seconds": int(duration),
                "difficulties": difficulties,
            }
    return songs


def fetch_lab_chart(chunk: str) -> dict:
    payload = PAYLOAD_PATTERN.search(text(f"{LAB_ORIGIN}/assets/{chunk}", 180))
    if not payload:
        raise ValueError(f"no JSON payload in {chunk}")
    return json.loads(payload.group(1).encode().decode("unicode_escape"))


def note_stream(chart: dict) -> list[tuple[int, bool, bool]]:
    """(time_ms, is_mid, is_flick) per note, in scoring order.

    `mid` is a hold continuation: the interior of a hold block, or a note the
    source labels `mid` -- the union, because a two-note block's tail is
    labelled that way while being positionally an end. Checked against all 746
    exact charts, this reproduces their mid/normal split exactly.

    `flick` is the source's flick bucket. It earns 1.05 in most cases but not
    all, and which is which cannot be recovered here; that is the whole reason
    these charts are marked provisional.
    """
    events = chart.get("note_events") or {}
    stream: list[tuple[float, int, bool, bool]] = []
    for note in events.get("blue", []):
        stream.append((note["time_seconds"], note.get("lane", 0), False, False))
    for note in events.get("pink", []):
        stream.append((note["time_seconds"], note.get("lane", 0), False, True))
    for block in events.get("green_blocks", []):
        last = len(block) - 1
        for position, note in enumerate(block):
            is_mid = (0 < position < last) or note.get("note_type") == "mid"
            stream.append((note["time_seconds"], note.get("lane", 0), is_mid, False))
    stream.sort(key=lambda row: (row[0], row[1]))
    return [(round(seconds * 1000), is_mid, is_flick)
            for seconds, _lane, is_mid, is_flick in stream]


def encode_chart(chart: dict) -> tuple[bytes, int, int]:
    """Pack one chart the way src/engine/chartScore.ts materialize() reads it."""
    notes = note_stream(chart)
    if not notes:
        raise ValueError("chart carries no notes")
    specials = chart.get("sp_activation_times_seconds") or []
    if len(specials) != SPECIAL_SLOTS:
        raise ValueError(f"expected {SPECIAL_SLOTS} Special activations, got {len(specials)}")

    packed = bytearray()
    previous = 0
    for index, (time_ms, is_mid, is_flick) in enumerate(notes):
        delta = time_ms - previous
        if delta < 0:
            raise ValueError("notes are not in ascending time order")
        if delta > UINT16_MAX:
            raise ValueError(f"a {delta} ms gap does not fit the uint16 delta")
        base = 100 if is_mid else 1000
        stored = round(base * (1.0 + combo_bonus(index + 1)) * (1.05 if is_flick else 1.0) * 2)
        if stored > UINT16_MAX:
            raise ValueError("weight does not fit a uint16")
        packed += struct.pack("<HH", delta, stored)
        previous = time_ms
    for seconds in specials:
        milliseconds = round(float(seconds) * 1000)
        if not 0 <= milliseconds < 2**32:
            raise ValueError(f"Special activation {seconds}s is out of range")
        packed += struct.pack("<I", milliseconds)
    return bytes(packed), len(notes), previous


def validate_lab_payload(chart: dict) -> None:
    if chart.get("format") != EXPECTED_FORMAT:
        raise ValueError(f"unexpected format {chart.get('format')!r}")
    if chart.get("transcription_status") != EXPECTED_TRANSCRIPTION:
        raise ValueError(f"transcription is {chart.get('transcription_status')!r}")
    counts = chart.get("note_counts") or {}
    declared = sum(int(counts.get(bucket, 0)) for bucket in ("blue", "green", "pink"))
    actual = len(note_stream(chart))
    if declared and declared != actual:
        raise ValueError(f"note_counts says {declared} notes, the events give {actual}")


# --------------------------------------------------------------------------
# assembly and validation
# --------------------------------------------------------------------------

def block_of(blob: bytes, located) -> bytes:
    offset, count, _last = located
    return blob[offset:offset + count * BYTES_PER_NOTE + SPECIAL_BYTES]


def validate_bundle(charts: list[dict], index: dict, blob: bytes) -> list[str]:
    problems: list[str] = []
    keys = [chart["key"] for chart in charts]
    if len(keys) != len(set(keys)):
        problems.append("duplicate chart keys")
    pairs = [(chart["musicId"], chart["difficulty"]) for chart in charts]
    if len(pairs) != len(set(pairs)):
        problems.append("the same song carries the same difficulty twice")
    if set(keys) != set(index):
        problems.append("charts and index disagree about which charts exist")

    cursor = 0
    for chart in sorted(charts, key=lambda row: index[row["key"]][0]):
        key = chart["key"]
        difficulty = str(chart.get("difficulty", "")).lower()
        if not key.startswith(f"{chart['musicId']}:"):
            problems.append(f"{key} does not encode its musicId")
        elif key.split(":", 1)[1] != str(DIFFICULTY_INDEX.get(difficulty, "?")):
            problems.append(f"{key} does not match difficulty {chart.get('difficulty')}")
        if chart.get("provenance") not in (EXACT, PROVISIONAL):
            problems.append(f"{key} has no usable provenance")
        for field in ("title", "difficulty", "difficultyLevel",
                      "fullComboNoteCount", "playingSeconds"):
            if chart.get(field) in (None, ""):
                problems.append(f"{key} has no {field}")
        if not chart.get("scoreRatioEstimated"):
            problems.append(f"{key} has no score divisor")

        offset, count, last_time = index[key]
        if count != chart.get("fullComboNoteCount"):
            problems.append(f"{key}: index count != fullComboNoteCount")
        end = offset + count * BYTES_PER_NOTE + SPECIAL_BYTES
        if offset != cursor:
            problems.append(f"{key}: timeline starts at {offset}, expected {cursor}")
        if end > len(blob):
            problems.append(f"{key}: timeline runs past the end of charts.bin")
            continue
        cursor = end
        position, elapsed = offset, 0
        for _ in range(count):
            delta, _weight = struct.unpack_from("<HH", blob, position)
            elapsed += delta
            position += BYTES_PER_NOTE
        if elapsed != last_time:
            problems.append(f"{key}: index end {last_time}ms != notes end {elapsed}ms")
    if cursor != len(blob):
        problems.append(f"charts.bin has {len(blob) - cursor} unclaimed trailing bytes")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the bundle")
    parser.add_argument("--no-provisional", action="store_true",
                        help="only take exact data; do not add or keep rebuilt charts")
    args = parser.parse_args()

    bundle = json.loads(CHARTS_JSON.read_text(encoding="utf-8"))
    old_blob = CHARTS_BIN.read_bytes()
    old_charts = {chart["key"]: chart for chart in bundle["charts"]}
    old_index = bundle["index"]
    # Charts already here with no provenance predate this tool and came from
    # the pack, which is what exact means.
    old_provenance = {key: chart.get("provenance", EXACT) for key, chart in old_charts.items()}
    old_blocks = {key: block_of(old_blob, old_index[key]) for key in old_charts}
    print(f"site       {len(old_charts)} charts, "
          f"{len({c['musicId'] for c in old_charts.values()})} songs "
          f"({sum(1 for p in old_provenance.values() if p == PROVISIONAL)} provisional)")

    exact_index, exact_blob, release = fetch_exact_pack()
    print(f"exact      Holodori {release.get('chartVersion')} "
          f"({release.get('canonicalDataVersion')}): {len(exact_index)} charts")

    playable = fetch_playable_titles()
    lab_source = fetch_lab_source()
    lab_songs = parse_lab_catalogue(lab_source)
    lab_chunks = {(m, d): c for m, d, _l, c in CHUNK_PATTERN.findall(lab_source)}
    lab_ratios = {(song, difficulty.casefold()): float(ratio)
                  for _k, song, difficulty, ratio in RATIO_PATTERN.findall(lab_source)}
    print(f"lab        {len(lab_songs)} songs, {len(lab_chunks)} chart payloads")
    print(f"playable   {len(playable)} songs listed publicly")
    if len(lab_songs) < MIN_SOURCE_SONGS:
        print(f"\nFAILED: the Lab lists only {len(lab_songs)} songs. Refusing to trust it.")
        return 1

    # ---- decide what every chart should be ------------------------------
    plan: dict[str, dict] = {}
    for key, located in exact_index.items():
        plan[key] = {"provenance": EXACT, "block": block_of(exact_blob, located),
                     "count": located[1], "last": located[2]}

    have_songs = {chart["musicId"] for chart in old_charts.values()}
    exact_songs = {key.split(":")[0] for key in exact_index}
    upgraded = sorted({key for key in plan
                       if old_provenance.get(key) == PROVISIONAL})
    skipped_unplayable: list[str] = []
    added: list[str] = []

    if not args.no_provisional:
        for music_id, song in sorted(lab_songs.items()):
            if music_id in exact_songs:
                continue                        # exact data wins, always
            if normalise_title(song["title"]) not in playable:
                if music_id not in have_songs:
                    skipped_unplayable.append(f"{music_id} {song['title']}")
                continue
            for difficulty, level in sorted(song["difficulties"].items(),
                                            key=lambda row: DIFFICULTY_INDEX[row[0]]):
                key = f"{music_id}:{DIFFICULTY_INDEX[difficulty]}"
                if key in plan:
                    continue
                if old_provenance.get(key) == PROVISIONAL:
                    plan[key] = {"provenance": PROVISIONAL, "block": old_blocks[key],
                                 "count": old_index[key][1], "last": old_index[key][2],
                                 "reuse": True}
                    continue
                chunk = lab_chunks.get((music_id, difficulty))
                ratio = lab_ratios.get((music_id, difficulty))
                if not chunk or not ratio:
                    print(f"\nFAILED: {key} has no {'payload' if not chunk else 'divisor'} upstream.")
                    return 1
                try:
                    chart = fetch_lab_chart(chunk)
                    validate_lab_payload(chart)
                    block, count, last = encode_chart(chart)
                except Exception as cause:                      # noqa: BLE001
                    print(f"\nFAILED: {key}: {type(cause).__name__}: {cause}")
                    return 1
                plan[key] = {"provenance": PROVISIONAL, "block": block,
                             "count": count, "last": last,
                             "meta": {"title": song["title"],
                                      "difficulty": DIFFICULTY_LABEL[difficulty],
                                      "difficultyLevel": level,
                                      "scoreRatioEstimated": ratio,
                                      "playingSeconds": float(song["duration_seconds"])}}
                added.append(key)

    # Nothing already published is ever dropped because a source went quiet.
    for key, chart in old_charts.items():
        if key not in plan:
            plan[key] = {"provenance": old_provenance[key], "block": old_blocks[key],
                         "count": old_index[key][1], "last": old_index[key][2],
                         "reuse": True}

    # ---- assemble ---------------------------------------------------------
    packed = bytearray()
    new_index: dict[str, list[int]] = {}
    new_charts: list[dict] = []
    for key in sorted(plan):
        entry = plan[key]
        new_index[key] = [len(packed), entry["count"], entry["last"]]
        packed += entry["block"]
        row = dict(old_charts.get(key, {}))
        row.update({"key": key, "musicId": key.split(":")[0]})
        if entry.get("meta"):
            row.update(entry["meta"])
        row["fullComboNoteCount"] = entry["count"]
        row["provenance"] = entry["provenance"]
        if not row.get("title") and key in exact_index:
            print(f"\nFAILED: {key} is new in the exact pack but has no metadata here.")
            return 1
        new_charts.append(row)
    new_blob = bytes(packed)

    # ---- safety -----------------------------------------------------------
    broken = [key for key, chart in old_charts.items()
              if old_provenance[key] == EXACT
              and old_blocks[key] != plan[key]["block"]]
    if broken:
        print(f"\nFAILED: {len(broken)} exact chart(s) would change bytes: {broken[:5]}")
        return 1
    lost = sorted(set(old_charts) - set(new_index))
    if lost:
        print(f"\nFAILED: {len(lost)} chart(s) would be removed: {lost[:5]}")
        return 1
    problems = validate_bundle(new_charts, new_index, new_blob)
    if problems:
        print(f"\nFAILED validation ({len(problems)} problem(s)); nothing written:")
        for problem in problems[:15]:
            print(f"  {problem}")
        return 1

    # ---- report -----------------------------------------------------------
    provisional_now = sorted(k for k in new_index
                             if plan[k]["provenance"] == PROVISIONAL)
    for key in upgraded:
        print(f"  upgraded  {key} provisional -> exact")
    for key in added:
        row = plan[key]["meta"]
        print(f"  + {key:12} {row['difficulty']:7} Lv.{row['difficultyLevel']:<3}"
              f" {plan[key]['count']:5} notes  provisional  {row['title']}")
    for name in skipped_unplayable:
        print(f"  skipped   {name} (not in the public playable catalogue)")

    songs_after = len({row["musicId"] for row in new_charts})
    print(f"\nvalidated  {len(new_charts)} charts, {songs_after} songs, {len(new_blob)} bytes"
          f"  ({len(provisional_now)} provisional, {len(new_charts)-len(provisional_now)} exact)")

    unchanged = (new_blob == old_blob
                 and {k: list(v) for k, v in old_index.items()} == new_index
                 and all(old_charts.get(r["key"]) == r for r in new_charts))
    if unchanged:
        print("No change.")
        return 0
    if not args.apply:
        print("Dry run. Nothing was written; pass --apply to write.")
        return 0

    bundle["charts"] = new_charts
    bundle["index"] = new_index
    CHARTS_JSON.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    CHARTS_BIN.write_bytes(new_blob)
    print(f"wrote {CHARTS_JSON}\nwrote {CHARTS_BIN}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
