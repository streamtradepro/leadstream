/**
 * Local "handled" status for leads (replied / skipped).
 *
 * The backend has no status-update endpoint yet, so the app remembers which
 * leads the owner dealt with in AsyncStorage. Everything goes through the
 * `StatusStore` interface — when a server route exists (e.g. POST
 * /api/leads/:id/status), implement a second store and swap `statusStore`
 * below; the UI does not care where the map comes from.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type HandledStatus = 'replied' | 'skipped';
/** lead.id → status */
export type HandledMap = Record<string, HandledStatus>;

export interface StatusStore {
  load(): Promise<HandledMap>;
  /** Pass `null` to clear a lead back to unhandled. Resolves with the full map. */
  set(id: string, status: HandledStatus | null): Promise<HandledMap>;
}

const KEY = 'ls_handled_v1';

let memo: HandledMap | null = null;

export const localStatusStore: StatusStore = {
  async load() {
    if (memo) return memo;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      memo = parsed && typeof parsed === 'object' ? (parsed as HandledMap) : {};
    } catch {
      memo = {};
    }
    return memo;
  },
  async set(id, status) {
    const current = { ...(await this.load()) };
    if (status) current[id] = status;
    else delete current[id];
    memo = current;
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* best effort — the in-memory copy still drives the UI this session */
    }
    return current;
  },
};

/** The store the app uses. Swap for a server-backed implementation later. */
export const statusStore: StatusStore = localStatusStore;
