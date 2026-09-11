/**
 * App-wide state: the signed-in session, the leads list, and handled status.
 * One provider so the notification-tap handler in the root layout can look
 * leads up without prop drilling.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchLeads, errorMessage, isAuthError, login as apiLogin, setLeadStatus, setSignedOutHandler } from './api';
import { loadSession, saveSession, type Session, type Staff } from './config';
import { statusStore, type HandledMap, type HandledStatus } from './handled';
import type { Lead } from './types';

interface StoreState {
  /** undefined until SecureStore has been read; null when signed out. */
  session: Session | null;
  sessionLoaded: boolean;
  signedIn: boolean;
  me: Staff | null;
  signIn: (email: string, password: string) => Promise<Session>;
  signOut: () => Promise<void>;

  leads: Lead[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<Lead[]>;

  /** lead.id → replied/skipped (server status merged with this phone's local marks). */
  handled: HandledMap;
  setStatus: (id: string, status: HandledStatus | null) => Promise<void>;
  /** Swipe-delete: mark skipped everywhere and drop it from the list. */
  dismissLead: (id: string) => Promise<void>;

  getById: (id: string) => Lead | undefined;
  findByRedditId: (redditId: string) => Lead | undefined;
  /** Look up by reddit_id, refetching once if the list does not have it yet. */
  ensureByRedditId: (redditId: string) => Promise<Lead | undefined>;
  /** Patch a lead in memory (e.g. after drafting a reply). */
  patchLead: (id: string, patch: Partial<Lead>) => void;
}

const StoreContext = createContext<StoreState | null>(null);

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [local, setLocal] = useState<HandledMap>({});
  const leadsRef = useRef<Lead[]>([]);
  leadsRef.current = leads;
  const inflight = useRef<Promise<Lead[]> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, map] = await Promise.all([loadSession(), statusStore.load()]);
      if (!alive) return;
      setSession(s);
      setLocal(map);
      setSessionLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Server said the token is dead (deactivated / password reset): drop to the sign-in screen.
  useEffect(() => {
    setSignedOutHandler(() => {
      setSession(null);
      setLeads([]);
    });
    return () => setSignedOutHandler(null);
  }, []);

  const signedIn = !!session;

  const refresh = useCallback(async (): Promise<Lead[]> => {
    // Collapse concurrent refreshes (focus + interval + pull-to-refresh).
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      try {
        const list = await fetchLeads();
        setLeads(list);
        setError(null);
        setLastUpdated(Date.now());
        return list;
      } catch (e) {
        setError(errorMessage(e));
        throw e;
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await apiLogin(email.trim().toLowerCase(), password);
    await saveSession(s);
    setSession(s);
    return s;
  }, []);

  const signOut = useCallback(async () => {
    await saveSession(null);
    setSession(null);
    setLeads([]);
    setError(null);
  }, []);

  const setStatus = useCallback(async (id: string, status: HandledStatus | null) => {
    const map = await statusStore.set(id, status);
    setLocal({ ...map });
    // Mirror to the server (records who did it) so every phone sees it.
    try {
      await setLeadStatus(id, status ?? 'new');
      setLeads((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, status: status ?? 'new', handled_by: status ? session?.staff.name ?? l.handled_by : null }
            : l,
        ),
      );
    } catch (e) {
      // Offline: the local mark still drives the UI. Signed out: api.ts already dropped the session
      // and the layout sends the user to the sign-in screen; surface why the mark did not sync.
      if (isAuthError(e)) throw e;
    }
  }, [session]);

  const dismissLead = useCallback(async (id: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    const map = await statusStore.set(id, 'skipped');
    setLocal({ ...map });
    setLeadStatus(id, 'skipped').catch(() => {});
  }, []);

  // Server status wins for "replied" / "skipped" (someone else may have taken it); this phone's own
  // marks fill the gaps and are never wiped by the server, so a slow or failed write can't undo a tap.
  const handled = useMemo<HandledMap>(() => {
    const merged: HandledMap = { ...local };
    for (const l of leads) {
      if (l.status === 'replied') merged[l.id] = 'replied';
      else if (l.status === 'skipped') merged[l.id] = 'skipped';
    }
    return merged;
  }, [leads, local]);

  const getById = useCallback((id: string) => leadsRef.current.find((l) => l.id === id), []);
  const findByRedditId = useCallback((rid: string) => leadsRef.current.find((l) => l.reddit_id === rid), []);
  const ensureByRedditId = useCallback(
    async (rid: string) => {
      const hit = leadsRef.current.find((l) => l.reddit_id === rid);
      if (hit) return hit;
      try {
        const list = await refresh();
        return list.find((l) => l.reddit_id === rid);
      } catch {
        return undefined;
      }
    },
    [refresh],
  );
  const patchLead = useCallback((id: string, patch: Partial<Lead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const value = useMemo<StoreState>(
    () => ({
      session,
      sessionLoaded,
      signedIn,
      me: session?.staff ?? null,
      signIn,
      signOut,
      leads,
      loading,
      error,
      lastUpdated,
      refresh,
      handled,
      setStatus,
      dismissLead,
      getById,
      findByRedditId,
      ensureByRedditId,
      patchLead,
    }),
    [session, sessionLoaded, signedIn, signIn, signOut, leads, loading, error, lastUpdated, refresh, handled, setStatus, dismissLead, getById, findByRedditId, ensureByRedditId, patchLead],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
