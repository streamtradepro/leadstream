/**
 * Expo push registration: ask permission, fetch the Expo push token, POST it to
 * the backend (/api/devices). Best-effort — never throws to the caller unless
 * asked to via `registerForPush` returning a result object.
 *
 * NOTE: remote push does NOT work in Expo Go on Android (SDK 53+) — it works in
 * dev/production builds. iOS Expo Go still receives remote push.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerDevice } from './api';

const KEY_REGISTERED = 'ls_registered_push_token';

// Foreground notifications should still show a banner + sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getPushPermission(): Promise<PermissionState> {
  if (!Device.isDevice) return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status as PermissionState;
  } catch {
    return 'undetermined';
  }
}

/** The EAS projectId, when `eas init` has been run (Constants.expoConfig.extra.eas.projectId). */
export function easProjectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
    ?.projectId;
  return (typeof fromConfig === 'string' && fromConfig) || fromEas || undefined;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Hot leads',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#f0883e',
  });
}

/**
 * Returns the Expo push token, requesting permission when `ask` is true.
 * Returns null on simulators, when permission is denied, or on any failure.
 */
export async function getExpoPushToken(opts: { ask: boolean }): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    await ensureAndroidChannel();

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && opts.ask) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const projectId = easProjectId();
    const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return res.data || null;
  } catch (err) {
    console.warn('[push] token fetch failed:', err);
    return null;
  }
}

export async function lastRegisteredToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_REGISTERED);
  } catch {
    return null;
  }
}

export interface RegisterResult {
  ok: boolean;
  token: string | null;
  /** Why nothing was sent (when ok=false), or 'unchanged' when already registered. */
  reason?: 'simulator' | 'permission' | 'unchanged' | 'error';
  error?: string;
}

/**
 * Register this phone with the backend. Skips the network call when the token
 * matches the last one we successfully registered, unless `force`.
 */
export async function registerForPush(opts: { force?: boolean; ask?: boolean } = {}): Promise<RegisterResult> {
  if (!Device.isDevice) return { ok: false, token: null, reason: 'simulator' };
  const token = await getExpoPushToken({ ask: opts.ask ?? true });
  if (!token) return { ok: false, token: null, reason: 'permission' };

  if (!opts.force) {
    const prev = await lastRegisteredToken();
    if (prev === token) return { ok: true, token, reason: 'unchanged' };
  }

  const label = `${Device.deviceName ?? Device.modelName ?? 'Phone'} (${Platform.OS})`;
  try {
    await registerDevice(token, label);
    await AsyncStorage.setItem(KEY_REGISTERED, token).catch(() => {});
    return { ok: true, token };
  } catch (err) {
    return { ok: false, token, reason: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

export function truncateToken(token: string | null | undefined): string {
  if (!token) return '—';
  if (token.length <= 28) return token;
  return `${token.slice(0, 22)}…${token.slice(-5)}`;
}
