"""Copy locally cached card artwork into the web project.

The desktop app downloads these to its own cache on manual update; this only
moves what is already on this machine into the dev preview. Artwork is kept in a
separate folder and referenced by a per-card filename so the whole image layer
can be swapped or dropped without touching the card data.
"""
from __future__ import annotations

import argparse
import os
import json
import shutil
import sys
from pathlib import Path

# The Python project is the source of the game data. Resolved as a sibling of
# this repository by default; override with HOLODREAM_PROJECT or --project.
def default_project() -> Path:
    override = os.environ.get('HOLODREAM_PROJECT')
    if override: return Path(override).expanduser()
    return Path(__file__).resolve().parent.parent.parent / 'hololivedream_optimizer'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, default=None,
                        help='path to the hololivedream_optimizer checkout')
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'public' / 'cards')
    args = parser.parse_args()
    project = args.project or default_project()

    sys.path.insert(0, str(project))
    from app.paths import app_data_dir
    from app.data.database import connect

    db = connect(app_data_dir() / 'holodream.sqlite')
    args.out.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict] = {}
    copied = missing = 0
    for row in db.execute('''select c.card_id, i.local_path, i.source_url, i.width, i.height
                             from cards c join images i on i.image_id = c.image_id
                             order by c.card_id'''):
        source = Path(row['local_path'])
        if not source.exists():
            missing += 1
            continue
        name = f"{row['card_id']}{source.suffix}"
        shutil.copyfile(source, args.out / name)
        manifest[row['card_id']] = {
            'file': name,
            'width': row['width'],
            'height': row['height'],
            'sourceUrl': row['source_url'],
        }
        copied += 1

    (args.out.parent / 'data' / 'images.json').write_text(
        json.dumps({'cards': manifest}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    total = sum((args.out / entry['file']).stat().st_size for entry in manifest.values())
    print('copied %d images (%.0f KB), %d missing' % (copied, total / 1024, missing))
    sizes = {(entry['width'], entry['height']) for entry in manifest.values()}
    print('sizes:', sorted(sizes))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
