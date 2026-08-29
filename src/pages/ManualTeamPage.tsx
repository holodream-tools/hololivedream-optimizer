/** 自選隊伍 — score any five cards you pick, with the contributions broken out. */
import { useMemo, useState } from 'react';
import { cardFacts, outfitTable } from '../engine/precompute';
import {
  expectedIndexOf, leaderPowerAndSupport, makeMemberState, memberPart, memberStatTotals,
} from '../engine/overallScore';
import { bestOrder } from '../engine/compare';
import { materialize, prepare } from '../engine/chartScore';
import { attributeStyle } from '../ui/theme';
import { outfitText } from '../ui/skillText';
import { PassiveConditions } from '../ui/PassiveConditions';
import { CardArt } from '../ui/CardArt';
import { SongTimeline } from '../ui/SongTimeline';
import { ProvisionalChartNotice, ProvisionalTag } from '../ui/ProvisionalChartNotice';
import { shareUrl } from '../lib/share';
import { ShareCardButton } from '../ui/ShareCardButton';
import type { ShareCardData } from '../lib/shareCard';
import type { AppState } from '../lib/appState';
import type { PreparedChart } from '../engine/chartScore';
import { memberName, leaderName, searchIndex } from '../ui/members';

export function ManualTeamPage({ state, onCompare }: { state: AppState; onCompare: () => void }) {
  const {
    bundle, images, owned, unlockedLeaders, inventory, compare, pushCompare,
    prefs, setPrefs, bloomOf, songKey, setSongKey, shared, dismissShared,
    charts, chartBlob, chartsLoading, loadCharts,
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
    // The Outfit's increment per parameter, from the same call that returns the
    // total, so the three below still add up to it exactly.
    const outfitPerStat = new Float64Array(3);
    const [totalPower, leaderSupport] =
      leaderPowerAndSupport(payload, memberState, undefined, outfitPerStat);
    const stats = memberStatTotals(memberState, new Float64Array(3));
    for (let k = 0; k < 3; k++) stats[k] += outfitPerStat[k];
    const basePower = facts.reduce((sum, fact) => sum + fact.total, 0);
    const index = expectedIndexOf(payload, memberState);
    const activeScoreUp = memberState.activeScoreUp;
    const staticSupport = memberState.staticSupport;
    const specialSupport = memberState.specialSupport;

    /**
     * Every figure this page reports, formatted once.
     *
     * The list below the team and the share card both render from this, so a
     * number cannot say one thing on screen and another in the picture. `onCard`
     * only chooses which of them the card has room for; it changes no value.
     */
    const figures: Array<{ label: string; value: string; onCard: boolean }> = [
      { label: '基礎總合力', value: basePower.toLocaleString(), onCard: false },
      { label: '被動／隊長服裝加成', value: `+${(totalPower - basePower).toLocaleString()}`, onCard: false },
      { label: '加成後總合力', value: totalPower.toLocaleString(), onCard: true },
      { label: '表現力', value: stats[0].toLocaleString(), onCard: true },
      { label: '技巧', value: stats[1].toLocaleString(), onCard: true },
      { label: '品味', value: stats[2].toLocaleString(), onCard: true },
      { label: '主動技能期望', value: `+${activeScoreUp.toFixed(1)}%`, onCard: true },
      // Percentages like the Active expectation above: all three reach the
      // score through the same `/ 100`, so all three carry the unit.
      { label: '被動技能分數支援', value: `+${staticSupport.toFixed(0)}%`, onCard: true },
      { label: '隊長服裝分數支援', value: `+${leaderSupport.toFixed(0)}%`, onCard: true },
      { label: '特殊技能時間平均', value: `+${specialSupport.toFixed(1)}%`, onCard: true },
    ];

    return {
      duplicate: false as const,
      index, figures, members, leader,
    };
  }, [picked, leaderId, owned, unlockedLeaders, inventory]);

  const teamReady = picked.length === 5 && !!leaderId;

  const chartMeta = useMemo(
    () => charts?.charts.find((row) => row.key === songKey) ?? null,
    [charts, songKey],
  );
  const chartPrepared = useMemo<PreparedChart | null>(() => {
    const located = songKey ? charts?.index[songKey] : undefined;
    if (!chartMeta || !located || !chartBlob) return null;
    const [offset, count] = located;
    return prepare(chartMeta, materialize(chartBlob, offset, count));
  }, [chartMeta, charts, chartBlob, songKey]);

  /**
   * This fixed team's performance on the chosen chart -- the same `bestOrder`
   * search 歌曲／順序's "指定隊伍" mode calls, over the same five members and
   * Leader Outfit `evaluation` already resolved. Choosing a song only looks
   * for the best standing ORDER for these five; it never changes who is on
   * the team.
   */
  const songOutcome = useMemo(() => {
    if (!evaluation || evaluation.duplicate || !chartMeta || !chartPrepared) return null;
    const { members, leader } = evaluation;
    const facts = cardFacts(members, members.map((card) => bloomOf(card.id)));
    const leaderBloom = Math.min(bloomOf(leader.id.replace(/^outfit:/, '')), leader.maxBloom);
    const outfits = outfitTable([leader], [leaderBloom]);
    const payload = outfits.payloads[outfits.signatureOf[0]];
    const best = bestOrder(facts, [0, 1, 2, 3, 4], payload, chartPrepared);
    const figures = [
      { label: '加成後總合力', value: best.detail.totalPower.toLocaleString() },
      { label: 'PERFECT 基礎分', value: best.detail.perfectNoteScore.toLocaleString() },
      { label: '譜面除數', value: best.detail.scoreRatio.toFixed(2) },
      { label: '主動技能實際貢獻', value: `+${best.detail.activeBonus.toFixed(1)}%` },
    ];
    return { meta: chartMeta, prepared: chartPrepared, best, figures };
  }, [evaluation, chartMeta, chartPrepared, bloomOf]);

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
   * What the share card draws, read at the moment it is asked for.
   *
   * Every figure comes from `evaluation`, which is what the panel below the
   * team renders too -- the card cannot show a number this page is not
   * showing, and changing a member or the Outfit changes both together.
   */
  const cardData = (): ShareCardData | null => {
    if (!evaluation || evaluation.duplicate) return null;
    // Said only when the picture does not already say it: where the Outfit's
    // card is one of the five, the 隊長 mark on that tile is the whole story.
    const alsoPlays = evaluation.members.some((card) => card.id === pickedLeaderCard);
    return {
      subject: '自選隊伍',
      headline: { label: '綜合推薦指數', value: Math.round(evaluation.index).toLocaleString() },
      stats: evaluation.figures.filter((row) => row.onCard),
      leaderLine: `隊長服裝：${leaderName(evaluation.leader)}`
        + (alsoPlays ? '' : '（僅套用服裝效果）'),
      members: evaluation.members.map((card) => ({
        cardId: card.id,
        name: memberName(card),
        title: card.title || '',
        type: card.type,
        bloom: bloomOf(card.id),
        isLeader: card.id === pickedLeaderCard,
      })),
    };
  };

  const pickedLeader = unlockedLeaders.find((row) => row.id === leaderId) ?? null;
  const pickedLeaderCard = pickedLeader?.id.replace(/^outfit:/, '') ?? '';
  const pickedLeaderPayload = pickedLeader
    ? pickedLeader.outfits[String(bloomOf(pickedLeaderCard))]
      ?? pickedLeader.outfits[String(pickedLeader.maxBloom)] ?? null
    : null;
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
          {pickedLeaderCard
            ? <CardArt images={images} cardId={pickedLeaderCard} width={192} height={108}
                       noArtClassName="leader-noart" noArtLabel="未選擇" />
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
              <CardArt images={images} cardId={card.id} width={192} height={108}
                       noArtClassName="slot-noart" noArtLabel={style.label} />
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
          <b>圖卡</b>：把這五人與下面的分析畫成一張圖，可分享或存檔
        </p>
        <div className="team-actions-buttons">
          <button className="primary team-share-button" disabled={!teamReady}
                  onClick={() => void share()}>
            分享連結
          </button>
          <ShareCardButton data={cardData} images={images} disabled={!teamReady}
                           filename="hololive-dreams-team.png" />
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
            {evaluation.figures.map((row) => (
              <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
            ))}
          </dl>
          <p className="metric-note">
            綜合推薦指數以通用 192 秒模型計算，不對應任何一首歌；指定歌曲理論預估分（Perfect 假設）請到「歌曲／順序」計算。
          </p>
        </section>
      )}

      {evaluation && !evaluation.duplicate && (
        <PassiveConditions members={evaluation.members} leader={evaluation.leader} bloomOf={bloomOf} />
      )}

      {/* Extra, on top of the general 綜合推薦指數 above -- this never changes
          who the five picks are, only which station they stand at for the
          chosen song. */}
      {evaluation && !evaluation.duplicate && (
        <section className="song-eval">
          <h4>
            指定歌曲評估
            <span>固定這五人，只找最佳站位；不會因為選歌而換人</span>
          </h4>
          {charts ? (
            <div className="filters">
              <select value={songKey} onChange={(event) => setSongKey(event.target.value)}>
                <option value="">不指定（只看上面的綜合推薦指數）</option>
                {charts.charts.map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.title} · {row.difficulty} Lv.{row.difficultyLevel}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button className="ghost" onClick={loadCharts} disabled={chartsLoading}>
              {chartsLoading ? '正在載入譜面資料…' : '載入譜面，評估這支隊伍在指定歌曲的表現'}
            </button>
          )}

          {songOutcome && (
            <>
              <div className="song-score">
                <p className="breakdown-label"
                   title="依實際歌曲譜面、Combo、特殊技能、主動技能、技能發動率加成（SAR）等時間點計算。">
                  {songOutcome.meta.title}<ProvisionalTag chart={songOutcome.meta} /> · 指定歌曲理論預估分（Perfect 假設）
                </p>
                <b>{songOutcome.best.score.toLocaleString()}</b>
                <p className="song-delta">
                  最佳站位 · 最差站位 {songOutcome.best.worst.toLocaleString()}
                  （相差 {(songOutcome.best.score - songOutcome.best.worst).toLocaleString()}）
                </p>
              </div>
              <ProvisionalChartNotice chart={songOutcome.meta} />

              <ol className="order-line">
                {songOutcome.best.order.map((memberIndex, slot) => {
                  const card = evaluation.members[memberIndex];
                  const style = attributeStyle(card.type);
                  return (
                    <li key={slot} style={{ ['--accent' as string]: style.accent, ['--accent-line' as string]: style.line }}>
                      <span className="order-slot">特殊技能 {slot + 1}</span>
                      <CardArt images={images} cardId={card.id} width={192} height={108}
                               noArtClassName="slot-noart" noArtLabel={style.label} />
                      <span className="order-name">{memberName(card)}</span>
                    </li>
                  );
                })}
              </ol>

              <dl className="breakdown-parts">
                {songOutcome.figures.map((row) => (
                  <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                ))}
              </dl>
              <p className="song-source">除數來源：{songOutcome.best.detail.ratioSource}</p>
              <p className="metric-note">
                這個數字依實際歌曲譜面、Combo、特殊技能、主動技能、技能發動率加成（SAR）等時間點逐音符計算，與上面的綜合推薦指數量綱不同，兩者不能互相比較。
              </p>

              <section className="timeline-block">
                <h4>
                  時間軸分析
                  <span>{songOutcome.best.score.toLocaleString()} 分 · 最佳站位</span>
                </h4>
                <SongTimeline
                  prepared={songOutcome.prepared}
                  detail={songOutcome.best.detail}
                  members={songOutcome.best.order.map((memberIndex) => evaluation.members[memberIndex])}
                />
              </section>
            </>
          )}
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
              <CardArt images={images} cardId={card.id} width={192} height={108}
                       noArtClassName="slot-noart" noArtLabel={style.label} />
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
