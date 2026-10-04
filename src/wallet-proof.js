import { createPublicKey, verify } from "node:crypto";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function decodeSolanaAddress(address) {
  if (typeof address !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error("Invalid Solana public key.");
  let value = 0n;
  for (const character of address) value = value * 58n + BigInt(alphabet.indexOf(character));
  const hex = value.toString(16).padStart(2, "0");
  const decoded = value === 0n ? Buffer.alloc(0) : Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
  const leadingZeros = address.match(/^1*/)[0].length;
  const bytes = Buffer.concat([Buffer.alloc(leadingZeros), decoded]);
  if (bytes.length !== 32) throw new Error("Solana public key must decode to 32 bytes.");
  return bytes;
}
export function verifyWalletProof(wallet, message, signature) {
  try {
    if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64 || bytes.toString("base64") !== signature) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), decodeSolanaAddress(wallet)]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, bytes);
  } catch { return false; }
}
