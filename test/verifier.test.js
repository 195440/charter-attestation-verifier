import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EAS_ADDRESS,
  GET_ATTESTATION_SELECTOR,
  NETWORKS,
  ZERO_BYTES32,
  decodeCharterData,
  encodeCharterData,
  encodeAttestationResponse,
  sha256Hex,
  verifyCharter,
} from "../verifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const encoder = new TextEncoder();

const SAMPLE_UID =
  "0x8f5b20d6a45b6e837054f99b8d47b96b99c4f1d2e84b175c6e71f895c71b0912";
const SAMPLE_ATTESTER = "0x8cc9bd34b5ee8e828c54b84d0520cdcf4fa9c078";

async function buildCharterFixture() {
  const rawTexts = {
    charter: "Kognai Founding Charter v1.0 - Sovereign Agentic Infrastructure.",
    constitution: "Kognai Constitution v1.0 - All founding texts are anchored on Base EAS.",
    soul: "Kognai Soul v1.0 - Deterministic verification before trust.",
  };
  const cids = {
    charter: "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
    constitution: "bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq",
    soul: "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq",
  };
  const names = ["charter", "constitution", "soul"];
  const digests = [];
  for (const name of names) {
    digests.push(await sha256Hex(encoder.encode(rawTexts[name])));
  }

  const dataHex = encodeCharterData({
    version: "1.0.0",
    date: "2026-10-21",
    names,
    digests,
    cids: names.map((n) => cids[n]),
  });

  return {
    rawTexts,
    cids,
    names,
    digests,
    dataHex,
  };
}

test("A1: Attestation data is decoded accurately from the schema (version, date, names, digests, cids)", async () => {
  const fixture = await buildCharterFixture();
  const decoded = decodeCharterData(fixture.dataHex);

  assert.equal(decoded.version, "1.0.0");
  assert.equal(decoded.date, "2026-10-21");
  assert.deepEqual(decoded.names, ["charter", "constitution", "soul"]);
  assert.deepEqual(decoded.digests, fixture.digests);
  assert.deepEqual(decoded.cids, [
    fixture.cids.charter,
    fixture.cids.constitution,
    fixture.cids.soul,
  ]);
  for (const d of decoded.digests) {
    assert.match(d, /^0x[0-9a-f]{64}$/);
  }
});

test("A2: Matching attestation shows match: true on every text and ok: true overall", async () => {
  const fixture = await buildCharterFixture();
  const attHex = encodeAttestationResponse({
    uid: SAMPLE_UID,
    attester: SAMPLE_ATTESTER,
    time: 1792569600,
    revocationTime: 0,
    data: fixture.dataHex,
  });

  const res = await verifyCharter({
    uid: SAMPLE_UID,
    network: "base",
    rpc: async (method, [call]) => {
      assert.equal(method, "eth_call");
      assert.equal(call.to, EAS_ADDRESS);
      assert.equal(call.data, GET_ATTESTATION_SELECTOR + SAMPLE_UID.slice(2));
      return attHex;
    },
    ipfs: async (cid) => {
      for (const name of fixture.names) {
        if (fixture.cids[name] === cid) {
          return encoder.encode(fixture.rawTexts[name]);
        }
      }
      throw new Error(`Unexpected CID: ${cid}`);
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.reason, undefined);
  assert.deepEqual(res.attestation, {
    uid: SAMPLE_UID,
    attester: SAMPLE_ATTESTER,
    time: 1792569600,
    revoked: false,
  });
  assert.equal(res.texts.length, 3);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(res.texts[i].name, fixture.names[i]);
    assert.equal(res.texts[i].match, true);
    assert.equal(res.texts[i].expected, fixture.digests[i]);
    assert.equal(res.texts[i].actual, fixture.digests[i]);
  }
});

test("A3: A single tampered text flips only that text to match: false (with both digests shown) and the overall result to ok: false", async () => {
  const fixture = await buildCharterFixture();
  const attHex = encodeAttestationResponse({
    uid: SAMPLE_UID,
    attester: SAMPLE_ATTESTER,
    time: 1792569600,
    revocationTime: 0,
    data: fixture.dataHex,
  });

  const tamperedConstitution = fixture.rawTexts.constitution + "\nTampered clause.";
  const expectedTamperedHash = await sha256Hex(encoder.encode(tamperedConstitution));

  const res = await verifyCharter({
    uid: SAMPLE_UID,
    network: "base",
    rpc: async () => attHex,
    ipfs: async (cid) => {
      if (cid === fixture.cids.constitution) {
        return encoder.encode(tamperedConstitution);
      }
      for (const name of fixture.names) {
        if (fixture.cids[name] === cid) {
          return encoder.encode(fixture.rawTexts[name]);
        }
      }
      throw new Error(`Unexpected CID: ${cid}`);
    },
  });

  assert.equal(res.ok, false);
  assert.match(res.reason, /constitution/i);
  assert.equal(res.texts[0].name, "charter");
  assert.equal(res.texts[0].match, true);

  assert.equal(res.texts[1].name, "constitution");
  assert.equal(res.texts[1].match, false);
  assert.equal(res.texts[1].expected, fixture.digests[1]);
  assert.equal(res.texts[1].actual, expectedTamperedHash);
  assert.notEqual(res.texts[1].expected, res.texts[1].actual);

  assert.equal(res.texts[2].name, "soul");
  assert.equal(res.texts[2].match, true);
});

test("A4: Unknown UID, revoked attestation or unreachable text is reported with a clear message and never throws", async () => {
  const fixture = await buildCharterFixture();

  // 1. Unknown UID (EAS returns zeroed attestation)
  const unknownAttHex = encodeAttestationResponse({
    uid: ZERO_BYTES32,
  });
  const unknownRes = await verifyCharter({
    uid: SAMPLE_UID,
    network: "base",
    rpc: async () => unknownAttHex,
    ipfs: async () => new Uint8Array(),
  });
  assert.equal(unknownRes.ok, false);
  assert.match(unknownRes.reason, /not found/i);
  assert.deepEqual(unknownRes.texts, []);

  // 2. Revoked attestation (revocationTime > 0)
  const revokedAttHex = encodeAttestationResponse({
    uid: SAMPLE_UID,
    attester: SAMPLE_ATTESTER,
    time: 1792569600,
    revocationTime: 1792570000,
    data: fixture.dataHex,
  });
  const revokedRes = await verifyCharter({
    uid: SAMPLE_UID,
    network: "base",
    rpc: async () => revokedAttHex,
    ipfs: async (cid) => {
      for (const name of fixture.names) {
        if (fixture.cids[name] === cid) {
          return encoder.encode(fixture.rawTexts[name]);
        }
      }
      return new Uint8Array();
    },
  });
  assert.equal(revokedRes.ok, false);
  assert.equal(revokedRes.attestation.revoked, true);
  assert.match(revokedRes.reason, /revoked/i);

  // 3. Unreachable IPFS text
  const validAttHex = encodeAttestationResponse({
    uid: SAMPLE_UID,
    attester: SAMPLE_ATTESTER,
    time: 1792569600,
    revocationTime: 0,
    data: fixture.dataHex,
  });
  const unreachableRes = await verifyCharter({
    uid: SAMPLE_UID,
    network: "base",
    rpc: async () => validAttHex,
    ipfs: async (cid) => {
      if (cid === fixture.cids.soul) {
        throw new Error("IPFS gateway timeout for soul");
      }
      for (const name of fixture.names) {
        if (fixture.cids[name] === cid) {
          return encoder.encode(fixture.rawTexts[name]);
        }
      }
      return new Uint8Array();
    },
  });
  assert.equal(unreachableRes.ok, false);
  assert.equal(unreachableRes.texts[2].name, "soul");
  assert.equal(unreachableRes.texts[2].match, false);
  assert.match(unreachableRes.texts[2].error, /timeout/i);
  assert.match(unreachableRes.reason, /soul/i);
});

test("A5: Works against both Base (8453) and Base Sepolia (84532)", async () => {
  assert.equal(NETWORKS.base.chainId, 8453);
  assert.equal(NETWORKS.base.easAddress, "0x4200000000000000000000000000000000000021");
  assert.equal(NETWORKS["base-sepolia"].chainId, 84532);
  assert.equal(NETWORKS["base-sepolia"].easAddress, "0x4200000000000000000000000000000000000021");

  const fixture = await buildCharterFixture();
  const attHex = encodeAttestationResponse({
    uid: SAMPLE_UID,
    attester: SAMPLE_ATTESTER,
    time: 1792569600,
    revocationTime: 0,
    data: fixture.dataHex,
  });

  for (const net of ["base", "base-sepolia"]) {
    const res = await verifyCharter({
      uid: SAMPLE_UID,
      network: net,
      rpc: async (_m, [call]) => {
        assert.equal(call.to, EAS_ADDRESS);
        return attHex;
      },
      ipfs: async (cid) => {
        for (const name of fixture.names) {
          if (fixture.cids[name] === cid) {
            return encoder.encode(fixture.rawTexts[name]);
          }
        }
        throw new Error("Unexpected CID");
      },
    });
    assert.equal(res.ok, true, `Expected verification ok on ${net}`);
  }
});

test("A6: Mobile-friendly, verifies the Sepolia rehearsal UID and documents the result in the README without em-dashes", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");

  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*>/i);
  assert.match(html, /@media\s*\(max-width:\s*600px\)/i);
  assert.match(readme, /0x8f5b20d6a45b6e837054f99b8d47b96b99c4f1d2e84b175c6e71f895c71b0912/i);
  assert.match(readme, /base-sepolia/i);

  for (const file of ["index.html", "verifier.js", "README.md"]) {
    const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.equal(
      /[\u2013\u2014]/.test(content),
      false,
      `${file} must not contain en-dash or em-dash characters`
    );
  }
});
