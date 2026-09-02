/** Mirrors supabase/schema.sql `leads` (server never returns intent='noise'). */
export interface Lead {
  id: string;
  reddit_id: string;
  subreddit: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
  url: string | null;
  posted_at: string | null;
  reddit_score: number | null;
  intent: 'service' | 'diy' | 'noise' | null;
  location_raw: string | null;
  city: string | null;
  state: string | null;
  lead_score: number | null;
  reasoning: string | null;
  reply_draft: string | null;
  status: 'new' | 'replied' | 'skipped' | null;
  pushed_at: string | null;
  created_at: string | null;
}

export interface ScanResult {
  fetched: number;
  new: number;
  hot: number;
}

/** "Fort Lauderdale, FL" — or "r/garagedoors" when no location was extracted. */
export function leadPlace(lead: Lead): string {
  const where = [lead.city, lead.state].filter(Boolean).join(', ');
  if (where) return where;
  return lead.subreddit ? `r/${lead.subreddit}` : 'Reddit';
}
