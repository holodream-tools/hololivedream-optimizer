"""Map every card id to its own artwork URL on horodori.com.

The bundled `images.json` is written from the desktop app's local cache, so it
only ever knows the cards that existed when someone last ran
tools/export_images.py. Card DATA hot-reloads from the upstream dataset at
runtime; card ART could not, because the only catalogue that has it sends no
CORS headers and a browser cannot read it.

CI has no such limit. This runs where fetching is allowed, resolves each card's
real artwork -- costume and event variants included, which no rule over the
card id can derive -- and writes the answer into the site's own data directory
for the browser to read.

    card id                     artwork filename on horodori.com
    shirakami_fubuki_5      ->  shirakami-fubuki-5star.webp
    shirakami_fubuki_swim_5 ->  shirakami-fubuki-nagisa-twinkle-5star.webp

The second is why this file exists: `ImageSource.guessedArtUrl` turns the id
into the first shape and is right for base cards, but a costume's filename
carries an edited theme name that is nowhere in the id.

Joined on the CARD NAME, which both sources carry verbatim -- not on the
character, whose spelling they disagree about (upstream writes こぼ・かなえる
where horodori writes コボ・カナエル). See `match_cards` for the two-pass rule
and why the fuzzy half cannot silently take another card's picture.

    python3 tools/export_remote_images.py           # report what would change
    python3 tools/export_remote_images.py --apply   # write it
    python3 tools/export_remote_images.py --apply --full   # re-resolve every card
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import json
import re
import time
import unicodedata
import urllib.request
from pathlib import Path

UPSTREAM = "https://raw.githubusercontent.com/konono/holodreams_solver/main/data/cards.json"
ORIGIN = "https://www.horodori.com"
CATALOGUE = f"{ORIGIN}/cards"
OUT = Path(__file__).resolve().parents[1] / "public" / "data" / "remote-images.json"

LD_JSON = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
# A detail page shows the card's own art at `medium/` and its sibling cards as
# `thumbnails/`, so the size is what identifies the subject rather than the
# order things appear in the markup.
MEDIUM = re.compile(r"/images/cards/medium/[A-Za-z0-9._-]+\.webp(?:\?v=[A-Za-z0-9]+)?")

# Below this, two names are different cards that happen to read alike; see
# `match_cards`. 0.9 accepts のほほんドーナツパーティ♪ against the same card
# written with its long vowel (0.963) and rejects ぽわぽわドーナツパーティー♪,
# a different member's card in the same set (0.70).
SIMILAR_ENOUGH = 0.9

# Polite spacing between detail-page requests. Only reached for cards that are
# not already mapped, so a scheduled run normally makes none at all.
DELAY_SECONDS = 0.3


def download(url: str) -> str:
    request = urllib.request.Request(url, headers={
        "User-Agent": "hololivedream-optimizer remote-image sync",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def normalise(name: str) -> str:
    """Fold the punctuation the two sources spell differently.

    Upstream is not even self-consistent here: it writes Reaper's death flow
    with U+2019 and Reaper's Spike with U+0027.
    """
    folded = unicodedata.normalize("NFKC", name)
    for fancy, plain in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"')):
        folded = folded.replace(fancy, plain)
    return folded.strip()


def fetch_catalogue() -> dict[str, str]:
    """Every ★5 card horodori lists, as normalised name -> detail page URL.

    Read from the page's own JSON-LD ItemList rather than its markup: the list
    is complete, while the markup only carries the cards rendered above the
    fold.
    """
    listing: dict[str, str] = {}
    for block in LD_JSON.findall(download(CATALOGUE)):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        if data.get("@type") != "ItemList":
            continue
        for item in data.get("itemListElement", []):
            name, url = item.get("name"), item.get("url")
            # "ときのそら / ★5 / キュート" -- the rarity is the only part read.
            parts = [part.strip() for part in str(item.get("description", "")).split("/")]
            if not name or not url or len(parts) < 2 or "5" not in parts[1]:
                continue
            listing[normalise(name)] = url
    if not listing:
        raise SystemExit("no cards parsed from the catalogue; the upstream page changed")
    return listing


def match_cards(cards: list[dict], listing: dict[str, str]) -> tuple[dict[str, str], list[tuple], list[str]]:
    """Resolve each upstream card to a detail page URL.

    Two passes, and the order matters. Exact names are claimed first, so the
    fuzzy pass can only ever consider pages no card actually named. A
    near-miss is then accepted only when exactly one such page is close
    enough -- which is what stops モココ's card, whose name upstream spells
    with a long vowel horodori omits, from being handed フワワ's near-identical
    card from the same set.
    """
    resolved: dict[str, str] = {}
    claimed: set[str] = set()
    for card in cards:
        key = normalise(card.get("card_name", ""))
        if key in listing:
            resolved[card["id"]] = listing[key]
            claimed.add(key)

    fuzzy: list[tuple] = []
    unmatched: list[str] = []
    free = [name for name in listing if name not in claimed]
    for card in cards:
        if card["id"] in resolved:
            continue
        key = normalise(card.get("card_name", ""))
        close = difflib.get_close_matches(key, free, n=3, cutoff=SIMILAR_ENOUGH)
        if len(close) == 1:
            resolved[card["id"]] = listing[close[0]]
            fuzzy.append((card["id"], card.get("card_name", ""), close[0]))
            free.remove(close[0])
        else:
            unmatched.append(card["id"])
    return resolved, fuzzy, unmatched


def artwork_of(detail_url: str) -> str | None:
    """The card's own picture, absolute. None when the page shows none."""
    found = MEDIUM.search(download(detail_url))
    return ORIGIN + found.group(0) if found else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the file")
    parser.add_argument("--full", action="store_true",
                        help="re-resolve every card, not only the ones with no entry")
    args = parser.parse_args()

    cards = json.loads(download(UPSTREAM)).get("cards", [])
    cards = [card for card in cards if card.get("id") and card.get("card_name")]
    listing = fetch_catalogue()
    print(f"upstream  {len(cards)} cards")
    print(f"horodori  {len(listing)} ★5 cards catalogued")

    resolved, fuzzy, unmatched = match_cards(cards, listing)
    print(f"matched   {len(resolved)} to a detail page"
          f" ({len(fuzzy)} by near-name, {len(unmatched)} unmatched)")
    for card_id, ours, theirs in fuzzy:
        print(f"  near-name  {card_id}: {ours!r} -> {theirs!r}")
    for card_id in unmatched:
        print(f"  unmatched  {card_id}")

    previous: dict[str, str] = {}
    if OUT.exists():
        previous = json.loads(OUT.read_text(encoding="utf-8")).get("cards", {})

    # Only cards with no entry are fetched, so the scheduled run costs one
    # request in the ordinary case where nothing new has been released.
    wanted = [card_id for card_id in resolved if args.full or card_id not in previous]
    print(f"\nresolving {len(wanted)} card page(s)"
          f" ({len(previous)} already mapped)")

    mapping = dict(previous)
    added: list[tuple[str, str]] = []
    changed: list[tuple[str, str, str]] = []
    blank: list[str] = []
    for index, card_id in enumerate(sorted(wanted)):
        if index:
            time.sleep(DELAY_SECONDS)
        try:
            url = artwork_of(resolved[card_id])
        except Exception as cause:              # noqa: BLE001 - reported, not raised
            print(f"  FAILED {card_id}: {cause}")
            continue
        if not url:
            blank.append(card_id)
            continue
        if card_id not in mapping:
            added.append((card_id, url))
        elif mapping[card_id] != url:
            changed.append((card_id, mapping[card_id], url))
        mapping[card_id] = url

    # Entries for cards upstream has dropped would otherwise accumulate
    # forever, and each one is a URL the site would still be willing to load.
    stale = [card_id for card_id in mapping if card_id not in resolved]
    for card_id in stale:
        del mapping[card_id]

    for card_id, url in added:
        print(f"  added    {card_id} -> {url.rsplit('/', 1)[-1]}")
    for card_id, was, now in changed:
        print(f"  changed  {card_id}: {was.rsplit('/', 1)[-1]} -> {now.rsplit('/', 1)[-1]}")
    for card_id in blank:
        print(f"  no art   {card_id} (page carries no picture yet)")
    for card_id in stale:
        print(f"  removed  {card_id} (no longer in the upstream dataset)")

    print(f"\n{len(mapping)} / {len(cards)} cards mapped")

    if mapping == previous:
        print("No change: every card already points at the right picture.")
        return 0
    if not args.apply:
        print("Dry run. Nothing was written; pass --apply to write.")
        return 0

    OUT.write_text(json.dumps({
        "source": CATALOGUE,
        "note": "Card artwork URLs, hot-linked. Resolved in CI because the "
                "catalogue sends no CORS headers; see tools/export_remote_images.py.",
        "generated": datetime.datetime.now(datetime.timezone.utc)
                             .replace(microsecond=0).isoformat(),
        "cards": dict(sorted(mapping.items())),
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
