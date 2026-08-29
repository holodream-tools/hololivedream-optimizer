/**
 * Says that a chart's numbers are provisional, wherever they are shown.
 *
 * One component rather than the same sentence typed into each page, so the
 * two places a provisional score can appear -- 歌曲／順序 and 自選隊伍's song
 * evaluation -- cannot drift apart on what they promise.
 *
 * Renders nothing for an exact chart, which is every chart the site has had
 * until a song arrives before Holodori's pack does.
 */
import { isProvisional } from '../engine/chartScore';
import type { ChartMeta } from '../engine/chartScore';

export function ProvisionalChartNotice({ chart }: { chart: ChartMeta | null | undefined }) {
  if (!isProvisional(chart)) return null;
  return (
    <p className="provisional-note" role="note">
      <b>暫定譜面</b>
      此歌曲目前使用暫定譜面資料。部分音符的加乘資訊尚未取得，預估分數與最佳站位僅供參考；
      依既有譜面驗證，分數誤差最高約 0.45%。取得完整譜面資料後會自動更新為精確計算。
    </p>
  );
}

/** The same fact as a compact marker, for a list row or a heading. */
export function ProvisionalTag({ chart }: { chart: ChartMeta | null | undefined }) {
  if (!isProvisional(chart)) return null;
  return <span className="provisional-tag" title="使用暫定譜面資料">暫定</span>;
}
