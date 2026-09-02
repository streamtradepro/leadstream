import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Device from 'expo-device';
import { Button, Card, Label } from '../components/ui';
import { fetchLeads, runScan, errorMessage } from '../lib/api';
import { DEFAULT_BASE_URL, normalizeBaseUrl } from '../lib/config';
import {
  easProjectId,
  getExpoPushToken,
  getPushPermission,
  lastRegisteredToken,
  registerForPush,
  truncateToken,
  type PermissionState,
} from '../lib/push';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';
import { useToast } from '../lib/toast';
import type { ScanResult } from '../lib/types';

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'Granted',
  denied: 'Denied — enable in phone Settings',
  undetermined: 'Not asked yet',
  unsupported: 'Unavailable on simulator',
};

export default function SettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { config, configured, updateConfig, refresh } = useStore();

  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? DEFAULT_BASE_URL);
  const [secret, setSecret] = useState(config?.appSecret ?? '');
  const [saving, setSaving] = useState(false);

  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [token, setToken] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // Sync inputs once the stored config arrives (Settings can mount before SecureStore is read).
  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl);
      setSecret(config.appSecret);
    }
  }, [config]);

  const loadPushState = useCallback(async () => {
    const [perm, tok, reg] = await Promise.all([
      getPushPermission(),
      getExpoPushToken({ ask: false }),
      lastRegisteredToken(),
    ]);
    setPermission(perm);
    setToken(tok);
    setRegistered(reg);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPushState();
    }, [loadPushState]),
  );

  const onSave = async () => {
    Keyboard.dismiss();
    const candidate = { baseUrl: normalizeBaseUrl(baseUrl) || DEFAULT_BASE_URL, appSecret: secret.trim() };
    if (!candidate.appSecret) {
      toast.show('Enter the App Secret first.', 'error');
      return;
    }
    setSaving(true);
    try {
      const leads = await fetchLeads(candidate); // verifies URL + secret before saving
      const wasConfigured = configured;
      await updateConfig(candidate);
      toast.show(`Connected — ${leads.length} leads on the server.`, 'success');
      // First successful setup: ask for push permission + register this phone.
      const reg = await registerForPush({ force: true, ask: true });
      if (reg.ok) toast.show('Push alerts registered for this phone.', 'success');
      await loadPushState();
      refresh().catch(() => {});
      if (wasConfigured && router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const onRegister = async () => {
    if (!configured) {
      toast.show('Save the API URL and secret first.', 'error');
      return;
    }
    setRegistering(true);
    try {
      const res = await registerForPush({ force: true, ask: true });
      if (res.ok) toast.show('Registered for hot-lead alerts.', 'success');
      else if (res.reason === 'simulator') toast.show('Push needs a physical phone.', 'error');
      else if (res.reason === 'permission') toast.show('Notification permission not granted.', 'error');
      else toast.show(res.error ?? 'Registration failed.', 'error');
    } finally {
      setRegistering(false);
      loadPushState();
    }
  };

  const onScan = async () => {
    if (!configured) {
      toast.show('Save the API URL and secret first.', 'error');
      return;
    }
    setScanning(true);
    setScanResult(null);
    try {
      const res = await runScan();
      setScanResult(res);
      toast.show(`Scan done — ${res.new} new, ${res.hot} hot.`, 'success');
      refresh().catch(() => {});
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setScanning(false);
    }
  };

  const projectId = easProjectId();

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!configured ? (
          <Text style={styles.intro}>
            Welcome. Point the app at your LeadStream backend and paste the App Secret (the APP_SECRET env var on
            Vercel). Then this phone can list leads and receive hot-lead push alerts.
          </Text>
        ) : null}

        <Card style={styles.card}>
          <Label>Backend</Label>
          <Text style={styles.fieldLabel}>API base URL</Text>
          <TextInput
            style={styles.input}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={DEFAULT_BASE_URL}
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
          />
          <Text style={styles.fieldLabel}>App Secret</Text>
          <TextInput
            style={styles.input}
            value={secret}
            onChangeText={setSecret}
            placeholder="APP_SECRET"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Button title="Save & test" variant="primary" onPress={onSave} loading={saving} style={styles.btn} />
        </Card>

        <Card style={styles.card}>
          <Label>Push alerts</Label>
          <Row k="Permission" v={PERMISSION_LABEL[permission]} />
          <Row k="Push token" v={truncateToken(token)} mono />
          <Row
            k="Registered"
            v={registered ? (registered === token ? 'Yes — this token' : 'Yes — older token') : 'Not yet'}
          />
          <Row k="EAS project" v={projectId ? projectId.slice(0, 8) + '…' : 'not set (run eas init)'} mono />
          <Button
            title="Register this phone for alerts"
            onPress={onRegister}
            loading={registering}
            disabled={!configured}
            style={styles.btn}
            icon="🔔"
          />
          {Platform.OS === 'android' && !Device.isDevice ? null : (
            <Text style={styles.hint}>
              {Platform.OS === 'android'
                ? 'Android: remote push does not arrive inside Expo Go (SDK 53+) — use a dev or production build.'
                : 'Alerts fire for service leads scoring 70+. Tap one to open the lead.'}
            </Text>
          )}
        </Card>

        <Card style={styles.card}>
          <Label>Scanner</Label>
          <Text style={styles.hint}>
            The backend scans Reddit automatically. Trigger one now to pick up anything new — it can take a few
            minutes.
          </Text>
          <Button
            title={scanning ? 'Scanning… (up to 5 min)' : 'Run scan now'}
            onPress={onScan}
            loading={scanning}
            disabled={!configured}
            style={styles.btn}
            icon="🔍"
          />
          {scanResult ? (
            <Text style={styles.result}>
              Fetched {scanResult.fetched} · New {scanResult.new} · Hot {scanResult.hot}
            </Text>
          ) : null}
        </Card>

        <Text style={styles.footer}>
          LeadStream · {Device.deviceName ?? Device.modelName ?? Platform.OS}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={[styles.rowVal, mono && styles.mono]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  intro: { color: colors.muted, lineHeight: 20, paddingHorizontal: 4 },
  card: { gap: 8 },
  fieldLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
  },
  btn: { marginTop: 6 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  result: { color: colors.green, fontWeight: '600', marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowKey: { color: colors.muted, fontSize: 14 },
  rowVal: { color: colors.text, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  footer: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
