import { Transaction } from "@solana/web3.js";
import type { SolanaSignTransactionInput } from "@solana/wallet-standard-features";
import type { WalletSendFeature } from "./deployment-wallet-sender.js";

type BraveSolanaProvider = Readonly<{
  publicKey?: string | Readonly<{ toBase58: () => string }> | null;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
}>;

function publicKeyString(value: BraveSolanaProvider["publicKey"]): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value.toBase58 === "function") return value.toBase58();
  return null;
}

export function braveWalletSigningFeature(
  provider: unknown,
  accountAddress: string,
): WalletSendFeature | null {
  if (!provider || typeof provider !== "object") return null;
  const braveProvider = provider as BraveSolanaProvider;
  if (
    typeof braveProvider.signTransaction !== "function" ||
    publicKeyString(braveProvider.publicKey) !== accountAddress
  )
    return null;
  const signTransaction = braveProvider.signTransaction.bind(braveProvider);

  return {
    source: "brave-provider",
    signTransaction: (...requests: readonly SolanaSignTransactionInput[]) => {
      const signing = requests.map(async (request) => {
        if (
          request.account.address !== accountAddress ||
          publicKeyString(braveProvider.publicKey) !== accountAddress
        )
          throw new Error("Brave Wallet account changed before signing.");
        const transaction = Transaction.from(request.transaction);
        const signed = await signTransaction(transaction);
        if (!(signed instanceof Transaction))
          throw new Error("Brave Wallet did not return a signed transaction.");
        return {
          signedTransaction: signed.serialize({
            requireAllSignatures: false,
            verifySignatures: true,
          }),
        };
      });
      return Promise.all(signing);
    },
  };
}
