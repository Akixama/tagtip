import { generateKeyPairSync, sign } from "node:crypto";
export function testWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${bytes.toString("hex")}`), address = "";
  while (number) { address = alphabet[Number(number % 58n)] + address; number /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; address = "1" + address; }
  return { address, sign: message => sign(null, Buffer.from(message), privateKey).toString("base64") };
}
