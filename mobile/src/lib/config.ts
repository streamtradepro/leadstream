/**
 * API base URL + app secret, kept in the device keychain (expo-secure-store).
 * The secret never touches AsyncStorage or the JS bundle.
 */
import * as SecureStore from 'expo-secure-store';

export interface AppConfig {
  baseUrl: string;
  appSecret: string;
}

export const DEFAULT_BASE_URL = 'https://leadstream-murex.vercel.app';

const KEY_URL = 'ls_base_url';
const KEY_SECRET = 'ls_app_secret';

let cache: AppConfig | null = null;

export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

export async function loadConfig(): Promise<AppConfig> {
  if (cache) return cache;
  const [url, secret] = await Promise.all([
    SecureStore.getItemAsync(KEY_URL),
    SecureStore.getItemAsync(KEY_SECRET),
  ]);
  cache = { baseUrl: url || DEFAULT_BASE_URL, appSecret: secret || '' };
  return cache;
}

export async function saveConfig(next: AppConfig): Promise<AppConfig> {
  const clean: AppConfig = {
    baseUrl: normalizeBaseUrl(next.baseUrl) || DEFAULT_BASE_URL,
    appSecret: next.appSecret.trim(),
  };
  await Promise.all([
    SecureStore.setItemAsync(KEY_URL, clean.baseUrl),
    SecureStore.setItemAsync(KEY_SECRET, clean.appSecret),
  ]);
  cache = clean;
  return clean;
}

export function isConfigured(c: AppConfig | null | undefined): boolean {
  return !!c && !!c.baseUrl && !!c.appSecret;
}
