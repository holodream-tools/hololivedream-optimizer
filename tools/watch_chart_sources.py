"""Watch the public Holodori sources and report; never write anything.

The chart timelines behind 歌曲／順序 come from Holodori Optimizer, whose
licence position is unresolved (see DATA_SOURCES.md in the desktop project).
Until that has an answer, this repository watches rather than syncs: it fetches
what is publicly available, compares it against the data the site is actually
serving, and says what it found.

It cannot write. There is no --apply, no file is opened for writing, and the
workflow that runs it has read-only contents permission. Making it update the
site is a deliberate change to three separate things, not a flag.

The comparison is against public/data/charts.json -- the bundle the deployed
site loads -- because "is there better data than what our users get" is the
question worth waking up for.

    python3 tools/watch_chart_sources.py
    python3 tools/watch_chart_sources.py --json report.json
"""
from __future__ import annotations

import argparse
import io
import json
import re
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

REPO = "ace-ks-dev/holodori-optimizer"
API = f"https://api.github.com/repos/{REPO}"
PAGES = "https://ace-ks-dev.github.io/holodori-optimizer/index.html"
MANIFEST = f"https://raw.githubusercontent.com/{REPO}/main/release.json"
CHARTS = Path(__file__).resolve().parents[1] / "public" / "data" / "charts.json"

PACK_ASSIGNMENT = re.compile(r"globalThis\.HOLODORI_CHART_PACK_R\d+\s*=")
PRERELEASE_TAG = re.compile(r"-(?:alpha|beta|rc|pre)", re.IGNORECASE)
# Only the fields the shipped bundle carries; there is nothing to say about
# fields the site never exported.
FIELDS = ("title", "difficulty", "difficultyLevel", "fullComboNoteCount",
          "playingSeconds", "musicId")
CHURN_LIMIT = 0.10


def fetch(url: str, accept: str = "application/vnd.github+json") -> bytes:
    request = urllib.request.Request(url, headers={
        "User-Agent": "hololivedream-optimizer chart watch", "Accept": accept})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def decode_at(source: str, at: int):
    value, _ = json.JSONDecoder().raw_decode(source[at:].lstrip())
    return value


def extract(sources: dict[str, str]) -> tuple[list[dict], dict]:
    """Charts and timeline index, from whichever member of the source holds them."""
    charts = index = None
    for source in sources.values():
        if charts is None:
            at = source.find("BUNDLED_CHARTS = ")
            if at >= 0:
                charts = decode_at(source, at + len("BUNDLED_CHARTS = "))["charts"]
        if index is None:
            match = PACK_ASSIGNMENT.search(source)
            if match:
                index = decode_at(source, match.end()).get("index", {})
    if charts is None:
        raise ValueError("BUNDLED_CHARTS not found")
    return charts, index or {}


def pages_sources() -> dict[str, str]:
    return {"index.html": fetch(PAGES, "text/html").decode("utf-8", "replace")}


def release_sources(release: dict) -> dict[str, str]:
    assets = [a for a in release.get("assets", []) if a["name"].endswith(".zip")]
    if not assets:
        raise ValueError("no .zip asset")
    blob = fetch(assets[0]["browser_download_url"], "application/octet-stream")
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        return {n: archive.read(n).decode("utf-8", "replace")
                for n in archive.namelist() if n.lower().endswith((".html", ".js"))}


def candidates(limit: int) -> list[dict]:
    found = [{"name": "pages", "kind": "pages", "load": pages_sources}]
    try:
        releases = json.loads(fetch(f"{API}/releases"))
    except urllib.error.URLError as cause:
        print(f"  (could not list releases: {cause})")
        return found
    for release in releases[:limit]:
        tag = release["tag_name"]
        pre = bool(release.get("prerelease") or release.get("draft")
                   or PRERELEASE_TAG.search(tag))
        found.append({"name": f"release:{tag}",
                      "kind": "prerelease" if pre else "release",
                      "load": (lambda r=release: release_sources(r))})
    return found


def playable(charts: list[dict], index: dict) -> list[dict]:
    """Only charts that have a timeline, which is what the site can serve.

    Upstream's catalogue carries metadata-only rows -- two charts marked
    timelineAvailable:false, plus a four-row m9999 placeholder -- and the
    export has always dropped them. Comparing raw catalogue counts against the
    exported bundle made every run report six phantom charts as "newer", which
    is how a weekly watcher teaches people to ignore it.
    """
    return [c for c in charts if c["key"] in index]


def compare(charts: list[dict], index: dict, current: list[dict]) -> dict:
    charts = playable(charts, index)
    now = {c["key"]: c for c in charts}
    was = {c["key"]: c for c in current}
    changed = [k for k in set(now) & set(was)
               if any(now[k].get(f) != was[k].get(f) for f in FIELDS)]
    shared = max(1, len(set(now) & set(was)))
    return {
        "songs": len({c["musicId"] for c in charts}),
        "songs_current": len({c["musicId"] for c in current}),
        "songs_missing": sorted({c["musicId"] for c in current}
                                - {c["musicId"] for c in charts}),
        "charts": len(now), "charts_current": len(was),
        "timelines": len(index),
        "added": sorted(set(now) - set(was)),
        "missing": sorted(set(was) - set(now)),
        "changed": sorted(changed), "churn": len(changed) / shared,
    }


def classify(diff: dict) -> tuple[str, str]:
    if diff["missing"] or diff["songs_missing"]:
        return "regression", (f"has {len(diff['missing'])} fewer charts and "
                              f"{len(diff['songs_missing'])} fewer songs than the site")
    if diff["churn"] > CHURN_LIMIT:
        return "review", f"{len(diff['changed'])} charts changed ({diff['churn']:.0%})"
    if not (diff["added"] or diff["changed"]):
        return "same", "matches what the site serves"
    return "newer", (f"{len(diff['added'])} charts the site does not have, "
                     f"{len(diff['changed'])} changed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--releases", type=int, default=4)
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    bundle = json.loads(CHARTS.read_text(encoding="utf-8"))
    current = bundle["charts"]
    print(f"site serves  {len(current)} charts, "
          f"{len({c['musicId'] for c in current})} songs")

    try:
        declared = json.loads(fetch(MANIFEST, "application/json"))
        print("\nupstream manifest (main/release.json)")
        for key in ("applicationVersion", "canonicalDataVersion", "chartVersion",
                    "songs", "chartMetadataRows", "exactTimelines"):
            if key in declared:
                print(f"  {key:22} {declared[key]}")
    except (urllib.error.URLError, json.JSONDecodeError) as cause:
        declared = None
        print(f"\n  (manifest unavailable: {cause})")

    report = {"site": {"charts": len(current)}, "manifest": declared, "candidates": []}
    print("\ncandidates")
    for candidate in candidates(args.releases):
        name = candidate["name"]
        try:
            charts, index = extract(candidate["load"]())
        except Exception as cause:                      # noqa: BLE001
            print(f"  [BROKEN    ] {name}: {type(cause).__name__}: {cause}")
            report["candidates"].append({"name": name, "kind": candidate["kind"],
                                         "verdict": "broken", "why": str(cause)})
            continue
        diff = compare(charts, index, current)
        verdict, why = classify(diff)
        print(f"  [{verdict.upper():10}] {name:26} "
              f"songs {diff['songs']:3}  charts {diff['charts']:3}  "
              f"timelines {diff['timelines']:3}   {why}")
        report["candidates"].append({"name": name, "kind": candidate["kind"],
                                     "verdict": verdict, "why": why, "diff": diff})

    newer = [c for c in report["candidates"] if c["verdict"] == "newer"]
    report["newer"] = [c["name"] for c in newer]
    print("\n" + "=" * 70)
    if newer:
        print(f"ATTENTION: {[c['name'] for c in newer]} carry charts the site does not.")
        print("This tool does not update anything. Applying it is a manual decision,")
        print("and the licence question is still open -- see DATA_SOURCES.md.")
    else:
        print("No action: nothing public is more complete than what the site serves.")

    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=1),
                             encoding="utf-8")
        print(f"report written to {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
