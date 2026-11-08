import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES, CATEGORY_KEYS } from './categories.js';

let _client;
function client() {
  if (!_client) {
    // Identity-linked keys require the workspace id on every request.
    const ws = process.env.ANTHROPIC_WORKSPACE_ID;
    _client = new Anthropic(
      ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}
    );
  }
  return _client;
}

const model = () => process.env.ANTHROPIC_MODEL || 'claude-opus-5';

const CLASSIFY_SYSTEM = `You classify Reddit posts for a nationwide home-services company (USA Home Repairs) that dispatches technicians for these categories:
${CATEGORY_KEYS.map((k) => `- ${k}: ${CATEGORIES[k].label} — ${CATEGORIES[k].persona}`).join('\n')}

For each post decide:
- category: one of ${CATEGORY_KEYS.join(', ')}, or "other" if the post is not about any of these services.
- intent: "service" = the author wants to hire/pay a professional (asks for recommendations, quotes/estimates, cost of professional work, is locked out, or describes a problem they want fixed for them). "diy" = wants to fix it themselves / how-to questions. "noise" = not a real residential or commercial service need (gaming, cars, memes, contractors or marketers advertising themselves, SEO spam, news, jokes).
- location: any city/state/region inferable from the subreddit name (r/tampa → Tampa, FL; r/florida → state FL, city null) or the text. If the input has region_state, use it as the state when nothing more specific is found. US-centric; if clearly outside the US put the country in location_raw and leave state null.
- lead_score 0-100: 90+ = urgent service intent with a known US city (lockouts, stuck doors/gates, active leaks). 70-89 = clear service intent (location may be missing or state-only). 40-69 = ambiguous, or DIY that often converts to a pro job (broken spring, off-track door, dead opener, clogged vent). 10-39 = weak. 0-9 = noise.

Return ONLY a JSON array, one object per input post, same order:
[{"id":"t3_...","category":"...","intent":"service|diy|noise","location_raw":"string or null","city":"string or null","state":"2-letter or null","lead_score":0,"reason":"short"}]`;

function replySystem(lead) {
  const c = CATEGORIES[lead.category];
  const persona = c ? c.persona : 'home-services technician (garage doors, gates, locksmith, dryer vents, air ducts, chimneys)';
  return `You draft Reddit replies for an experienced ${persona}. Write a short (60-120 word), casual, genuinely helpful reply to the post: diagnose the likely issue, say what a pro would typically do, add one safety warning if relevant (torsion springs, gas, carbon monoxide, chimney fires, lockout scams), and close by offering to answer questions or look at photos via DM. Never include links, company names, phone numbers, prices, or anything salesy. Sound like a knowledgeable human on Reddit, not a marketer. Return only the reply text.`;
}

function parseJsonArray(text) {
  const cleaned = text.trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no JSON array in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function classifyPosts(posts) {
  const out = [];
  for (let i = 0; i < posts.length; i += 20) {
    const batch = posts.slice(i, i + 20).map((p) => ({
      id: p.reddit_id,
      subreddit: p.subreddit,
      title: p.title,
      body: (p.body || '').slice(0, 800),
      ...(p.category_hint ? { category_hint: p.category_hint } : {}),
      ...(p.region_state ? { region_state: p.region_state } : {}),
    }));
    const res = await client().messages.create({
      model: model(),
      max_tokens: 8000,
      // 1-hour cache: scans run 10-30 min apart, so a 5-minute entry would
      // expire between calls. Each read refreshes the hour.
      system: [{ type: 'text', text: CLASSIFY_SYSTEM, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: JSON.stringify(batch) }],
    });
    console.log(
      'classify usage',
      JSON.stringify({
        input: res.usage.input_tokens,
        cache_read: res.usage.cache_read_input_tokens ?? 0,
        cache_write: res.usage.cache_creation_input_tokens ?? 0,
        output: res.usage.output_tokens,
      })
    );
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      out.push(...parseJsonArray(text));
    } catch (e) {
      console.error('classify parse failed:', e.message);
    }
  }
  return out;
}

export async function draftReply(lead) {
  const res = await client().messages.create({
    model: model(),
    max_tokens: 1000,
    system: replySystem(lead),
    messages: [
      {
        role: 'user',
        content: `Subreddit: r/${lead.subreddit}\nTitle: ${lead.title}\n\n${lead.body || '(no body text)'}`,
      },
    ],
  });
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// --- Reddit DM outreach -------------------------------------------------------
// The DM is sent FROM the owner's own Reddit account to someone who asked for a
// recommendation. It must say up front that it is our service (FTC endorsement
// rule + Reddit spam policy: an undisclosed "call these guys, they helped me"
// is a fake testimonial). Phone is allowed in a DM; no prices.
const DM_PHONE = () => process.env.LEADSTREAM_DM_PHONE || '(888) 996-7488';
const DM_BRAND = () => process.env.LEADSTREAM_DM_BRAND || 'USA Home Repairs';

function dmSystem(lead) {
  const c = CATEGORIES[lead.category];
  const trade = c ? c.label.toLowerCase() : 'home repair';
  return `You write a short private Reddit message (45-90 words) from a real person who runs ${DM_BRAND()}, a scheduling service that sends out vetted local ${trade} technicians. The recipient just posted asking for help or a recommendation.

Rules:
- First sentence references their post naturally and says plainly that this is our service ("full disclosure, this is my company" or similar). No pretending to be a happy customer.
- Offer the phone line ${DM_PHONE()} and say someone can call them back or get a tech out; the office gives the quote. Never state a price, a time window, "licensed", "insured" or "guaranteed".
- Add ONE genuinely useful tip or safety note about their specific problem (torsion springs, gas, carbon monoxide, lockout scams, running an opener on a snapped cable, etc.).
- Casual, human, no emojis, no bullet points, no links, no sign-off name. Return only the message text.`;
}

export async function draftDm(lead) {
  const res = await client().messages.create({
    model: model(),
    max_tokens: 600,
    system: dmSystem(lead),
    messages: [{ role: 'user', content: `Subreddit: r/${lead.subreddit}\nTitle: ${lead.title}\n\n${lead.body || '(no body text)'}` }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// Follow-up when the person answers our DM. `thread` = [{direction:'out'|'in', body}] oldest first.
export async function draftDmFollowup(lead, thread) {
  const system = `${dmSystem(lead)}

You are now continuing the conversation below. Answer their question directly in 30-70 words. Anything about price, scheduling, availability or booking: do not guess, point them to ${DM_PHONE()} ("call and the office quotes it on the spot" / "they can lock in a time"). If they say no thanks or are hostile, reply with one polite line and nothing else. Return only the message text.`;
  const transcript = thread.map((m) => `${m.direction === 'out' ? 'ME' : 'THEM'}: ${m.body}`).join('\n\n');
  const res = await client().messages.create({
    model: model(),
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: `Their original post (r/${lead.subreddit}): ${lead.title}\n${(lead.body || '').slice(0, 600)}\n\nConversation so far:\n${transcript}` }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
