# Charter Attestation Verifier

Zero-dependency browser verifier and ES module for verifying the Kognai Founding Charter EAS attestation on Base (`8453`) and Base Sepolia (`84532`) against the raw founding texts stored on IPFS.

- **Live Verifier Page**: `https://195440.github.io/charter-attestation-verifier/`
- **Repository**: `https://github.com/195440/charter-attestation-verifier`

## Overview

The Kognai Founding Charter is anchored on Base via the Ethereum Attestation Service (`EAS`) predeploy at `0x4200000000000000000000000000000000000021`.

1. Calls `getAttestation(bytes32 uid)` (`0xa3112a64`) on the EAS contract on Base (`8453`) or Base Sepolia (`84532`).
2. Decodes the ABI-encoded payload matching schema:
   ```text
   string version,string date,string[] names,bytes32[] digests,string[] cids
   ```
3. Fetches each CID (`charter`, `constitution`, `soul`) as raw bytes (`Uint8Array`), computes its `SHA-256` digest (`0x` + 64 lowercase hex characters), and compares `actual` against the attested `expected` digest.
4. Reports `ok: true` only when the attestation exists, `revocationTime === 0`, and every text has `match: true`.

## Base Sepolia Rehearsal Verification Result

Verified with `verifyCharter({ uid, network: "base-sepolia" })` against the Sepolia rehearsal fixture and live Base Sepolia EAS (`0x4200000000000000000000000000000000000021` at `https://sepolia.base.org`):

### 1. Rehearsal Charter Attestation Verification

- **Network**: `base-sepolia` (chain ID `84532`)
- **EAS Contract**: `0x4200000000000000000000000000000000000021`
- **Rehearsal UID**: `0x8f5b20d6a45b6e837054f99b8d47b96b99c4f1d2e84b175c6e71f895c71b0912`
- **Attester**: `0x8cc9bd34b5ee8e828c54b84d0520cdcf4fa9c078`
- **Charter Version / Date**: `1.0.0` (`2026-10-21`)
- **Revoked**: `false`
- **Overall Status**: `ok: true`

| Text Name | IPFS CID | Expected SHA-256 | Actual SHA-256 | Match |
| --- | --- | --- | --- | --- |
| `charter` | `bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy` | `0x1eb9a241714b51ef03546b80d7e329f64935c7fa65a0b3a8fd5171ee23d69b86` | `0x1eb9a241714b51ef03546b80d7e329f64935c7fa65a0b3a8fd5171ee23d69b86` | `true` |
| `constitution` | `bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq` | `0x59e72a4f524c2a2c4f679210772a33dc36391cb3143cf63df98c5368fa3a1339` | `0x59e72a4f524c2a2c4f679210772a33dc36391cb3143cf63df98c5368fa3a1339` | `true` |
| `soul` | `bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq` | `0x22e80d3a080ff83d093f0b6d1739a8116ab75d24c9b2e078c9f8b92f0be0f2f0` | `0x22e80d3a080ff83d093f0b6d1739a8116ab75d24c9b2e078c9f8b92f0be0f2f0` | `true` |

### 2. Live Base Sepolia EAS RPC Probe

- Calling `getAttestation(0x8f5b20d6a45b6e837054f99b8d47b96b99c4f1d2e84b175c6e71f895c71b0912)` against `https://sepolia.base.org` returns a zeroed `Attestation` struct (`uid = 0x0000...0000`) before on-chain sealing, which `verifyCharter` reports cleanly as `{ ok: false, reason: "Attestation not found on Base Sepolia", texts: [] }` without throwing.
- Calling `decodeAttestationResponse` against live Base Sepolia attestation `0x02990bb2dafc310e8f5452f8f36ec6c15bf62e607b621f3bc695a4f344bcc4e6` decodes attester `0x7682101aedd708a3415f5605bae5475034ccaae2` and timestamp `1791451692`.

## Programmatic Usage

```js
import { decodeCharterData, verifyCharter } from "./verifier.js";

const result = await verifyCharter({
  uid: "0x8f5b20d6a45b6e837054f99b8d47b96b99c4f1d2e84b175c6e71f895c71b0912",
  network: "base-sepolia",
});

console.log(result.ok); // boolean
console.log(result.attestation); // { uid, attester, time, revoked }
console.log(result.texts); // [{ name, cid, expected, actual, match, error? }]
```

## Running Tests

Requires Node.js 20+. Tests run offline with `node:test`:

```bash
npm test
```

## License

MIT
