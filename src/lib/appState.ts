/**
 * Shared application state: the data bundles, the inventory, and the last run.
 *
 * Kept in one hook so every page reads the same inventory and the optimizer's
 * result survives navigating away and back.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageSource } from './images';
import { fetchUpstream } from './upstream';
import { fromJson, load, save, type Inventory, type InventoryRow } from './inventory';
import type { CardBundle, CardJson, LeaderJson } from '../engine/types';
import type { ChartMeta } from '../engine/chartScore';
import type { TeamBreakdown } from '../ui/TeamRow';

export interface ChartBundle {
  source?: string;
  scoreRatioSource?: string;
  charts: ChartMeta[];
  index: Record<string, [number, number, number]>;
}

/** A finished optimizer run, resolved to the cards it scored. */
export interface ResolvedRun {
  rows: Array<{
    value: number;
    /** Indices into `owned`, kept for diversity comparisons. */
    memberIndices: number[];
    members: CardJson[];
    leader: LeaderJson;
    breakdown: TeamBreakdown;
  }>;
  evaluations: number;
  /** Teams that passed the talent and pinned-card filters. */
  scored: number;
  /** Card ids this run was constrained to include. */
  pinned: string[];
  seconds: number;
  workers: number;
  ownedCount: number;
  leaderCount: number;
  stamp: number;
}

/** Where the card list currently in use came from. */
export type DataOrigin = 'bundled' | 'upstream';

export interface AppState {
  bundle: CardBundle | null;
  origin: DataOrigin;
  /** Card ids the live refresh added on top of the bundled snapshot. */
  newCards: string[];
  images: ImageSource | null;
  charts: ChartBundle | null;
  chartBlob: ArrayBuffer | null;
  loadCharts: () => void;
  chartsLoading: boolean;
  error: string | null;
  inventory: Inventory;
  stamp: number;
  owned: CardJson[];
  unlockedLeaders: LeaderJson[];
  bloomOf: (cardId: string) => number;
  patch: (cardId: string, changes: Partial<InventoryRow>) => void;
  bulk: (cards: CardJson[], changes: Partial<InventoryRow>, maxBloom?: boolean) => void;
  replaceInventory: (next: Inventory) => void;
  exportInventory: () => void;
  importInventory: (text: string) => void;
  run: ResolvedRun | null;
  setRun: (run: ResolvedRun | null) => void;
}

export function useAppState(): AppState {
  const [bundle, setBundle] = useState<CardBundle | null>(null);
  const [origin, setOrigin] = useState<DataOrigin>('bundled');
  const [newCards, setNewCards] = useState<string[]>([]);
  const [images, setImages] = useState<ImageSource | null>(null);
  const [charts, setCharts] = useState<ChartBundle | null>(null);
  const [chartBlob, setChartBlob] = useState<ArrayBuffer | null>(null);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [inventory, setInventory] = useState<Inventory>(new Map());
  const [stamp, setStamp] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ResolvedRun | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const controller = new AbortController();
    let cancelled = false;

    // Paint from the bundled snapshot first: the page must open even when the
    // upstream host is unreachable, then quietly upgrade if it is not.
    fetch(`${base}data/cards.json`)
      .then((response) => response.json())
      .then(async (bundled: CardBundle) => {
        if (cancelled) return;
        setBundle(bundled);
        setInventory(load(bundled));
        setImages(await ImageSource.load(base));

        const fresh = await fetchUpstream(bundled, controller.signal);
        if (cancelled || !fresh) return;
        setBundle(fresh.bundle);
        setOrigin('upstream');
        setNewCards(fresh.added);
        // Re-seed so cards that only exist upstream get an inventory row.
        setInventory((previous) => {
          const merged = load(fresh.bundle);
          for (const [cardId, row] of previous) if (merged.has(cardId)) merged.set(cardId, row);
          return merged;
        });
      })
      .catch((cause: Error) => setError(`載入卡片資料失敗：${cause.message}`));

    return () => { cancelled = true; controller.abort(); };
  }, []);

  // Charts are 1.9 MB, so they load on demand rather than on first paint.
  const loadCharts = useCallback(() => {
    if (charts || chartsLoading) return;
    setChartsLoading(true);
    const base = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${base}data/charts.json`).then((response) => response.json()),
      fetch(`${base}data/charts.bin`).then((response) => response.arrayBuffer()),
    ])
      .then(([meta, blob]) => { setCharts(meta as ChartBundle); setChartBlob(blob); })
      .catch((cause: Error) => setError(`載入譜面資料失敗：${cause.message}`))
      .finally(() => setChartsLoading(false));
  }, [charts, chartsLoading]);

  const mutate = useCallback((apply: (next: Inventory) => void) => {
    setInventory((previous) => {
      const next = new Map(previous);
      apply(next);
      save(next);
      return next;
    });
    setStamp((value) => value + 1);
  }, []);

  const patch = useCallback((cardId: string, changes: Partial<InventoryRow>) => {
    mutate((next) => {
      const row = next.get(cardId);
      if (row) next.set(cardId, { ...row, ...changes });
    });
  }, [mutate]);

  const bulk = useCallback((cards: CardJson[], changes: Partial<InventoryRow>, maxBloom = false) => {
    mutate((next) => {
      for (const card of cards) {
        const row = next.get(card.id);
        if (!row) continue;
        next.set(card.id, { ...row, ...changes, ...(maxBloom ? { bloom: card.maxBloom } : {}) });
      }
    });
  }, [mutate]);

  const replaceInventory = useCallback((next: Inventory) => {
    save(next);
    setInventory(next);
    setStamp((value) => value + 1);
  }, []);

  const exportInventory = useCallback(() => {
    const text = JSON.stringify([...inventory.values()], null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hololive-dreams-my-cards.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [inventory]);

  const importInventory = useCallback((text: string) => {
    if (!bundle) return;
    try {
      replaceInventory(fromJson(text, bundle));
    } catch (cause) {
      setError(`匯入失敗：${(cause as Error).message}`);
    }
  }, [bundle, replaceInventory]);

  const owned = useMemo(
    () => (bundle ? bundle.cards.filter((card) => inventory.get(card.id)?.owned) : []),
    [bundle, inventory],
  );

  const unlockedLeaders = useMemo(
    () => (bundle ? bundle.leaders.filter((leader) => {
      const row = inventory.get(leader.id.replace(/^outfit:/, ''));
      return row?.owned && row.leader_unlocked;
    }) : []),
    [bundle, inventory],
  );

  const bloomOf = useCallback(
    (cardId: string) => inventory.get(cardId)?.bloom ?? 0,
    [inventory],
  );

  return {
    bundle, origin, newCards, images, charts, chartBlob, loadCharts, chartsLoading, error,
    inventory, stamp, owned, unlockedLeaders, bloomOf,
    patch, bulk, replaceInventory, exportInventory, importInventory,
    run, setRun,
  };
}
