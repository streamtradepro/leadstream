import { db } from '../lib/db.js';

export const dynamic = 'force-dynamic';

function scoreColor(s) {
  if (s >= 85) return '#f85149';
  if (s >= 70) return '#d29922';
  if (s >= 40) return '#58a6ff';
  return '#8b949e';
}

export default async function Home() {
  let leads = [];
  let err = null;
  try {
    const { data, error } = await db()
      .from('leads')
      .select('*')
      .neq('intent', 'noise')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    leads = data || [];
  } catch (e) {
    err = e.message;
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>
        LeadStream <span style={{ color: '#8b949e', fontWeight: 400 }}>· garage doors · nationwide</span>
      </h1>
      <p style={{ color: '#8b949e', fontSize: 13, marginTop: 0 }}>
        {err
          ? `Not connected: ${err} — check .env.local / Supabase setup.`
          : `${leads.length} leads shown (newest first). Refresh for latest.`}
      </p>
      {leads.map((l) => (
        <div
          key={l.id}
          style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ color: scoreColor(l.lead_score) }}>{l.lead_score}</strong>
            <span style={{ color: '#8b949e', fontSize: 12 }}>
              {l.category ? l.category.replace('_', ' ') + ' · ' : ''}{l.intent} · r/{l.subreddit}
              {(l.city || l.state) && ` · ${[l.city, l.state].filter(Boolean).join(', ')}`}
            </span>
            <span style={{ color: '#484f58', fontSize: 12 }}>
              {new Date(l.posted_at).toLocaleString()}
            </span>
          </div>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#e6edf3', textDecoration: 'none', display: 'block', marginTop: 6 }}
          >
            {l.title}
          </a>
          {l.reasoning && (
            <div style={{ color: '#8b949e', fontSize: 12, marginTop: 6 }}>{l.reasoning}</div>
          )}
          {l.reply_draft && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: 10,
                fontSize: 13,
                marginTop: 8,
              }}
            >
              {l.reply_draft}
            </pre>
          )}
        </div>
      ))}
    </main>
  );
}
