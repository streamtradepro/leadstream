/**
 * Calls to the LeadStream backend (Next.js at the repo root). Every route is
 * gated by a staff token (`Authorization: Bearer …`) issued by /api/auth/login.
 */
import { BASE_URL, loadSession, saveSession, type Session, type Staff } from './config';
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
  /** Skip the session (login itself). */
  anonymous?: boolean;
}

/** Called when the server rejects the token (deactivated, password reset, expired). */
let onSignedOut: (() => void) | null = null;
export function setSignedOutHandler(fn: (() => void) | null) {
  onSignedOut = fn;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.anonymous) {
    const session = await loadSession();
    if (!session) throw new ApiError(401, 'Please sign in.');
    headers.Authorization = `Bearer ${session.token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, controller.signal.aborted ? 'Request timed out.' : 'Network error — check your connection.');
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) {
    if (!opts.anonymous) {
      await saveSession(null);
      onSignedOut?.();
      throw new ApiError(401, 'Your sign-in is no longer valid. Please sign in again.');
    }
    throw new ApiError(401, typeof json.error === 'string' ? json.error : 'Wrong email or password.');
  }
  if (!res.ok) {
    const msg = typeof json.error === 'string' ? json.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return json as T;
}

/** POST /api/auth/login → token + profile. */
export async function login(email: string, password: string): Promise<Session> {
  const json = await request<{ token?: string; staff?: Staff }>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });
  if (!json.token || !json.staff) throw new ApiError(500, 'Server returned no session.');
  return { token: json.token, staff: json.staff };
}

/** GET /api/leads → latest 200 non-noise leads, newest first. */
export async function fetchLeads(): Promise<Lead[]> {
  const json = await request<{ leads?: Lead[] }>('/api/leads');
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

/** POST /api/lead-status → persists replied/skipped/new on the server, with who did it. */
export function setLeadStatus(id: string, status: 'new' | 'replied' | 'skipped'): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/lead-status', { method: 'POST', body: { id, status } });
}

/** POST /api/devices → upserts an Expo push token for this staff member. */
export function registerDevice(token: string, label: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/devices', { method: 'POST', body: { token, label } });
}

/** POST /api/scan → runs a full scan (owner only). Can take up to 5 minutes. */
export function runScan(): Promise<ScanResult> {
  return request<ScanResult>('/api/scan', { method: 'POST', timeoutMs: 330_000 });
}
