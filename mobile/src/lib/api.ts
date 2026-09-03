/**
 * Calls to the LeadStream backend (Next.js at the repo root). Every route is
 * gated by the `x-app-secret` header — see app/api/** in the backend.
 */
import { loadConfig, type AppConfig } from './config';
import type { Lead, ScanResult } from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const isAuthError = (e: unknown): boolean => e instanceof ApiError && e.status === 401;
export const isNetworkError = (e: unknown): boolean => e instanceof ApiError && e.status === 0;

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? 'Unknown error');
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Abort after this many ms. Default 20s. */
  timeoutMs?: number;
  /** Override the stored config (used by Settings "Save & test"). */
  config?: AppConfig;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const cfg = opts.config ?? (await loadConfig());
  if (!cfg.appSecret) {
    throw new ApiError(0, 'Not set up yet — add the API URL and App Secret in Settings.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-app-secret': cfg.appSecret,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      0,
      controller.signal.aborted
        ? 'Request timed out.'
        : 'Network error — check the API URL and your connection.',
    );
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new ApiError(401, 'Unauthorized — the App Secret is wrong.');
  if (!res.ok) {
    const msg = typeof json.error === 'string' ? json.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return json as T;
}

/** GET /api/leads → latest 200 non-noise leads, newest first. */
export async function fetchLeads(config?: AppConfig): Promise<Lead[]> {
  const json = await request<{ leads?: Lead[] }>('/api/leads', { config });
  return Array.isArray(json.leads) ? json.leads : [];
}

/** POST /api/reply → AI-drafted Reddit reply (~10s; also saved server-side). */
export async function draftReply(id: string): Promise<string> {
  const json = await request<{ reply?: string }>('/api/reply', {
    method: 'POST',
    body: { id },
    timeoutMs: 75_000,
  });
  if (typeof json.reply !== 'string') throw new ApiError(500, 'Server returned no draft.');
  return json.reply;
}

/** POST /api/lead-status → persists replied/skipped/new on the server (hides skipped from every device). */
export function setLeadStatus(id: string, status: 'new' | 'replied' | 'skipped'): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/lead-status', { method: 'POST', body: { id, status } });
}

/** POST /api/devices → upserts an Expo push token. */
export function registerDevice(token: string, label: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/devices', { method: 'POST', body: { token, label } });
}

/** POST /api/scan → runs a full scan. Can take up to 5 minutes (maxDuration 300). */
export function runScan(): Promise<ScanResult> {
  return request<ScanResult>('/api/scan', { method: 'POST', timeoutMs: 330_000 });
}
