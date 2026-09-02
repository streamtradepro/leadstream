/** Small shared building blocks: buttons, chips, score badge, cards. */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { alpha, colors, scoreColor } from '../lib/theme';

export function ScoreBadge({ score, size = 'md' }: { score: number | null; size?: 'md' | 'lg' }) {
  const s = score ?? 0;
  const c = scoreColor(s);
  const big = size === 'lg';
  return (
    <View
      style={[
        styles.score,
        { backgroundColor: alpha(c, 0.18), borderColor: c },
        big && { minWidth: 64, paddingVertical: 8 },
      ]}
    >
      <Text style={[styles.scoreText, { color: c }, big && { fontSize: 24 }]}>{s}</Text>
    </View>
  );
}

export function Chip({
  label,
  color = colors.muted,
  filled = false,
}: {
  label: string;
  color?: string;
  filled?: boolean;
}) {
  return (
    <View
      style={[
        styles.chip,
        { borderColor: color, backgroundColor: filled ? alpha(color, 0.18) : 'transparent' },
      ]}
    >
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export function IntentChip({ intent }: { intent: string | null }) {
  if (intent === 'service') return <Chip label="SERVICE" color={colors.green} filled />;
  if (intent === 'diy') return <Chip label="DIY" color={colors.purple} />;
  return <Chip label={(intent ?? '?').toUpperCase()} />;
}

export function FilterChip({
  label,
  active,
  onPress,
  count,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filter, active && styles.filterActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>
        {label}
        {typeof count === 'number' ? ` ${count}` : ''}
      </Text>
    </Pressable>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'secondary',
  loading = false,
  disabled = false,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: string;
}) {
  const isOff = disabled || loading;
  const bg =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? alpha(colors.red, 0.15)
        : variant === 'ghost'
          ? 'transparent'
          : colors.cardAlt;
  const border =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.red
        : variant === 'ghost'
          ? 'transparent'
          : colors.border;
  const fg = variant === 'primary' ? '#0d1117' : variant === 'danger' ? colors.red : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: isOff ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, { color: fg }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  score: {
    minWidth: 44,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  filter: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterActive: { backgroundColor: alpha(colors.accent, 0.18), borderColor: colors.accent },
  filterText: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  filterTextActive: { color: colors.accent },
  btn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnText: { fontWeight: '700', fontSize: 15 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
});
