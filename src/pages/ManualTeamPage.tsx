/** 自選隊伍 — score any five cards you pick, with the contributions broken out. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardFacts, outfitTable } from '../engine/precompute';
import { expectedIndexOf, leaderPowerAndSupport, makeMemberState, memberPart } from '../engine/overallScore';
import { attributeStyle } from '../ui/theme';
import { outfitText } from '../ui/skillText';
import { PassiveConditions } from '../ui/PassiveConditions';
import { shareUrl } from '../lib/share';
import type { AppState } from '../lib/appState';
import { memberName, leaderName, searchIndex } from '../ui/members';

export function ManualTeamPage({ state, onCompare }: { state: AppState; onCompare: () => void }) {
  const {
    bundle, images, owned, unlockedLeaders, inventory, compare, pushCompare,
    prefs, setPrefs, bloomOf, songKey, shared, dismissShared,
  } = state;
  // The picks live in the remembered settings, so they survive a reload and a
  // shared link can seed them.
  const picked = prefs.manualPicks;
  const leaderId = prefs.manualLeaderId;
  const setPicked = (next: string[] | ((previous: string[]) => string[])) =>
    setPrefs((previous) => ({
      manualPicks: typeof next === 'function' ? next(previous.manualPicks) : next,
    }));
  const setLeaderId = (id: string) => setPrefs({ manualLeaderId: id });
  const [query, setQuery] = useState('');
  // What the share bar is currently saying back, if anything. A string rather
  // than a boolean because copying and a declined share are different events.
  const [shareNote, setShareNote] = useState('');
  // The 分享圖卡 menu. Its own state, because it shares the site rather than
  // the team and stays usable when no team is picked yet.
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const cardMenuRef = useRef<HTMLDivElement>(null);

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

  const teamReady = picked.length === 5 && !!leaderId;

  /**
   * The link, from the same builder the page has always used.
   *
   * Deliberately not a second URL format: `shareUrl` owns what a shared team
   * carries and how it decodes, and both buttons here go through it.
   */
  const buildUrl = () => {
    const blooms: Record<string, number> = {};
    for (const id of [...picked, pickedLeaderCard]) if (id) blooms[id] = bloomOf(id);
    return shareUrl({
      members: picked, leaderId, blooms,
      songKey: songKey || undefined, difficulty: prefs.difficulty,
    });
  };

  const say = (message: string) => {
    setShareNote(message);
    window.setTimeout(() => setShareNote(''), 2600);
  };

  /** Copy, or hand the link over when the clipboard refuses. */
  const copyLink = async () => {
    if (!teamReady) return;
    const url = buildUrl();
    try {
      await navigator.clipboard.writeText(url);
      say('分享連結已複製');
    } catch {
      // Clipboard refused (no permission, or an insecure origin): put the link
      // where it can still be copied by hand.
      window.prompt('複製這個連結：', url);
    }
  };

  /**
   * The system share sheet where there is one, the clipboard where there is not.
   *
   * A cancelled sheet is not a failure -- the browser reports the user closing
   * it as an AbortError, and falling back to a copy there would mean tapping
   * "cancel" silently put something on their clipboard. Anything else is a
   * share that could not happen, so the link still gets copied.
   */
  const share = async () => {
    if (!teamReady) return;
    const url = buildUrl();
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({
        title: 'hololive Dreams 隊伍最佳化',
        text: '分享我的 hololive Dreams 隊伍',
        url,
      });
    } catch (cause) {
      if ((cause as Error)?.name === 'AbortError') return;
      await copyLink();
    }
  };

  /**
   * The site's own address, for sharing the page rather than a team.
   *
   * origin + pathname, the same two parts `shareUrl` builds on, minus the
   * team fragment -- so there is no second idea of "where this site lives"
   * that could drift from the canonical.
   */
  const siteUrl = () => `${window.location.origin}${window.location.pathname}`;

  const SITE_TITLE = 'hololive Dreams 隊伍最佳化';
  const SITE_TEXT = 'hololive Dreams 非官方隊伍最佳化工具：歌曲分析、最佳站位與隊伍比較';

  /**
   * Where 分享圖卡 can send you.
   *
   * Each of these renders the page's Open Graph card on the far side, which is
   * the point: the link carries no team, so what the recipient sees is the
   * site's own preview image. Nothing here touches the team encoding.
   */
  const cardTargets = () => {
    const url = encodeURIComponent(siteUrl());
    const text = encodeURIComponent(SITE_TEXT);
    return [
      { key: 'line', label: 'LINE',
        href: `https://social-plugins.line.me/lineit/share?url=${url}` },
      { key: 'x', label: 'X',
        href: `https://x.com/intent/tweet?url=${url}&text=${text}` },
      { key: 'facebook', label: 'Facebook',
        href: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    ];
  };

  const shareSite = async () => {
    setCardMenuOpen(false);
    if (!navigator.share) return;
    try {
      await navigator.share({ title: SITE_TITLE, text: SITE_TEXT, url: siteUrl() });
    } catch (cause) {
      if ((cause as Error)?.name === 'AbortError') return;
      await copySite();
    }
  };

  const copySite = async () => {
    setCardMenuOpen(false);
    const url = siteUrl();
    try {
      await navigator.clipboard.writeText(url);
      say('網站連結已複製');
    } catch {
      window.prompt('複製這個連結：', url);
    }
  };

  // Click away or press Escape closes the menu, the two things anyone tries.
  useEffect(() => {
    if (!cardMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!cardMenuRef.current?.contains(event.target as Node)) setCardMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCardMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [cardMenuOpen]);

  const pickedLeader = unlockedLeaders.find((row) => row.id === leaderId) ?? null;
  const pickedLeaderCard = pickedLeader?.id.replace(/^outfit:/, '') ?? '';
  const pickedLeaderPayload = pickedLeader
    ? pickedLeader.outfits[String(bloomOf(pickedLeaderCard))]
      ?? pickedLeader.outfits[String(pickedLeader.maxBloom)] ?? null
    : null;
  const pickedLeaderArt = pickedLeaderCard ? images?.url(pickedLeaderCard) : undefined;

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return owned.filter((card) => !needle || searchIndex(card).includes(needle));
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
          <p className="page-sub">自己挑五張卡與隊長服裝，看<b>綜合推薦指數</b>如何組成。</p>
        </div>
        <p className="page-count">{picked.length} / 5 已選</p>
      </div>

      {shared && (
        <p className="fresh">
          已從分享連結載入這支隊伍。
          {shared.added.length > 0 && (
            <>其中 {shared.added.length} 張卡不在你的持有清單裡，已為你加入（含連結帶來的命座），你原本的設定沒有被移除。</>
          )}
          <button className="ghost" onClick={dismissShared}>知道了</button>
        </p>
      )}

      {owned.length < 5 && <p className="hint">先到「我的卡片」勾選至少 5 張。</p>}

      {/* The Outfit is a separate slot, not a sixth member. It sits above the
          five, reads left to right, and its artwork is deliberately small: it is
          where an effect comes from, not someone who takes the stage. */}
      <section className="leader-block">
        <div className="leader-pick">
          <span className="leader-chip-label">隊長服裝</span>
          <select value={leaderId} onChange={(event) => setLeaderId(event.target.value)}>
            <option value="">選擇隊長服裝…</option>
            {unlockedLeaders.map((leader) => (
              <option key={leader.id} value={leader.id}>{leaderName(leader)}</option>
            ))}
          </select>
          <p className="leader-effect">
            {leaderId
              ? (outfitText(pickedLeaderPayload) ?? '這件服裝沒有可辨識的效果。')
              : '選一件服裝，這裡會顯示它的效果。'}
          </p>
          <p className="leader-note">隊長服裝不佔 5 名隊員名額。</p>
        </div>
        <div className="leader-art">
          <span className="leader-chip">隊長服裝</span>
          {pickedLeaderArt
            ? <img src={pickedLeaderArt} alt="" width={192} height={108} />
            : <span className="leader-noart">未選擇</span>}
        </div>
      </section>

      <hr className="team-split" />

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
              <span className="slot-name">{memberName(card)}</span>
              <span className="slot-title">{card.title || '—'}</span>
            </button>
          );
        })}
      </div>

      {/* Under the team rather than in the card-pool filter row: what gets
          shared is the five above plus the Leader Outfit and their Blooms, and
          the button has to sit next to the thing it acts on for that to be
          obvious. */}
      <div className="team-actions">
        <p className="team-actions-what">
          <b>分享連結</b>：帶著目前的 5 名成員、隊長服裝與命座
          {!teamReady && <span>（選滿 5 人並指定隊長服裝後可用）</span>}
          <br />
          <b>分享圖卡</b>：分享這個網站，不含你的隊伍
        </p>
        <div className="team-actions-buttons">
          <button className="primary team-share-button" disabled={!teamReady}
                  onClick={() => void share()}>
            分享連結
          </button>
          {/* Its own menu rather than the system sheet alone: on a desktop
              browser there is often no sheet at all, and the named services
              are where this actually gets shared. */}
          <div className="card-share" ref={cardMenuRef}>
            <button aria-haspopup="menu" aria-expanded={cardMenuOpen}
                    onClick={() => setCardMenuOpen((open) => !open)}>
              分享圖卡 ▾
            </button>
            {cardMenuOpen && (
              <div className="card-share-menu" role="menu">
                {cardTargets().map((target) => (
                  <a key={target.key} role="menuitem" href={target.href}
                     target="_blank" rel="noopener noreferrer"
                     onClick={() => setCardMenuOpen(false)}>
                    {target.label}
                  </a>
                ))}
                {!!navigator.share && (
                  <button role="menuitem" onClick={() => void shareSite()}>系統分享…</button>
                )}
                <button role="menuitem" onClick={() => void copySite()}>複製網站連結</button>
              </div>
            )}
          </div>
        </div>
        {shareNote && <p className="team-actions-note" role="status">{shareNote}</p>}
      </div>

      <div className="filters">
        <input type="search" value={query} placeholder="搜尋持有卡"
               onChange={(event) => setQuery(event.target.value)} />
        <button onClick={() => setPicked([])} disabled={!picked.length}>清空</button>
        <button
          disabled={!evaluation || evaluation.duplicate}
          onClick={() => {
            if (!evaluation || evaluation.duplicate) return;
            pushCompare({
              members: evaluation.members, leader: evaluation.leader, source: '自選隊伍',
            });
            onCompare();
          }}>
          比較 {compare[0] === null ? '→ A' : compare[1] === null ? '→ B' : '→ A'}
        </button>
      </div>

      {evaluation?.duplicate && <p className="error">同一位成員不能在隊伍中重複上場。</p>}

      {evaluation && !evaluation.duplicate && (
        <section className="breakdown">
          <div className="breakdown-index">
            <p className="breakdown-label" title="使用通用 192 秒模型快速比較大量隊伍。">
              綜合推薦指數
            </p>
            <b>{Math.round(evaluation.index).toLocaleString()}</b>
            <p className="breakdown-note">用於隊伍強弱比較的估算指標，非實際 Live 分數。</p>
          </div>
          <dl className="breakdown-parts">
            <div><dt>基礎總合力</dt><dd>{evaluation.basePower.toLocaleString()}</dd></div>
            <div><dt>被動／隊長服裝加成</dt><dd>+{evaluation.passiveGain.toLocaleString()}</dd></div>
            <div><dt>加成後總合力</dt><dd>{evaluation.totalPower.toLocaleString()}</dd></div>
            <div><dt>主動技能期望</dt><dd>+{evaluation.activeScoreUp.toFixed(1)}%</dd></div>
            <div><dt>被動技能分數支援</dt><dd>+{evaluation.staticSupport.toFixed(0)}</dd></div>
            <div><dt>隊長服裝分數支援</dt><dd>+{evaluation.leaderSupport.toFixed(0)}</dd></div>
            <div><dt>特殊技能時間平均</dt><dd>+{evaluation.specialSupport.toFixed(1)}</dd></div>
          </dl>
          <p className="metric-note">
            綜合推薦指數以通用 192 秒模型計算，不對應任何一首歌；指定歌曲理論預估分（Perfect 假設）請到「歌曲／順序」計算。
          </p>
        </section>
      )}

      {evaluation && !evaluation.duplicate && (
        <PassiveConditions members={evaluation.members} leader={evaluation.leader} bloomOf={bloomOf} />
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
              <span className="pick-name">{memberName(card)}</span>
              <span className="pick-title">{card.title || '—'}</span>
            </button>
          );
        })}
      </div>
      {!candidates.length && owned.length > 0 && <p className="empty">沒有符合的持有卡。</p>}
    </>
  );
}
