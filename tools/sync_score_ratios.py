"""Refresh the per-chart score divisors from Hololive Dreams Lab.

The divisor turns a team's total power into its PERFECT note value, so it sets
the scale of every song score the site reports. It is a third-party estimate
that gets recalibrated as people measure more charts, and ours were frozen at
whenever someone last ran this by hand.

A different source from the charts themselves, and a much easier one: it is a
public site, fetched over HTTP, with no licence question hanging over it. That
is why this half is scheduled and the chart half is not -- see DATA_SOURCES.md
in the desktop project.

Writes public/data/charts.json in place, touching only scoreRatioEstimated.

    python3 tools/sync_score_ratios.py           # report what would change
    python3 tools/sync_score_ratios.py --apply   # write it
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

SIMULATOR = "https://dreams.wf-calc.net/simulator"
ORIGIN = "https://dreams.wf-calc.net"
CHARTS = Path(__file__).resolve().parents[1] / "public" / "data" / "charts.json"

# The divisors live inside a lazily-loaded page chunk, so getting to them means
# walking the same three hops a browser would: page -> index bundle -> the
# simulator chunk. Hashed filenames change on every upstream deploy, which is
# why each hop is matched rather than hardcoded.
INDEX_PATTERN = re.compile(r'src="(/assets/index-[^"]+\.js)"')
ASSET_PATTERN = re.compile(r"assets/UnitSimulatorPage-[A-Za-z0-9_-]+\.js")
ROW_PATTERN = re.compile(
    r'"key":"([^"]+)","songKey":"([^"]+)".*?'
    r'"difficulty":"([^"]+)".*?"scoreRatio":([0-9.]+).*?'
    r'"scoreCalibrationSource":"([^"]+)"',
)

# Below this, a change is upstream re-running its own arithmetic rather than
# saying anything new, and is not worth a commit.
EPSILON = 1e-9


def download(url: str) -> str:
    request = urllib.request.Request(url, headers={
        "User-Agent": "hololivedream-optimizer score-ratio sync",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def fetch_ratios() -> tuple[dict[tuple[str, str], float], str]:
    page = download(SIMULATOR)
    index = INDEX_PATTERN.search(page)
    if not index:
        raise SystemExit("the index asset was not found; the upstream page changed")
    asset = ASSET_PATTERN.search(download(ORIGIN + index.group(1)))
    if not asset:
        raise SystemExit("the simulator asset was not found; the upstream page changed")
    url = f"{ORIGIN}/{asset.group(0)}"
    ratios = {
        (song, difficulty.casefold()): float(ratio)
        for _, song, difficulty, ratio, _ in ROW_PATTERN.findall(download(url))
    }
    if not ratios:
        raise SystemExit("no score ratios parsed; the upstream format changed")
    return ratios, url


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the file")
    args = parser.parse_args()

    ratios, source = fetch_ratios()
    bundle = json.loads(CHARTS.read_text(encoding="utf-8"))
    # A pristine copy to diff against before writing; see the invariant below.
    before = json.loads(CHARTS.read_text(encoding="utf-8"))
    charts = bundle["charts"]
    print(f"upstream  {len(ratios)} divisors from {source}")
    print(f"local     {len(charts)} charts")

    changes: list[tuple[str, float, float]] = []
    missing: list[str] = []
    for chart in charts:
        ratio = ratios.get((chart["musicId"], chart["difficulty"].casefold()))
        if ratio is None:
            missing.append(chart["key"])
            continue
        current = chart.get("scoreRatioEstimated")
        if current is None or abs(current - ratio) > EPSILON:
            changes.append((chart["key"], current, ratio))
            chart["scoreRatioEstimated"] = ratio

    # Partial coverage means the parse half-worked, and half-worked is the one
    # outcome worth refusing: it would leave the site with a mix of fresh and
    # stale divisors and no way to tell which is which.
    if missing:
        print(f"\nFAILED: {len(missing)} charts have no upstream divisor: {missing[:5]}")
        print("Refusing to write a partial update.")
        return 1

    if not changes:
        print("\nNo change: every divisor already matches upstream.")
        return 0

    print(f"\n{len(changes)} divisors changed:")
    for key, was, now in changes[:15]:
        print(f"  {key:14} {was} -> {now}")
    if len(changes) > 15:
        print(f"  … and {len(changes) - 15} more")

    if not args.apply:
        print("\nDry run. Nothing was written; pass --apply to write.")
        return 0

    # This is the one automated path with permission to push, and it writes the
    # same file the chart data lives in. The loop above only ever assigns
    # scoreRatioEstimated, so the charts cannot move -- but "cannot" is worth
    # checking rather than trusting, because the failure it guards against is a
    # scheduled job silently rewriting the song list.
    after = json.loads(json.dumps(bundle))
    for chart in after["charts"]:
        chart.pop("scoreRatioEstimated", None)
    for chart in before["charts"]:
        chart.pop("scoreRatioEstimated", None)
    if after["charts"] != before["charts"]:
        print("\nFAILED: something other than the divisors changed. Refusing to write.")
        return 1

    bundle["scoreRatioSource"] = SIMULATOR
    CHARTS.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nwrote {CHARTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
