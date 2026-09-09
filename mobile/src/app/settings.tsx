import React, { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { Button, Card, Label } from '../components/ui';
import { runScan, errorMessage } from '../lib/api';
import { getExpoPushToken, getPushPermission, lastRegisteredToken, registerForPush, type PermissionState } from '../lib/push';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';
import { useToast } from '../lib/toast';
import type { ScanResult } from '../lib/types';

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'On',
  denied: 'Off — enable in phone Settings',
  undetermined: 'Not asked yet',
  unsupported: 'Unavailable on simulator',
};

export default function SettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { me, signOut, refresh } = useStore();

  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [registered, setRegistered] = useState<boolean>(false);
  const [registering, setRegistering] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  const loadPushState = useCallback(async () => {
    const [perm, tok, reg] = await Promise.all([getPushPermission(), getExpoPushToken({ ask: false }), lastRegisteredToken()]);
    setPermission(perm);
    setRegistered(!!tok && reg === tok);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPushState();
    }, [loadPushState]),
  );

  const onRegister = async () => {
    setRegistering(true);
    try {
      const res = await registerForPush({ force: true, ask: true });
      if (res.ok) toast.show('Hot-lead alerts are on for this phone.', 'success');
      else if (res.reason === 'simulator') toast.show('Push needs a physical phone.', 'error');
      else if (res.reason === 'permission') toast.show('Notification permission not granted.', 'error');
      else toast.show(res.error ?? 'Registration failed.', 'error');
    } finally {
      setRegistering(false);
      loadPushState();
    }
  };

  const onScan = async () => {
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

  async function onCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateMsg(null);
    try {
      if (!Updates.isEnabled) {
        setUpdateMsg('Updates are off in development builds.');
        return;
      }
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        setUpdateMsg("You're on the latest version.");
        return;
      }
      setUpdateMsg('Downloading update…');
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (err) {
      setUpdateMsg(`Couldn't check: ${(err as Error).message}`);
    } finally {
      setCheckingUpdate(false);
    }
  }

  const onSignOut = () => {
    Alert.alert('Sign out?', 'You will stop receiving lead alerts on this phone until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/login');
        },
      },
    ]);
  };

  const version = `${Constants.expoConfig?.version ?? '?'}${Updates.updateId ? ` · ${Updates.updateId.slice(0, 6)}` : ''}`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Label>Account</Label>
        <Row k="Name" v={me?.name ?? '—'} />
        <Row k="Email" v={me?.email ?? '—'} />
        <Row k="Role" v={me?.role === 'owner' ? 'Owner' : 'Staff'} />
        <Button title="Sign out" variant="danger" onPress={onSignOut} style={styles.btn} />
      </Card>

      <Card style={styles.card}>
        <Label>Hot-lead alerts</Label>
        <Row k="Notifications" v={PERMISSION_LABEL[permission]} />
        <Row k="This phone" v={registered ? 'Receiving alerts' : 'Not registered yet'} />
        <Button
          title={registered ? 'Re-register this phone' : 'Turn on alerts for this phone'}
          onPress={onRegister}
          loading={registering}
          style={styles.btn}
          icon="🔔"
        />
        <Text style={styles.hint}>Alerts fire for service leads scoring 70+. Tap one to open the lead.</Text>
      </Card>

      {me?.role === 'owner' ? (
        <Card style={styles.card}>
          <Label>Scanner (owner)</Label>
          <Text style={styles.hint}>Reddit is scanned automatically every 10 minutes. Trigger one now to pick up anything new.</Text>
          <Button title={scanning ? 'Scanning… (up to 5 min)' : 'Run scan now'} onPress={onScan} loading={scanning} style={styles.btn} icon="🔍" />
          {scanResult ? (
            <Text style={styles.result}>
              Fetched {scanResult.fetched} · New {scanResult.new} · Hot {scanResult.hot}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Label>App</Label>
        <Row k="Version" v={version} />
        <Button title={checkingUpdate ? 'Checking…' : 'Check for updates'} onPress={onCheckUpdate} loading={checkingUpdate} style={styles.btn} icon="⬇️" />
        {updateMsg ? <Text style={styles.result}>{updateMsg}</Text> : null}
      </Card>

      <Text style={styles.footer}>LeadStream · {Device.deviceName ?? Device.modelName ?? Platform.OS}</Text>
    </ScrollView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={styles.rowVal} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { gap: 8 },
  btn: { marginTop: 6 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  result: { color: colors.green, fontWeight: '600', marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowKey: { color: colors.muted, fontSize: 14 },
  rowVal: { color: colors.text, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  footer: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 8 },
});
