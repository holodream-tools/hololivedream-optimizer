"""Emit ground-truth values from the Python engine for cross-language parity tests.

Every random team also gets random per-card Bloom levels, so the fixtures
exercise Bloom selection rather than only the max-Bloom path.
"""
from __future__ import annotations

import argparse
import os
import json
import random
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
    parser.add_argument('--teams', type=int, default=400)
    parser.add_argument('--seed', type=int, default=20260824)
    args = parser.parse_args()
    project = args.project or default_project()
    args.out.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(project))
    from app.paths import app_data_dir
    from app.data.database import connect
    from app.data.models import Card, LeaderOutfit
    from app.data.repository import Repository
    from app.engine.overall_score import evaluate_team

    repo = Repository(connect(app_data_dir() / 'holodream.sqlite'))
    raw_cards, raw_leaders = [], []
    for row in repo.db.execute('select * from cards where payload is not null order by card_id'):
        raw_cards.append((row, json.loads(row['payload'])))
    for row in repo.db.execute('select * from leader_outfits where payload is not null order by leader_id'):
        raw_leaders.append((row, json.loads(row['payload'])))

    def card_at(index: int, bloom: int) -> Card:
        row, payload = raw_cards[index]
        chosen = dict(payload); chosen['selected_bloom'] = bloom
        stats = next((b.get('ref_stats_lv80') or {} for b in payload.get('potential_data', [])
                      if int(b.get('potential', -1)) == bloom), {})
        return Card(row['card_id'], row['talent_id'], row['name'], row['type'] or '',
                    row['generation'] or '', stats.get('performance', row['performance']),
                    stats.get('technique', row['technique']), stats.get('sense', row['sense']),
                    row['title'] or '', chosen)

    def leader_at(index: int, bloom: int) -> LeaderOutfit:
        row, payload = raw_leaders[index]
        chosen = dict(payload); chosen['selected_bloom'] = bloom
        return LeaderOutfit(row['leader_id'], row['talent_id'], row['name'], chosen)

    def blooms_of(entries, index):
        return sorted(int(b.get('potential', 0)) for b in entries[index][1].get('potential_data', []))

    random.seed(args.seed)
    cases = []
    for _ in range(args.teams):
        members = sorted(random.sample(range(len(raw_cards)), 5))
        card_blooms = [random.choice(blooms_of(raw_cards, i) or [0]) for i in members]
        leader_index = random.randrange(len(raw_leaders))
        leader_bloom = random.choice(blooms_of(raw_leaders, leader_index) or [0])
        team = tuple(card_at(i, b) for i, b in zip(members, card_blooms))
        result = evaluate_team(team, leader_at(leader_index, leader_bloom))
        cases.append({
            'cardIds': [raw_cards[i][0]['card_id'] for i in members],
            'cardBlooms': card_blooms,
            'leaderId': raw_leaders[leader_index][0]['leader_id'],
            'leaderBloom': leader_bloom,
            'expectedIndex': result.expected_index,
            'totalPower': result.total_power,
            'activeScoreUp': result.active_expected_score_up,
        })

    path = args.out / 'overall_score.json'
    path.write_text(json.dumps(cases, ensure_ascii=False), encoding='utf-8')
    print('%d cases -> %s (%.0f KB)' % (len(cases), path.name, path.stat().st_size / 1024))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
