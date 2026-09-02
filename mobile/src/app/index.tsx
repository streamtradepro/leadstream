import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import { LeadCard } from '../components/LeadCard';
import { FilterChip } from '../components/ui';
import { isAuthError, errorMessage } from '../lib/api';
import { useStore } from '../lib/store';
import { HOT_THRESHOLD, colors } from '../lib/theme';
import { relativeTime } from '../lib/time';
import { useToast } from '../lib/toast';
import type { Lead } from '../lib/types';

type Filter = 'all' | 'hot' | 'service' | 'unhandled';
const REFRESH_MS = 60_000;

export default function LeadsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { configLoaded, configured, leads, loading, error, lastUpdated, refresh, handled } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [pulling, setPulling] = useState(false);
  const lastErrorShown = useRef<string | null>(null);
  // Re-render every 30s so "x min ago" stays fresh without a network call.
  const [, tick] = useState(0);

  const safeRefresh = useCallback(async () => {
    try {
      await refresh();
      lastErrorShown.current = null;
    } catch (e) {
      const msg = isAuthError(e) ? 'Unauthorized — check the App Secret in Settings.' : errorMessage(e);
      if (lastErrorShown.current !== msg) {
        lastErrorShown.current = msg;
        toast.show(msg, 'error');
      }
    }
  }, [refresh, toast]);

  // Refresh on focus + every 60s while focused.
  useFocusEffect(
    useCallback(() => {
      if (!configured) return;
      safeRefresh();
      const id = setInterval(safeRefresh, REFRESH_MS);
      const clock = setInterval(() => tick((n) => n + 1), 30_000);
      return () => {
        clearInterval(id);
        clearInterval(clock);
      };
    }, [configured, safeRefresh]),
  );

  useEffect(() => {
    if (!pulling) return;
    if (!loading) setPulling(false);
  }, [loading, pulling]);

  const onPull = useCallback(() => {
    setPulling(true);
    safeRefresh();
  }, [safeRefresh]);

  const counts = useMemo(() => {
    let hot = 0;
    let service = 0;
    let unhandled = 0;
    for (const l of leads) {
      if ((l.lead_score ?? 0) >= HOT_THRESHOLD) hot++;
      if (l.intent === 'service') service++;
      if (!handled[l.id]) unhandled++;
    }
    return { all: leads.length, hot, service, unhandled };
  }, [leads, handled]);

  const data = useMemo(() => {
    let list = leads;
    if (filter === 'hot') list = list.filter((l) => (l.lead_score ?? 0) >= HOT_THRESHOLD);
    else if (filter === 'service') list = list.filter((l) => l.intent === 'service');
    else if (filter === 'unhandled') list = list.filter((l) => !handled[l.id]);
    // Server order is newest-first; push handled leads to the bottom, dimmed.
    const open = list.filter((l) => !handled[l.id]);
    const done = filter === 'unhandled' ? [] : list.filter((l) => !!handled[l.id]);
    return [...open, ...done];
  }, [leads, filter, handled]);

  const openLead = useCallback((lead: Lead) => router.push(`/lead/${lead.id}`), [router]);

  if (!configLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!configured) return <Redirect href="/settings" />;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'LeadStream',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={12}
              accessibilityLabel="Settings"
              accessibilityRole="button"
            >
              <Text style={styles.gear}>⚙️</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.filters}>
        <FilterChip label="All" count={counts.all} active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterChip label="🔥 Hot" count={counts.hot} active={filter === 'hot'} onPress={() => setFilter('hot')} />
        <FilterChip label="Service" count={counts.service} active={filter === 'service'} onPress={() => setFilter('service')} />
        <FilterChip label="Unhandled" count={counts.unhandled} active={filter === 'unhandled'} onPress={() => setFilter('unhandled')} />
      </View>

      <FlatList
        data={data}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => <LeadCard lead={item} handled={handled[item.id]} onPress={openLead} />}
        contentContainerStyle={data.length === 0 ? styles.emptyWrap : styles.listContent}
        refreshControl={
          <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          error && leads.length > 0 ? (
            <Text style={styles.stale}>Couldn't refresh — showing leads from {relativeTime(lastUpdated ? new Date(lastUpdated).toISOString() : null) || 'earlier'}.</Text>
          ) : null
        }
        ListEmptyComponent={
          loading && leads.length === 0 ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <EmptyState filter={filter} error={error} onRetry={safeRefresh} />
          )
        }
      />
    </View>
  );
}

function EmptyState({ filter, error, onRetry }: { filter: Filter; error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Couldn't load leads</Text>
        <Text style={styles.emptyBody}>{error}</Text>
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.link}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  const filtered = filter !== 'all';
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{filtered ? 'Nothing matches this filter' : 'No leads yet'}</Text>
      <Text style={styles.emptyBody}>
        {filtered
          ? 'Try "All" to see everything the scanner has found.'
          : 'The scanner runs automatically every 30 minutes and pushes hot leads (score ≥ 70) to this phone. Pull down to refresh, or trigger a scan from Settings.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  gear: { fontSize: 22 },
  filters: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexWrap: 'wrap',
  },
  listContent: { paddingBottom: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: 32, gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  emptyBody: { color: colors.muted, textAlign: 'center', lineHeight: 20 },
  link: { color: colors.blue, fontWeight: '600', marginTop: 4 },
  stale: { color: colors.yellow, fontSize: 12, textAlign: 'center', paddingBottom: 8 },
});
