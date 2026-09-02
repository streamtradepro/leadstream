// One-time: register the bundle id, enable push, mint an App Store provisioning
// profile against the existing team distribution cert, write credentials.json.
// Run from mobile/: node scripts/apple-setup.mjs
import { asc } from './asc.mjs';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BUNDLE = 'com.tradestream.leadstream';
const NAME = 'LeadStream';

const serial = execSync('openssl x509 -in credentials/cert.pem -noout -serial').toString().split('=')[1].trim().toUpperCase();
const certs = await asc('GET', '/v1/certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=20');
const cert = certs.json.data.find((c) => c.attributes.serialNumber.toUpperCase() === serial);
if (!cert) throw new Error('local dist cert not found on team: ' + serial);
console.log('cert id', cert.id);

let bid = (await asc('GET', `/v1/bundleIds?filter[identifier]=${BUNDLE}`)).json.data?.[0];
if (!bid) {
  const r = await asc('POST', '/v1/bundleIds', {
    data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: NAME, platform: 'IOS' } },
  });
  if (r.status >= 300) throw new Error('bundleId create failed: ' + JSON.stringify(r.json));
  bid = r.json.data;
}
console.log('bundleId', bid.id, bid.attributes.identifier);

const caps = (await asc('GET', `/v1/bundleIds/${bid.id}/bundleIdCapabilities`)).json.data || [];
if (!caps.some((c) => c.attributes.capabilityType === 'PUSH_NOTIFICATIONS')) {
  const r = await asc('POST', '/v1/bundleIdCapabilities', {
    data: {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bid.id } } },
    },
  });
  if (r.status >= 300) throw new Error('push capability failed: ' + JSON.stringify(r.json));
  console.log('push capability enabled');
} else console.log('push capability already on');

const r = await asc('POST', '/v1/profiles', {
  data: {
    type: 'profiles',
    attributes: { name: `${NAME} App Store ${Date.now()}`, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bid.id } },
      certificates: { data: [{ type: 'certificates', id: cert.id }] },
    },
  },
});
if (r.status >= 300) throw new Error('profile create failed: ' + JSON.stringify(r.json));
writeFileSync('credentials/profile.mobileprovision', Buffer.from(r.json.data.attributes.profileContent, 'base64'));
console.log('profile written', r.json.data.id, r.json.data.attributes.expirationDate);

const cs = JSON.parse(readFileSync('../../callstream-mobile/credentials.json', 'utf8'));
writeFileSync(
  'credentials.json',
  JSON.stringify(
    {
      ios: {
        provisioningProfilePath: 'credentials/profile.mobileprovision',
        distributionCertificate: { path: 'credentials/dist.p12', password: cs.ios.distributionCertificate.password },
      },
    },
    null,
    2
  )
);
console.log('credentials.json written');
