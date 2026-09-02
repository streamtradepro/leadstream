// Service categories LeadStream scans for. Keys are stored in leads.category.
// `query` is a Reddit search expression (sitewide, newest first).
export const CATEGORIES = {
  garage_door: {
    label: 'Garage door',
    emoji: '\u{1F6AA}',
    query: '"garage door"',
    persona: 'garage door technician',
  },
  gate: {
    label: 'Gate',
    emoji: '\u{1F6A7}',
    query: '"gate opener" OR "driveway gate" OR "automatic gate" OR "gate motor" OR "sliding gate" OR "swing gate" OR "electric gate"',
    persona: 'automatic gate technician',
  },
  locksmith: {
    label: 'Locksmith',
    emoji: '\u{1F511}',
    query: 'locksmith OR "locked out" OR rekey OR "rekeyed" OR "change the locks" OR "changing locks" OR deadbolt',
    persona: 'licensed locksmith',
  },
  dryer_vent: {
    label: 'Dryer vent',
    emoji: '\u{1F525}',
    query: '"dryer vent" OR "dryer duct" OR "dryer exhaust"',
    persona: 'dryer vent cleaning technician',
  },
  air_duct: {
    label: 'Air duct',
    emoji: '\u{1F32C}\u{FE0F}',
    query: '"duct cleaning" OR "air duct" OR "air ducts" OR "hvac ducts" OR "ductwork cleaning"',
    persona: 'air duct cleaning technician',
  },
  chimney: {
    label: 'Chimney',
    emoji: '\u{1F3E0}',
    query: 'chimney (sweep OR sweeping OR cleaning OR repair OR inspection OR cap OR liner OR leak OR creosote OR flashing OR crown)',
    persona: 'chimney sweep and repair technician',
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

// One combined expression for scanning a whole subreddit's recent posts.
export const ALL_TERMS_QUERY =
  '"garage door" OR locksmith OR "locked out" OR rekey OR deadbolt OR "dryer vent" OR "duct cleaning" OR "air duct" OR chimney OR "gate opener" OR "driveway gate" OR "automatic gate"';

// Regional sweep: state + major-metro subreddits. STATE is applied when the
// classifier can't find a more specific location in the post itself.
export const REGION_SUBS = {
  FL: [
    'florida', 'Miami', 'orlando', 'tampa', 'jacksonville', 'fortlauderdale', 'StPetersburgFL',
    'tallahassee', 'GNV', 'sarasota', 'Pensacola', 'boca', 'WestPalmBeach', 'naples', 'Daytona',
    'ocala', 'capecoral', 'fortmyers', 'lakeland', 'Brevard', 'PalmBeach', 'Hialeah', 'coralsprings', 'hollywoodfl', 'PortStLucie', 'Kissimmee', 'Bradenton', 'PanamaCity', 'TheVillages',
  ],
};

export function activeRegions() {
  const raw = (process.env.SCAN_REGIONS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter((s) => REGION_SUBS[s]);
}

export function pushStates() {
  const raw = (process.env.PUSH_STATES || '').trim();
  if (!raw) return null; // null = everywhere
  return new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
}
