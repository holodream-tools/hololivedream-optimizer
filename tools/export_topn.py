"""Emit the Python reference Top-N for a card subset, to pin the web sweep.

Uses a subset so the single-threaded reference finishes quickly; the point is
the ordering rule and the tie-break, not the size of the search.
"""
from __future__ import annotations

import argparse
import os
import json
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
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent / 'tests' / 'fixtures')
    parser.add_argument('--cards', type=int, default=18)
    parser.add_argument('--leaders', type=int, default=12)
    parser.add_argument('--limit', type=int, default=50)
    args = parser.parse_args()
    project = args.project or default_project()
    args.out.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(project))
    from app.paths import app_data_dir
    from app.data.database import connect
    from app.data.models import Card, LeaderOutfit
    from app.data.repository import Repository
    from app.engine.optimizer_fast import optimize
    from app.engine.overall_score import evaluate_team

    repo = Repository(connect(app_data_dir() / 'holodream.sqlite'))
    cards, leaders = [], []
    for row in repo.db.execute('select * from cards where payload is not null order by card_id'):
        payload = json.loads(row['payload'])
        # Max Bloom everywhere, matching what the web fixture will request.
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

    cards = cards[:args.cards]
    leaders = leaders[:args.leaders]
    rows = optimize(cards, leaders, evaluate_team, limit=args.limit)
    scores = [result.expected_index for result, _, _ in rows]
    payload = {
        'cardIds': [c.card_id for c in cards],
        'leaderIds': [l.leader_id for l in leaders],
        'limit': args.limit,
        'exactTiesInTopN': len(scores) - len(set(scores)),
        'top': [{'value': result.expected_index,
                 'members': [c.card_id for c in members],
                 'leaderId': leader.leader_id}
                for result, members, leader in rows],
    }
    path = args.out / 'top_n.json'
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    print('%d cards x %d leaders -> Top-%d, %d exact ties inside it'
          % (len(cards), len(leaders), len(rows), payload['exactTiesInTopN']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
