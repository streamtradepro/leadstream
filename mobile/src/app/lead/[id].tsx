import React, { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Button, Card, Chip, IntentChip, Label, ScoreBadge } from '../../components/ui';
import { draftReply, errorMessage } from '../../lib/api';
import { useStore } from '../../lib/store';
import { colors, scoreColor } from '../../lib/theme';
import { absoluteTime, relativeTime } from '../../lib/time';
import { useToast } from '../../lib/toast';
import { leadPlace } from '../../lib/types';

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { getById, leads, handled, setStatus, patchLead, refresh, loading } = useStore();
  const lead = id ? getById(id) : undefined;
  const status = id ? handled[id] : undefined;

  const [drafting, setDrafting] = useState(false);
  const [triedRefresh, setTriedRefresh] = useState(false);

  // Opened via deep link before the list loaded? Fetch once.
  useEffect(() => {
    if (!lead && !triedRefresh && !loading) {
      setTriedRefresh(true);
      refresh().catch(() => {});
    }
  }, [lead, triedRefresh, loading, refresh, leads.length]);

  const haptic = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

  const openReddit = useCallback(() => {
    if (!lead?.url) {
      toast.show('This lead has no URL.', 'error');
      return;
    }
    Linking.openURL(lead.url).catch(() => toast.show('Could not open Reddit.', 'error'));
  }, [lead, toast]);

  const onDraft = useCallback(async () => {
    if (!lead) return;
    setDrafting(true);
    try {
      const reply = await draftReply(lead.id);
      patchLead(lead.id, { reply_draft: reply });
      haptic();
      toast.show('Draft ready.', 'success');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setDrafting(false);
    }
  }, [lead, patchLead, toast]);

  const copyDraft = useCallback(async (): Promise<boolean> => {
    if (!lead?.reply_draft) {
      toast.show('Draft a reply first.', 'error');
      return false;
    }
    try {
      await Clipboard.setStringAsync(lead.reply_draft);
      haptic();
      return true;
    } catch {
      toast.show('Copy failed.', 'error');
      return false;
    }
  }, [lead, toast]);

  const onCopy = useCallback(async () => {
    if (await copyDraft()) toast.show('Reply copied.', 'success');
  }, [copyDraft, toast]);

  const onCopyAndOpen = useCallback(async () => {
    if (await copyDraft()) {
      toast.show('Copied — paste it on Reddit.', 'success');
      openReddit();
    }
  }, [copyDraft, openReddit, toast]);

  const mark = useCallback(
    async (next: 'replied' | 'skipped') => {
      if (!lead) return;
      await setStatus(lead.id, status === next ? null : next);
      if (status !== next) {
        haptic();
        toast.show(next === 'replied' ? 'Marked as replied.' : 'Skipped.', 'success');
        if (router.canGoBack()) router.back();
      }
    },
    [lead, status, setStatus, toast, router],
  );

  if (!lead) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Lead' }} />
        <Text style={styles.missingTitle}>{loading ? 'Loading lead…' : 'Lead not found'}</Text>
        {!loading ? (
          <Text style={styles.missingBody}>It may be older than the latest 200 leads the server returns.</Text>
        ) : null}
        <Button title="Back to leads" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    );
  }

  const score = lead.lead_score ?? 0;
  const postedIso = lead.posted_at ?? lead.created_at;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: leadPlace(lead) }} />

      <View style={styles.headRow}>
        <ScoreBadge score={lead.lead_score} size="lg" />
        <View style={styles.headMeta}>
          <View style={styles.chips}>
            <IntentChip intent={lead.intent} />
            {status ? <Chip label={status === 'replied' ? 'REPLIED' : 'SKIPPED'} color={colors.faint} /> : null}
          </View>
          <Text style={styles.place}>{leadPlace(lead)}</Text>
          {lead.location_raw && lead.location_raw !== leadPlace(lead) ? (
            <Text style={styles.metaLine}>"{lead.location_raw}"</Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.title} selectable>
        {lead.title || '(untitled)'}
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.metaLine}>r/{lead.subreddit ?? '?'}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaLine}>u/{lead.author ?? '?'}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaLine}>
          {relativeTime(postedIso)}
          {typeof lead.reddit_score === 'number' ? ` · ▲ ${lead.reddit_score}` : ''}
        </Text>
      </View>
      {postedIso ? <Text style={styles.metaFaint}>{absoluteTime(postedIso)}</Text> : null}

      {lead.body ? (
        <Card>
          <Text style={styles.body} selectable>
            {lead.body}
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.bodyEmpty}>No post body (link or image post).</Text>
        </Card>
      )}

      <Card style={{ borderColor: scoreColor(score) }}>
        <Label>Why {score}</Label>
        <Text style={styles.reason}>{lead.reasoning || 'No reasoning recorded.'}</Text>
      </Card>

      <View style={styles.actions}>
        <Button title="Open on Reddit" onPress={openReddit} icon="↗" />
        <Button
          title={lead.reply_draft ? 'Redraft AI reply' : 'Draft AI reply'}
          variant="primary"
          onPress={onDraft}
          loading={drafting}
          icon="✨"
        />
      </View>

      {drafting ? (
        <Text style={styles.hint}>Drafting takes about 10 seconds…</Text>
      ) : null}

      {lead.reply_draft ? (
        <Card style={styles.draftCard}>
          <Label>Reply draft</Label>
          <Text style={styles.draft} selectable>
            {lead.reply_draft}
          </Text>
          <View style={styles.actions}>
            <Button title="Copy reply" onPress={onCopy} icon="📋" style={styles.flex} />
            <Button title="Open Reddit & copy" variant="primary" onPress={onCopyAndOpen} icon="🚀" style={styles.flex} />
          </View>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          title={status === 'replied' ? 'Unmark replied' : 'Mark replied'}
          onPress={() => mark('replied')}
          icon="✓"
          style={styles.flex}
        />
        <Button
          title={status === 'skipped' ? 'Unskip' : 'Skip'}
          variant="danger"
          onPress={() => mark('skipped')}
          icon="✕"
          style={styles.flex}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 14, gap: 12, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg },
  missingTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  missingBody: { color: colors.muted, textAlign: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headMeta: { flex: 1, gap: 4 },
  chips: { flexDirection: 'row', gap: 6 },
  place: { color: colors.text, fontSize: 17, fontWeight: '700' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', lineHeight: 27 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  metaLine: { color: colors.muted, fontSize: 13 },
  metaDot: { color: colors.faint },
  metaFaint: { color: colors.faint, fontSize: 12, marginTop: -8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  bodyEmpty: { color: colors.faint, fontStyle: 'italic' },
  reason: { color: colors.text, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  hint: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  draftCard: { gap: 10, borderColor: colors.accent },
  draft: { color: colors.text, fontSize: 15, lineHeight: 22 },
});
