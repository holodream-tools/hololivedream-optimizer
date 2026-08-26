"""Emit the official member-portrait URLs, keyed by talent.

Portraits belong to a MEMBER, not to a card, so a newly released card of an
existing member already has one. They are hot-linked from the official CDN
rather than copied: the file stays where it is published, cached for a year.

Usage:  python3 tools/export_portraits.py [--project PATH] [--out PATH]
"""
from __future__ import annotations

import argparse
import os
import json
import re
import sys
from pathlib import Path

# The Python project is the source of the game data. Resolved as a sibling of
# this repository by default; override with HOLODREAM_PROJECT or --project.
def default_project() -> Path:
    override = os.environ.get('HOLODREAM_PROJECT')
    if override: return Path(override).expanduser()
    return Path(__file__).resolve().parent.parent.parent / 'hololivedream_optimizer'


def slug(value: str) -> str:
    """The key `fetch_official_portraits` builds from the site's holomem id."""
    return re.sub(r'[^a-z0-9]', '', value.lower())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, default=None,
                        help='path to the hololivedream_optimizer checkout')
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'public' / 'data')
    args = parser.parse_args()
    project = args.project or default_project()
    args.out.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(project))
    from app.paths import app_data_dir
    from app.data.database import connect
    from app.providers.official import fetch_official_portraits

    portraits = fetch_official_portraits()
    db = connect(app_data_dir() / 'holodream.sqlite')

    # Map each card to a portrait through its talent, the way the desktop
    # provider does: strip the rarity suffix and any costume variant.
    by_card: dict[str, str] = {}
    unmatched: list[str] = []
    for row in db.execute('select card_id from cards order by card_id'):
        card_id = row['card_id']
        key = slug(card_id.rsplit('_', 1)[0].replace('_swim', ''))
        url = portraits.get(key)
        if url: by_card[card_id] = url
        else: unmatched.append(card_id)

    payload = {
        'source': 'https://www.hololive-dreams.com/en',
        'note': 'Official member portraits, hot-linked. Keyed by talent, so new '
                'cards of an existing member resolve without a redeploy.',
        'byTalentSlug': portraits,
        'byCard': by_card,
    }
    path = args.out / 'portraits.json'
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('%d talents, %d cards mapped, %d unmatched (%.0f KB)'
          % (len(portraits), len(by_card), len(unmatched), path.stat().st_size / 1024))
    for card_id in unmatched[:8]: print('   unmatched:', card_id)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
