export const EAS_ADDRESS = "0x4200000000000000000000000000000000000021";
export const GET_ATTESTATION_SELECTOR = "0xa3112a64";
export const CHARTER_SCHEMA =
  "string version,string date,string[] names,bytes32[] digests,string[] cids";
export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const NETWORKS = {
  base: {
    chainId: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    easScanUrl: "https://base.easscan.org",
    easAddress: EAS_ADDRESS,
  },
  "base-sepolia": {
    chainId: 84532,
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    easScanUrl: "https://base-sepolia.easscan.org",
    easAddress: EAS_ADDRESS,
  },
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function cleanHex(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^0x/i, "");
}

function word(value) {
  const n = BigInt(value);
  const twos = n < 0n ? (1n << 256n) + n : n;
  return twos.toString(16).padStart(64, "0");
}

function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex) {
  const clean = cleanHex(hex);
  if (clean.length % 2 !== 0) {
    throw new Error("Odd-length hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const b = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) {
      throw new Error("Invalid hex character");
    }
    out[i] = b;
  }
  return out;
}

function padRight32(hex) {
  if (hex.length === 0) return "";
  const rem = hex.length % 64;
  return rem === 0 ? hex : hex + "0".repeat(64 - rem);
}

function readUint256At(clean, byteOffset) {
  const start = byteOffset * 2;
  const slice = clean.slice(start, start + 64);
  if (slice.length < 64) {
    throw new Error("Unexpected end of ABI data");
  }
  return BigInt("0x" + slice);
}

function readBytes32At(clean, byteOffset) {
  const start = byteOffset * 2;
  const slice = clean.slice(start, start + 64);
  if (slice.length < 64) {
    throw new Error("Unexpected end of ABI bytes32 word");
  }
  return "0x" + slice.toLowerCase();
}

function readAddressAt(clean, byteOffset) {
  const start = byteOffset * 2;
  const slice = clean.slice(start, start + 64);
  if (slice.length < 64) {
    throw new Error("Unexpected end of ABI address word");
  }
  return "0x" + slice.slice(24, 64).toLowerCase();
}

function readDynamicBytesAt(clean, baseByteOffset) {
  const byteLength = Number(readUint256At(clean, baseByteOffset));
  const startHex = (baseByteOffset + 32) * 2;
  const endHex = startHex + byteLength * 2;
  if (clean.length < endHex) {
    throw new Error("Truncated dynamic bytes in ABI payload");
  }
  return clean.slice(startHex, endHex);
}

function readDynamicStringAt(clean, baseByteOffset) {
  const rawHex = readDynamicBytesAt(clean, baseByteOffset);
  return textDecoder.decode(hexToBytes(rawHex));
}

function readStringArrayAt(clean, baseByteOffset) {
  const length = Number(readUint256At(clean, baseByteOffset));
  const elementsStart = baseByteOffset + 32;
  const result = [];
  for (let i = 0; i < length; i += 1) {
    const relOffset = Number(readUint256At(clean, elementsStart + i * 32));
    result.push(readDynamicStringAt(clean, elementsStart + relOffset));
  }
  return result;
}

function readBytes32ArrayAt(clean, baseByteOffset) {
  const length = Number(readUint256At(clean, baseByteOffset));
  const elementsStart = baseByteOffset + 32;
  const result = [];
  for (let i = 0; i < length; i += 1) {
    result.push(readBytes32At(clean, elementsStart + i * 32));
  }
  return result;
}

export function encodeString(str = "") {
  const bytes = textEncoder.encode(String(str));
  return word(bytes.length) + padRight32(bytesToHex(bytes));
}

export function encodeStringArray(items = []) {
  const encodedElements = items.map((s) => encodeString(s));
  const offsets = [];
  let running = items.length * 32;
  for (const elem of encodedElements) {
    offsets.push(word(running));
    running += elem.length / 2;
  }
  return word(items.length) + offsets.join("") + encodedElements.join("");
}

export function encodeBytes32Array(digests = []) {
  const words = digests.map((d) => {
    const clean = cleanHex(d).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) {
      throw new Error(`Invalid bytes32 digest: ${d}`);
    }
    return clean;
  });
  return word(words.length) + words.join("");
}

export function encodeCharterData({ version, date, names, digests, cids }) {
  if (
    !Array.isArray(names) ||
    !Array.isArray(digests) ||
    !Array.isArray(cids) ||
    names.length !== digests.length ||
    names.length !== cids.length
  ) {
    throw new Error("names, digests, and cids must be parallel arrays of equal length");
  }

  const tails = [
    encodeString(version),
    encodeString(date),
    encodeStringArray(names),
    encodeBytes32Array(digests),
    encodeStringArray(cids),
  ];

  const headOffsets = [];
  let offset = tails.length * 32;
  for (const tail of tails) {
    headOffsets.push(word(offset));
    offset += tail.length / 2;
  }

  return "0x" + headOffsets.join("") + tails.join("");
}

export function decodeCharterData(dataHex) {
  const clean = cleanHex(dataHex);
  if (clean.length < 64 * 5) {
    throw new Error("Charter data is too short to contain schema head words");
  }

  // Handle both flat ABI encoding (word[0] == 160) and tuple-wrapped encoding (word[0] == 32, word[1] == 160)
  let base = 0;
  const firstWord = readUint256At(clean, 0);
  if (firstWord === 32n && clean.length >= 64 * 6 && readUint256At(clean, 32) === 160n) {
    base = 32;
  }

  const versionOffset = base + Number(readUint256At(clean, base + 0));
  const dateOffset = base + Number(readUint256At(clean, base + 32));
  const namesOffset = base + Number(readUint256At(clean, base + 64));
  const digestsOffset = base + Number(readUint256At(clean, base + 96));
  const cidsOffset = base + Number(readUint256At(clean, base + 128));

  const version = readDynamicStringAt(clean, versionOffset);
  const date = readDynamicStringAt(clean, dateOffset);
  const names = readStringArrayAt(clean, namesOffset);
  const digests = readBytes32ArrayAt(clean, digestsOffset);
  const cids = readStringArrayAt(clean, cidsOffset);

  if (names.length !== digests.length || names.length !== cids.length) {
    throw new Error(
      `Parallel array length mismatch: names(${names.length}), digests(${digests.length}), cids(${cids.length})`
    );
  }

  return {
    version,
    date,
    names,
    digests,
    cids,
  };
}

export function encodeGetAttestation(uid) {
  const clean = cleanHex(uid).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`Invalid attestation UID: ${uid}`);
  }
  return GET_ATTESTATION_SELECTOR + clean;
}

export function encodeAttestationResponse({
  uid,
  schema = ZERO_BYTES32,
  time = 0,
  expirationTime = 0,
  revocationTime = 0,
  refUID = ZERO_BYTES32,
  recipient = ZERO_ADDRESS,
  attester = ZERO_ADDRESS,
  revocable = true,
  data = "0x",
}) {
  const cleanData = cleanHex(data);
  const dataByteLen = cleanData.length / 2;
  const paddedData = padRight32(cleanData);

  const tupleHead = [
    cleanHex(uid).padStart(64, "0"),
    cleanHex(schema).padStart(64, "0"),
    word(time),
    word(expirationTime),
    word(revocationTime),
    cleanHex(refUID).padStart(64, "0"),
    cleanHex(recipient).padStart(64, "0"),
    cleanHex(attester).padStart(64, "0"),
    word(revocable ? 1 : 0),
    word(320), // 10 * 32 bytes
  ].join("");

  const tupleTail = word(dataByteLen) + paddedData;
  return "0x" + word(32) + tupleHead + tupleTail;
}

export function decodeAttestationResponse(hex) {
  const clean = cleanHex(hex);
  if (clean.length === 0 || /^0+$/.test(clean)) {
    return null;
  }
  if (clean.length < 64 * 10) {
    throw new Error("Short EAS getAttestation ABI response");
  }

  let base = 0;
  const firstWord = readUint256At(clean, 0);
  if (
    firstWord === 32n &&
    clean.length >= 64 * 11 &&
    readUint256At(clean, 32 + 9 * 32) >= 320n
  ) {
    base = 32;
  }

  const uid = readBytes32At(clean, base + 0);
  const schema = readBytes32At(clean, base + 32);
  const time = Number(readUint256At(clean, base + 64));
  const expirationTime = Number(readUint256At(clean, base + 96));
  const revocationTime = Number(readUint256At(clean, base + 128));
  const refUID = readBytes32At(clean, base + 160);
  const recipient = readAddressAt(clean, base + 192);
  const attester = readAddressAt(clean, base + 224);
  const revocable = readUint256At(clean, base + 256) !== 0n;
  const dataRelOffset = Number(readUint256At(clean, base + 288));
  const dataHex = "0x" + readDynamicBytesAt(clean, base + dataRelOffset);

  return {
    uid,
    schema,
    time,
    expirationTime,
    revocationTime,
    refUID,
    recipient,
    attester,
    revocable,
    data: dataHex,
  };
}

export async function sha256Hex(input) {
  let bytes;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else if (typeof input === "string") {
    bytes = textEncoder.encode(input);
  } else {
    throw new Error("Unsupported byte payload for SHA-256");
  }
  const digestBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return "0x" + bytesToHex(new Uint8Array(digestBuffer)).toLowerCase();
}

export function createRpc(rpcUrl, fetchImpl = globalThis.fetch) {
  return async function rpc(method, params) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body && body.error) {
      const err = new Error(body.error.message || "JSON-RPC error");
      err.code = body.error.code;
      throw err;
    }
    return body ? body.result : null;
  };
}

export function createIpfsFetcher(
  gateway = DEFAULT_IPFS_GATEWAY,
  fetchImpl = globalThis.fetch
) {
  return async function ipfs(cid) {
    const cleanCid = String(cid || "")
      .trim()
      .replace(/^ipfs:\/\//i, "")
      .replace(/^ipfs\//i, "")
      .replace(/^\/+/, "");
    if (!cleanCid) {
      throw new Error("Empty IPFS CID");
    }
    const base = gateway.endsWith("/") ? gateway : `${gateway}/`;
    const response = await fetchImpl(`${base}${cleanCid}`);
    if (!response.ok) {
      throw new Error(`IPFS gateway HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  };
}

export async function verifyCharter(options = {}) {
  const { uid, network = "base", rpc: providedRpc, ipfs: providedIpfs } = options;

  const rawUid = String(uid || "").trim();
  const cleanUid = cleanHex(rawUid).toLowerCase();
  const normalizedUid = /^[0-9a-f]{64}$/.test(cleanUid)
    ? `0x${cleanUid}`
    : rawUid;

  const emptyAttestation = {
    uid: normalizedUid,
    attester: ZERO_ADDRESS,
    time: 0,
    revoked: false,
  };

  if (!/^[0-9a-f]{64}$/.test(cleanUid) || normalizedUid === ZERO_BYTES32) {
    return {
      ok: false,
      reason: "Invalid or zero attestation UID",
      attestation: emptyAttestation,
      texts: [],
    };
  }

  const netKey = String(network || "base").trim().toLowerCase();
  const netConfig = NETWORKS[netKey];
  if (!netConfig) {
    return {
      ok: false,
      reason: `Unsupported network: ${String(network)}`,
      attestation: emptyAttestation,
      texts: [],
    };
  }

  const rpc = providedRpc || createRpc(netConfig.rpcUrl);
  const ipfs = providedIpfs || createIpfsFetcher();

  let rawResponse;
  try {
    rawResponse = await rpc("eth_call", [
      {
        to: netConfig.easAddress,
        data: encodeGetAttestation(normalizedUid),
      },
      "latest",
    ]);
  } catch (err) {
    return {
      ok: false,
      reason: `RPC error: ${String(err?.message || err || "eth_call failed")}`,
      attestation: emptyAttestation,
      texts: [],
    };
  }

  let decodedAtt;
  try {
    decodedAtt = decodeAttestationResponse(String(rawResponse || ""));
  } catch (err) {
    return {
      ok: false,
      reason: `Invalid EAS response: ${String(err?.message || err)}`,
      attestation: emptyAttestation,
      texts: [],
    };
  }

  if (!decodedAtt || decodedAtt.uid === ZERO_BYTES32) {
    return {
      ok: false,
      reason: `Attestation not found on ${netConfig.name}`,
      attestation: emptyAttestation,
      texts: [],
    };
  }

  const revoked = Number(decodedAtt.revocationTime) > 0;
  const attestation = {
    uid: decodedAtt.uid,
    attester: decodedAtt.attester,
    time: decodedAtt.time,
    revoked,
  };

  let charterData;
  try {
    charterData = decodeCharterData(decodedAtt.data);
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to decode charter data: ${String(err?.message || err)}`,
      attestation,
      texts: [],
    };
  }

  const { version, date, names, digests, cids } = charterData;
  if (names.length === 0) {
    return {
      ok: false,
      reason: "Attestation contains no founding texts",
      attestation,
      texts: [],
    };
  }

  const texts = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const cid = cids[i];
    const expected = digests[i].toLowerCase();

    try {
      const bytes = await ipfs(cid);
      const actual = await sha256Hex(bytes);
      const match = actual === expected;
      texts.push({
        name,
        cid,
        expected,
        actual,
        match,
      });
    } catch (err) {
      texts.push({
        name,
        cid,
        expected,
        actual: null,
        match: false,
        error: String(err?.message || err || "Failed to fetch IPFS content"),
      });
    }
  }

  const result = {
    ok: false,
    attestation,
    texts,
  };

  Object.defineProperty(result, "meta", {
    value: { version, date, schema: decodedAtt.schema },
    enumerable: false,
  });

  if (revoked) {
    result.reason = "Attestation has been revoked";
    return result;
  }

  const errored = texts.find((t) => Boolean(t.error));
  if (errored) {
    result.reason = `Failed to load text "${errored.name}": ${errored.error}`;
    return result;
  }

  const mismatched = texts.filter((t) => !t.match);
  if (mismatched.length > 0) {
    result.reason = `SHA-256 digest mismatch for: ${mismatched.map((t) => t.name).join(", ")}`;
    return result;
  }

  result.ok = true;
  return result;
}
