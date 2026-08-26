"""Emit Python chart scores across the note-count range for parity testing."""
from __future__ import annotations

import argparse
import os, json, random, sys
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
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'tests' / 'fixtures')
    parser.add_argument('--charts', type=int, default=24)
    parser.add_argument('--teams-per-chart', type=int, default=4)
    parser.add_argument('--seed', type=int, default=20260824)
    args = parser.parse_args()
    project = args.project or default_project()
    args.out.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(project))
    from app.paths import app_data_dir
    from app.config.loader import config_dir
    from app.data.database import connect
    from app.data.models import Card, LeaderOutfit
    from app.data.repository import Repository
    from app.engine.chart_score import _chart_pack, materialize, score_order

    repo = Repository(connect(app_data_dir() / 'holodream.sqlite'))
    cards, leaders = [], []
    for row in repo.db.execute('select * from cards where payload is not null order by card_id'):
        payload = json.loads(row['payload'])
        bloom = max((int(b.get('potential', 0)) for b in payload.get('potential_data', [])), default=0)
        payload['selected_bloom'] = bloom
        stats = next((b.get('ref_stats_lv80') or {} for b in payload.get('potential_data', [])
                      if int(b.get('potential', -1)) == bloom), {})
        cards.append(Card(row['card_id'], row['talent_id'], row['name'], row['type'] or '',
                          row['generation'] or '', stats.get('performance', row['performance']),
                          stats.get('technique', row['technique']), stats.get('sense', row['sense']),
                          row['title'] or '', payload))
    for row in repo.db.execute('select * from leader_outfits where payload is not null order by leader_id'):
        payload = json.loads(row['payload'])
        payload['selected_bloom'] = max((int(b.get('potential', 0)) for b in payload.get('potential_data', [])), default=0)
        leaders.append(LeaderOutfit(row['leader_id'], row['talent_id'], row['name'], payload))

    catalog = json.loads((config_dir() / 'chart_catalog.json').read_text(encoding='utf-8'))
    pack = _chart_pack()
    available = [c for c in catalog['charts'] if c['key'] in pack['index']]
    sized = sorted(((len(materialize(c)[0]), c) for c in available), key=lambda x: x[0])

    # Span the whole note-count range, then sample the rest.
    random.seed(args.seed)
    picks = [sized[0], sized[len(sized) // 4], sized[len(sized) // 2], sized[3 * len(sized) // 4], sized[-1]]
    picks += random.sample(sized, max(0, args.charts - len(picks)))

    cases = []
    for note_count, chart in picks:
        timeline = materialize(chart)
        for _ in range(args.teams_per_chart):
            members = sorted(random.sample(range(len(cards)), 5))
            leader_index = random.randrange(len(leaders))
            result = score_order(tuple(cards[i] for i in members), leaders[leader_index], chart, timeline)
            cases.append({
                'chartKey': chart['key'], 'noteCount': note_count,
                'cardIds': [cards[i].card_id for i in members],
                'leaderId': leaders[leader_index].leader_id,
                'projectedScore': result.projected_score,
                'totalPower': result.total_power,
                'perfectNoteScore': result.perfect_note_score,
            })
    path = args.out / 'chart_score.json'
    path.write_text(json.dumps(cases, ensure_ascii=False), encoding='utf-8')
    print('%d cases across %d charts (%d-%d notes)'
          % (len(cases), len(picks), min(n for n, _ in picks), max(n for n, _ in picks)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
