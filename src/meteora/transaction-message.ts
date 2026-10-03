import { type Message, type PublicKey, Transaction } from "@solana/web3.js";

export function compileLegacyTransactionMessage(
  instructions: Transaction["instructions"],
  feePayer: PublicKey,
  blockhash: string,
): Message {
  return new Transaction({ feePayer, recentBlockhash: blockhash })
    .add(...instructions)
    .compileMessage();
}

export async function digestLegacyTransactionMessage(message: Message): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable");
  const bytes = Uint8Array.from(message.serialize());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
