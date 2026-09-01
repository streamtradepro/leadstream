import Anthropic from '@anthropic-ai/sdk';

let _client;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

const model = () => process.env.ANTHROPIC_MODEL || 'claude-opus-5';

const CLASSIFY_SYSTEM = `You classify Reddit posts for a garage door service lead-monitoring tool.

For each post decide:
- intent: "service" = the author wants to hire/pay a professional (asks for company recommendations, quotes, cost of repair, or describes a broken door they want fixed). "diy" = wants to fix it themselves / how-to questions. "noise" = not about a real residential or commercial garage door problem (gaming, cars fitting in garages, memes, contractors or marketers advertising themselves, SEO spam).
- location: any city/state/region inferable from the subreddit name (e.g. r/Dallas) or the text. US-centric; if clearly outside the US, put the country in location_raw and leave state null.
- lead_score 0-100: 90+ = urgent service intent with a known US location. 70-89 = clear service intent (location may be missing). 40-69 = ambiguous, or DIY that often converts to a pro job (broken torsion spring, door off track, dead opener). 10-39 = weak. 0-9 = noise.

Return ONLY a JSON array, one object per input post, same order:
[{"id":"t3_...","intent":"service|diy|noise","location_raw":"string or null","city":"string or null","state":"2-letter or null","lead_score":0,"reason":"short"}]`;

const REPLY_SYSTEM = `You draft Reddit replies for an experienced garage door technician. Write a short (60-120 word), casual, genuinely helpful reply to the post: diagnose the likely issue, give a realistic price range for professional repair, add one safety warning if relevant (torsion springs are dangerous DIY), and close by offering to answer questions or look at photos via DM. Never include links, company names, phone numbers, or anything salesy. Sound like a knowledgeable human on Reddit, not a marketer. Return only the reply text.`;

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
    }));
    const res = await client().messages.create({
      model: model(),
      max_tokens: 8000,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(batch) }],
    });
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
    system: REPLY_SYSTEM,
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
