/**
 * Signed-in session (staff token + profile), kept in the device keychain
 * (expo-secure-store). The API base URL is fixed; EXPO_PUBLIC_API_URL can
 * override it at build time for a staging backend.
 */
import * as SecureStore from 'expo-secure-store';

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'staff';
}

export interface Session {
  token: string;
  staff: Staff;
}

export const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://leadstream-murex.vercel.app').replace(/\/+$/, '');

const KEY_SESSION = 'ls_session_v1';
// Legacy keys from the app-secret era — cleared on first run of this version.
const LEGACY_KEYS = ['ls_base_url', 'ls_app_secret'];

let cache: Session | null | undefined;

export async function loadSession(): Promise<Session | null> {
  if (cache !== undefined) return cache;
  try {
    const raw = await SecureStore.getItemAsync(KEY_SESSION);
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    cache = parsed && parsed.token && parsed.staff ? parsed : null;
  } catch {
    cache = null;
  }
  LEGACY_KEYS.forEach((k) => SecureStore.deleteItemAsync(k).catch(() => {}));
  return cache;
}

export async function saveSession(next: Session | null): Promise<void> {
  cache = next;
  if (next) await SecureStore.setItemAsync(KEY_SESSION, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(KEY_SESSION).catch(() => {});
}
