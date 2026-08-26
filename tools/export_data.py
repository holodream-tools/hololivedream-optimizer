"""Emit the web app's data bundles from the Python project's database.

The Python project stays the source of truth for game data. This exports the
already-flattened `CardFacts` rather than raw card payloads, so the browser
never has to re-implement Bloom selection or skill lookup.

Usage:  python3 tools/export_data.py [--project PATH] [--out PATH]
"""
from __future__ import annotations

import argparse
import os
import base64
import json
import sys
from pathlib import Path

# The Python project is the source of the game data. Resolved as a sibling of
# this repository by default; override with HOLODREAM_PROJECT or --project.
def default_project() -> Path:
    override = os.environ.get('HOLODREAM_PROJECT')
    if override: return Path(override).expanduser()
    return Path(__file__).resolve().parent.parent.parent / 'hololivedream_optimizer'

# Only the chart fields the engine or the song picker actually reads. The full
# catalogue is 13 MB of metadata the browser has no use for.
CHART_FIELDS = ('key', 'musicId', 'title', 'difficulty', 'difficultyLevel',
                'scoreRatioEstimated', 'fullComboNoteCount', 'playingSeconds')


def load_project(project: Path):
    sys.path.insert(0, str(project))
    from app.paths import app_data_dir
    from app.data.database import connect
    from app.data.models import Card, LeaderOutfit
    from app.data.repository import Repository

    repo = Repository(connect(app_data_dir() / 'holodream.sqlite'))
    cards, leaders = [], []
    for row in repo.db.execute('select * from cards where payload is not null order by card_id'):
        payload = json.loads(row['payload'])
        # The web app lets the player choose a Bloom per card, so every Bloom's
        # data has to travel; `selected_bloom` here is only a placeholder.
        payload['selected_bloom'] = 0
        cards.append(Card(row['card_id'], row['talent_id'], row['name'], row['type'] or '',
                          row['generation'] or '', row['performance'], row['technique'],
                          row['sense'], row['title'] or '', payload))
    for row in repo.db.execute('select * from leader_outfits where payload is not null order by leader_id'):
        payload = json.loads(row['payload'])
        leaders.append(LeaderOutfit(row['leader_id'], row['talent_id'], row['name'], payload))
    return repo, cards, leaders


def export_cards(cards, leaders) -> dict:
    """Per-Bloom skill data, pre-resolved, so the client only indexes into it."""
    out_cards = []
    for card in cards:
        blooms = {}
        for row in (card.payload or {}).get('potential_data', []):
            potential = int(row.get('potential', -1))
            stats = row.get('ref_stats_lv80') or {}
            blooms[potential] = {
                'performance': int(stats.get('performance', card.performance)),
                'technique': int(stats.get('technique', card.technique)),
                'sense': int(stats.get('sense', card.sense)),
                'support': row.get('support_skill') or None,
                'active': row.get('center_skill') or None,
                'special': row.get('special_skill') or None,
            }
        out_cards.append({
            'id': card.card_id, 'talent': card.talent_id, 'name': card.name,
            'title': card.title, 'type': card.type, 'generation': card.generation,
            'maxBloom': max(blooms) if blooms else 0,
            'blooms': blooms,
        })
    out_leaders = []
    for leader in leaders:
        data = leader.buffs or {}
        outfits = {}
        for row in data.get('potential_data', []):
            outfits[int(row.get('potential', -1))] = row.get('value')
        out_leaders.append({
            'id': leader.leader_id, 'talent': leader.talent_id, 'name': leader.name,
            'maxBloom': max(outfits) if outfits else 0,
            'outfits': outfits,
        })
    return {'cards': out_cards, 'leaders': out_leaders}


def export_charts(project: Path) -> tuple[dict, bytes]:
    sys.path.insert(0, str(project))
    from app.config.loader import config_dir
    catalog = json.loads((config_dir() / 'chart_catalog.json').read_text(encoding='utf-8'))
    pack = json.loads((config_dir() / 'chart_pack.json').read_text(encoding='utf-8'))
    index = pack['index']
    charts = [{field: chart.get(field) for field in CHART_FIELDS}
              for chart in catalog['charts'] if chart['key'] in index]
    slim = {
        'source': catalog.get('source'),
        'scoreRatioSource': catalog.get('score_ratio_source'),
        'charts': charts,
        'index': {key: index[key] for key in index},
    }
    return slim, base64.b64decode(pack['data'])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, default=None,
                        help='path to the hololivedream_optimizer checkout')
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'public' / 'data')
    args = parser.parse_args()
    project = args.project or default_project()
    args.out.mkdir(parents=True, exist_ok=True)

    repo, cards, leaders = load_project(project)
    bundle = export_cards(cards, leaders)
    (args.out / 'cards.json').write_text(json.dumps(bundle, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    charts, blob = export_charts(project)
    (args.out / 'charts.json').write_text(json.dumps(charts, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (args.out / 'charts.bin').write_bytes(blob)

    for name in ('cards.json', 'charts.json', 'charts.bin'):
        size = (args.out / name).stat().st_size
        print('  %-14s %8.1f KB' % (name, size / 1024))
    print('cards: %d, leaders: %d, charts: %d' % (len(bundle['cards']), len(bundle['leaders']), len(charts['charts'])))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
