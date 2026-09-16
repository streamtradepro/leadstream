/**
 * Attach an APNs .p8 to the EAS project so Expo's push service can deliver to iOS.
 * The `eas credentials` TUI is interactive, so this talks to the EAS GraphQL API
 * with the CLI's own session secret (~/.expo/state.json).
 *
 *   node scripts/eas-push-key.mjs AuthKey_ADSVZT3W58.p8 ADSVZT3W58
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [file, keyIdentifier] = process.argv.slice(2);
if (!file || !keyIdentifier) { console.error("usage: eas-push-key.mjs <AuthKey_XXX.p8> <KEY_ID>"); process.exit(1); }

const keyP8 = readFileSync(file, "utf8");
const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
const eas = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8"));
const appleTeamIdentifier = eas.submit?.production?.ios?.appleTeamId ?? eas.build?.production?.ios?.appleTeamId;
const bundleIdentifier = app.ios.bundleIdentifier;
const accountName = app.owner;
const projectFullName = `@${accountName}/${app.slug}`;
const sessionSecret = JSON.parse(readFileSync(join(homedir(), ".expo", "state.json"), "utf8")).auth.sessionSecret;

async function gql(query, variables = {}) {
  const res = await fetch("https://api.expo.dev/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "expo-session": sessionSecret },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

// 1. account
const acct = (await gql(`query($n:String!){ account { byName(accountName:$n) { id name } } }`, { n: accountName })).account.byName;
console.log("account", acct.id, acct.name);

// 2. apple team
let team = (await gql(
  `query($id:String!,$t:String){ account { byId(accountId:$id) { appleTeams(appleTeamIdentifier:$t) { id appleTeamIdentifier appleTeamName } } } }`,
  { id: acct.id, t: appleTeamIdentifier })).account.byId.appleTeams[0];
if (!team) {
  team = (await gql(
    `mutation($i:AppleTeamInput!,$a:ID!){ appleTeam { createAppleTeam(appleTeamInput:$i, accountId:$a) { id appleTeamIdentifier } } }`,
    { i: { appleTeamIdentifier }, a: acct.id })).appleTeam.createAppleTeam;
}
console.log("appleTeam", team.id, team.appleTeamIdentifier);

// 3. push key — reuse if this key id is already uploaded
const keys = (await gql(
  `query($n:String!){ account { byName(accountName:$n) { applePushKeys { id keyIdentifier appleTeam { appleTeamIdentifier } } } } }`,
  { n: accountName })).account.byName.applePushKeys;
console.log("existing push keys:", keys.map((k) => k.keyIdentifier).join(", ") || "(none)");
let pushKey = keys.find((k) => k.keyIdentifier === keyIdentifier);
if (!pushKey) {
  pushKey = (await gql(
    `mutation($i:ApplePushKeyInput!,$a:ID!){ applePushKey { createApplePushKey(applePushKeyInput:$i, accountId:$a) { id keyIdentifier } } }`,
    { i: { keyIdentifier, keyP8, appleTeamId: team.id }, a: acct.id })).applePushKey.createApplePushKey;
  console.log("uploaded push key", pushKey.id);
} else console.log("push key already uploaded", pushKey.id);

// 4. bundle identifier record
let ident = (await gql(
  `query($n:String!,$b:String!){ account { byName(accountName:$n) { appleAppIdentifiers(bundleIdentifier:$b) { id bundleIdentifier } } } }`,
  { n: accountName, b: bundleIdentifier })).account.byName.appleAppIdentifiers[0];
if (!ident) {
  ident = (await gql(
    `mutation($i:AppleAppIdentifierInput!,$a:ID!){ appleAppIdentifier { createAppleAppIdentifier(appleAppIdentifierInput:$i, accountId:$a) { id bundleIdentifier } } }`,
    { i: { bundleIdentifier, appleTeamId: team.id }, a: acct.id })).appleAppIdentifier.createAppleAppIdentifier;
}
console.log("appleAppIdentifier", ident.id, ident.bundleIdentifier);

// 5. iOS app credentials for this app + bundle id
const appRow = (await gql(
  `query($f:String!,$i:String!){ app { byFullName(fullName:$f) { id iosAppCredentials(filter:{appleAppIdentifierId:$i}) { id pushKey { id keyIdentifier } } } } }`,
  { f: projectFullName, i: ident.id })).app.byFullName;
let creds = appRow.iosAppCredentials[0];
if (!creds) {
  creds = (await gql(
    `mutation($i:IosAppCredentialsInput!,$a:ID!,$ai:ID!){ iosAppCredentials { createIosAppCredentials(iosAppCredentialsInput:$i, appId:$a, appleAppIdentifierId:$ai) { id pushKey { keyIdentifier } } } }`,
    { i: { appleTeamId: team.id, pushKeyId: pushKey.id }, a: appRow.id, ai: ident.id })).iosAppCredentials.createIosAppCredentials;
  console.log("created iosAppCredentials", creds.id);
}

// 6. point them at the push key
const out = (await gql(
  `mutation($c:ID!,$k:ID!){ iosAppCredentials { setPushKey(id:$c, pushKeyId:$k) { id pushKey { id keyIdentifier } } } }`,
  { c: creds.id, k: pushKey.id })).iosAppCredentials.setPushKey;
console.log("\nPUSH KEY ATTACHED:", out.pushKey.keyIdentifier, "->", projectFullName, bundleIdentifier);
