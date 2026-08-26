/** 自選隊伍 — score any five cards you pick, with the contributions broken out. */
import { useMemo, useState } from 'react';
import { cardFacts, outfitTable } from '../engine/precompute';
import { expectedIndexOf, leaderPowerAndSupport, makeMemberState, memberPart } from '../engine/overallScore';
import { attributeStyle } from '../ui/theme';
import type { AppState } from '../lib/appState';

export function ManualTeamPage({ state }: { state: AppState }) {
  const { bundle, images, owned, unlockedLeaders, inventory } = state;
  const [picked, setPicked] = useState<string[]>([]);
  const [leaderId, setLeaderId] = useState('');
  const [query, setQuery] = useState('');

  const evaluation = useMemo(() => {
    if (picked.length !== 5 || !leaderId) return null;
    const members = picked.map((id) => owned.find((card) => card.id === id)!).filter(Boolean);
    if (members.length !== 5) return null;
    const leader = unlockedLeaders.find((row) => row.id === leaderId);
    if (!leader) return null;
    const talents = new Set(members.map((card) => card.talent));
    if (talents.size !== 5) return { duplicate: true } as const;

    const facts = cardFacts(members, members.map((card) => inventory.get(card.id)!.bloom));
    const outfits = outfitTable([leader], [Math.min(inventory.get(leader.id.replace(/^outfit:/, ''))?.bloom ?? leader.maxBloom, leader.maxBloom)]);
    const payload = outfits.payloads[outfits.signatureOf[0]];
    const memberState = memberPart(facts, [0, 1, 2, 3, 4], makeMemberState());
    const [totalPower, leaderSupport] = leaderPowerAndSupport(payload, memberState);
    const basePower = facts.reduce((sum, fact) => sum + fact.total, 0);
    return {
      duplicate: false as const,
      index: expectedIndexOf(payload, memberState),
      basePower, totalPower,
      passiveGain: totalPower - basePower,
      activeScoreUp: memberState.activeScoreUp,
      staticSupport: memberState.staticSupport,
      leaderSupport,
      specialSupport: memberState.specialSupport,
      members, leader,
    };
  }, [picked, leaderId, owned, unlockedLeaders, inventory]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return owned.filter((card) => !needle || `${card.name}${card.title}`.toLowerCase().includes(needle));
  }, [owned, query]);

  if (!bundle) return null;

  const toggle = (id: string) => setPicked((previous) =>
    previous.includes(id) ? previous.filter((value) => value !== id)
      : previous.length < 5 ? [...previous, id] : previous);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>自選隊伍</h2>
          <p className="page-sub">自己挑五張卡與 Leader Outfit，看推薦指數如何組成。</p>
        </div>
        <p className="page-count">{picked.length} / 5 已選</p>
      </div>

      {owned.length < 5 && <p className="hint">先到「我的卡片」勾選至少 5 張。</p>}

      <div className="manual-slots">
        {Array.from({ length: 5 }, (_, slot) => {
          const card = picked[slot] ? owned.find((row) => row.id === picked[slot]) : undefined;
          if (!card) return <div key={slot} className="slot is-empty"><span>{slot + 1}</span></div>;
          const style = attributeStyle(card.type);
          return (
            <button key={slot} className="slot" style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}
                    onClick={() => toggle(card.id)} title="移除">
              {images?.url(card.id)
                ? <img src={images.url(card.id)} alt="" width={192} height={108} />
                : <span className="slot-noart">{style.label}</span>}
              <span className="slot-name">{card.name}</span>
              <span className="slot-title">{card.title || '—'}</span>
            </button>
          );
        })}
      </div>

      <div className="filters">
        <select value={leaderId} onChange={(event) => setLeaderId(event.target.value)}>
          <option value="">選擇 Leader Outfit…</option>
          {unlockedLeaders.map((leader) => <option key={leader.id} value={leader.id}>{leader.name}</option>)}
        </select>
        <input type="search" value={query} placeholder="搜尋持有卡"
               onChange={(event) => setQuery(event.target.value)} />
        <button onClick={() => setPicked([])} disabled={!picked.length}>清空</button>
      </div>

      {evaluation?.duplicate && <p className="error">同一位成員不能在隊伍中重複上場。</p>}

      {evaluation && !evaluation.duplicate && (
        <section className="breakdown">
          <div className="breakdown-index">
            <p className="breakdown-label">推薦指數</p>
            <b>{Math.round(evaluation.index).toLocaleString()}</b>
            <p className="breakdown-note">相對比較值，非遊戲畫面分數</p>
          </div>
          <dl className="breakdown-parts">
            <div><dt>基礎總合力</dt><dd>{evaluation.basePower.toLocaleString()}</dd></div>
            <div><dt>Passive／Outfit 加成</dt><dd>+{evaluation.passiveGain.toLocaleString()}</dd></div>
            <div><dt>加成後總合力</dt><dd>{evaluation.totalPower.toLocaleString()}</dd></div>
            <div><dt>Active 期望</dt><dd>+{evaluation.activeScoreUp.toFixed(1)}%</dd></div>
            <div><dt>Passive Score Support</dt><dd>+{evaluation.staticSupport.toFixed(0)}</dd></div>
            <div><dt>Outfit Score Support</dt><dd>+{evaluation.leaderSupport.toFixed(0)}</dd></div>
            <div><dt>Special 時間平均</dt><dd>+{evaluation.specialSupport.toFixed(1)}</dd></div>
          </dl>
        </section>
      )}

      <div className="grid is-compact">
        {candidates.map((card) => {
          const style = attributeStyle(card.type);
          const chosen = picked.includes(card.id);
          return (
            <button key={card.id} className={`pick${chosen ? ' is-on' : ''}`}
                    style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line, ['--accent-soft' as string]: style.soft }}
                    onClick={() => toggle(card.id)} disabled={!chosen && picked.length >= 5}>
              {images?.url(card.id)
                ? <img src={images.url(card.id)} alt="" width={192} height={108} />
                : <span className="slot-noart">{style.label}</span>}
              <span className="pick-name">{card.name}</span>
              <span className="pick-title">{card.title || '—'}</span>
            </button>
          );
        })}
      </div>
      {!candidates.length && owned.length > 0 && <p className="empty">沒有符合的持有卡。</p>}
    </>
  );
}
