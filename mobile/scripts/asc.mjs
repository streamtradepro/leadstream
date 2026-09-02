/**
 * App Store Connect API helper (ES256 JWT; iat backdated 60s — local clock
 * runs ahead of Apple's, see the portfolio playbook).
 * Usage: node scripts/asc.mjs <get|post|patch> <path> [json-body]
 */
import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

const KEY_ID = "7JM7NWVAXC";
const ISSUER = "3903feef-a611-45da-a4e7-2c4846c810f7";
const p8 = readFileSync(new URL("../AuthKey_7JM7NWVAXC.p8", import.meta.url), "utf8");

export function ascJwt() {
  const now = Math.floor(Date.now() / 1000) - 60;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: ISSUER, iat: now, exp: now + 19 * 60, aud: "appstoreconnect-v1",
  })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const sign = createSign("SHA256");
  sign.update(unsigned);
  const der = sign.sign({ key: createPrivateKey(p8), dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${der.toString("base64url")}`;
}

export async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ascJwt()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

// CLI mode
const [, , method, path, bodyArg] = process.argv;
if (method && path) {
  const body = bodyArg ? JSON.parse(bodyArg) : undefined;
  const out = await asc(method.toUpperCase(), path, body);
  console.log(out.status);
  console.log(JSON.stringify(out.json, null, 2));
}
