export async function sendPush(tokens, { title, body, data }) {
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({ to, sound: 'default', title, body, data }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) console.error('expo push failed:', res.status, await res.text());
}
