/**
 * App-wide state: config (URL + secret), the leads list, and local handled
 * status. One provider so the notification-tap handler in the root layout can
 * look leads up without prop drilling.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchLeads, errorMessage, setLeadStatus } from './api';
import { isConfigured, loadConfig, saveConfig, type AppConfig } from './config';
import { statusStore, type HandledMap, type HandledStatus } from './handled';
import type { Lead } from './types';

interface StoreState {
  /** null until SecureStore has been read. */
  config: AppConfig | null;
  configured: boolean;
  configLoaded: boolean;
  updateConfig: (next: AppConfig) => Promise<AppConfig>;

  leads: Lead[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<Lead[]>;

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
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [handled, setHandled] = useState<HandledMap>({});
  const leadsRef = useRef<Lead[]>([]);
  leadsRef.current = leads;
  const inflight = useRef<Promise<Lead[]> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cfg, map] = await Promise.all([loadConfig(), statusStore.load()]);
      if (!alive) return;
      setConfig(cfg);
      setHandled(map);
      setConfigLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const configured = isConfigured(config);

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

  const updateConfig = useCallback(async (next: AppConfig) => {
    const saved = await saveConfig(next);
    setConfig(saved);
    return saved;
  }, []);

  const setStatus = useCallback(async (id: string, status: HandledStatus | null) => {
    const map = await statusStore.set(id, status);
    setHandled({ ...map });
    // Mirror to the server so status survives reinstalls and other phones (best effort).
    setLeadStatus(id, status ?? 'new').catch(() => {});
  }, []);

  const dismissLead = useCallback(async (id: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    const map = await statusStore.set(id, 'skipped');
    setHandled({ ...map });
    setLeadStatus(id, 'skipped').catch(() => {});
  }, []);

  const getById = useCallback((id: string) => leadsRef.current.find((l) => l.id === id), []);
  const findByRedditId = useCallback(
    (rid: string) => leadsRef.current.find((l) => l.reddit_id === rid),
    [],
  );
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
      config,
      configured,
      configLoaded,
      updateConfig,
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
    [
      config,
      configured,
      configLoaded,
      updateConfig,
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
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
