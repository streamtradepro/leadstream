-- LeadStream schema. Run once in the Supabase SQL editor.
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  reddit_id text unique not null,
  subreddit text,
  title text,
  body text,
  author text,
  url text,
  posted_at timestamptz,
  reddit_score int default 0,
  intent text,               -- service | diy | noise
  location_raw text,
  city text,
  state text,
  lead_score int default 0,
  reasoning text,
  reply_draft text,
  status text default 'new', -- new | replied | skipped
  pushed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists leads_score_idx on leads (lead_score desc);
create index if not exists leads_created_idx on leads (created_at desc);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  expo_push_token text unique not null,
  label text,
  created_at timestamptz default now()
);

-- Server (service role) access only; no client policies on purpose.
alter table leads enable row level security;
alter table devices enable row level security;

-- Website form submissions (usahomerepairs.net) — pushed to the phone like Reddit leads.
create table if not exists site_leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  zip text,
  service text,
  message text,
  source text default 'website',
  status text default 'new',
  created_at timestamptz default now()
);
alter table site_leads enable row level security;

-- Call-button taps on usahomerepairs.net (city from link/IP geo) — where calls originate.
create table if not exists call_taps (
  id uuid primary key default gen_random_uuid(),
  city text,
  state text,
  geo_source text,   -- link | geo | null
  page text,
  label text,
  user_agent text,
  created_at timestamptz default now()
);
create index if not exists call_taps_created_idx on call_taps (created_at desc);
alter table call_taps enable row level security;

-- Multi-category (2026-09-02): garage_door | gate | locksmith | dryer_vent | air_duct | chimney | other
alter table leads add column if not exists category text;
create index if not exists leads_category_idx on leads (category);
create index if not exists leads_state_idx on leads (state);

-- Reddit click id (rdt_cid) captured on landing, sent with call taps (2026-09-08)
alter table call_taps add column if not exists click_id text;

-- Staff accounts for the phone app (2026-09-08). Password = scrypt "salt:hex"; tokens are HMAC(APP_SECRET).
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  role text not null default 'staff',   -- owner | staff
  active boolean not null default true,
  token_version int not null default 1, -- bump to sign the person out everywhere
  last_seen_at timestamptz,
  created_at timestamptz default now()
);
alter table staff enable row level security;
alter table leads add column if not exists handled_by text;
alter table leads add column if not exists handled_by_id uuid;
alter table leads add column if not exists handled_at timestamptz;
alter table devices add column if not exists staff_id uuid;
alter table devices add column if not exists staff_name text;

-- Login lockout (2026-09-10): 8 wrong passwords → locked 15 minutes.
alter table staff add column if not exists failed_logins int not null default 0;
alter table staff add column if not exists locked_until timestamptz;

-- kind = call (button tap) | view (tagged landing-page visit) — lets the dashboard show visits → taps per campaign (2026-09-10)
alter table call_taps add column if not exists kind text not null default 'call';
create index if not exists call_taps_kind_idx on call_taps (kind, created_at desc);
