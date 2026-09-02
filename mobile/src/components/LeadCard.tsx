import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';
import { relativeTime } from '../lib/time';
import { CATEGORY_LABEL, leadPlace, type Lead } from '../lib/types';
import type { HandledStatus } from '../lib/handled';
import { Chip, IntentChip, ScoreBadge } from './ui';

interface Props {
  lead: Lead;
  handled?: HandledStatus;
  onPress: (lead: Lead) => void;
}

function LeadCardInner({ lead, handled, onPress }: Props) {
  return (
    <Pressable
      onPress={() => onPress(lead)}
      style={({ pressed }) => [styles.card, handled && styles.dim, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <View style={styles.row}>
        <ScoreBadge score={lead.lead_score} />
        <View style={styles.meta}>
          <View style={styles.metaTop}>
            <IntentChip intent={lead.intent} />
            {lead.category && lead.category !== 'other' ? (
              <Chip label={CATEGORY_LABEL[lead.category] ?? lead.category} color={colors.accent} />
            ) : null}
            {handled ? (
              <Chip label={handled === 'replied' ? 'REPLIED' : 'SKIPPED'} color={colors.faint} />
            ) : null}
            <Text style={styles.time}>{relativeTime(lead.posted_at ?? lead.created_at)}</Text>
          </View>
          <Text style={styles.place} numberOfLines={1}>
            {leadPlace(lead)}
            {lead.city || lead.state ? <Text style={styles.sub}>  ·  r/{lead.subreddit}</Text> : null}
          </Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {lead.title || '(untitled)'}
      </Text>
      {lead.reasoning ? (
        <Text style={styles.reason} numberOfLines={1}>
          {lead.reasoning}
        </Text>
      ) : null}
    </Pressable>
  );
}

export const LeadCard = memo(LeadCardInner);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 10,
    gap: 8,
  },
  pressed: { opacity: 0.8 },
  dim: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  meta: { flex: 1, gap: 4 },
  metaTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { color: colors.muted, fontSize: 12, marginLeft: 'auto' },
  place: { color: colors.text, fontWeight: '700', fontSize: 14 },
  sub: { color: colors.muted, fontWeight: '400', fontSize: 12 },
  title: { color: colors.text, fontSize: 15, lineHeight: 21 },
  reason: { color: colors.muted, fontSize: 13 },
});
