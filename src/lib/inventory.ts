/**
 * Player inventory, kept in the browser.
 *
 * The on-disk shape is the desktop app's export format, so a file exported from
 * either side imports into the other.
 */
import type { CardBundle } from '../engine/types';

const STORAGE_KEY = 'hololivedream.inventory.v1';

export interface InventoryRow {
  card_id: string;
  owned: number;
  level: number;
  bloom: number;
  favorite: number;
  leader_unlocked: number;
}

export type Inventory = Map<string, InventoryRow>;

export function emptyRow(cardId: string): InventoryRow {
  return { card_id: cardId, owned: 0, level: 80, bloom: 0, favorite: 0, leader_unlocked: 0 };
}

export function load(bundle: CardBundle): Inventory {
  const inventory: Inventory = new Map();
  for (const card of bundle.cards) inventory.set(card.id, emptyRow(card.id));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) for (const row of JSON.parse(raw) as InventoryRow[]) {
      if (inventory.has(row.card_id)) inventory.set(row.card_id, { ...emptyRow(row.card_id), ...row });
    }
  } catch {
    // A private window or blocked site data just means we start empty.
  }
  return inventory;
}

export function save(inventory: Inventory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...inventory.values()]));
  } catch {
    // Nothing to do: the inventory still works for this session.
  }
}

/** Forget the stored inventory. `load` then returns blank rows for every card. */
export function clearStored(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do about a storage that refuses to co-operate.
  }
}

export function toJson(inventory: Inventory): string {
  return JSON.stringify([...inventory.values()], null, 2);
}

export function fromJson(text: string, bundle: CardBundle): Inventory {
  const inventory = load(bundle);
  for (const row of JSON.parse(text) as InventoryRow[]) {
    if (inventory.has(row.card_id)) inventory.set(row.card_id, { ...emptyRow(row.card_id), ...row });
  }
  return inventory;
}
