import type { Chain } from "@vultisig/sdk";

/**
 * Shorten an address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format a balance amount with decimals
 */
export function formatBalance(
  amount: string | bigint,
  decimals: number,
  maxDecimals = 6,
): string {
  try {
    const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;
    const divisor = BigInt(10 ** decimals);
    const integerPart = amountBigInt / divisor;
    const fractionalPart = amountBigInt % divisor;

    if (fractionalPart === 0n) {
      return integerPart.toString();
    }

    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");
    const trimmed = fractionalStr.slice(0, maxDecimals).replace(/0+$/, "");

    return trimmed ? `${integerPart}.${trimmed}` : integerPart.toString();
  } catch {
    return "0";
  }
}

/**
 * Format a fiat value (USD, EUR, etc.)
 */
export function formatFiatValue(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Parse amount string to BigInt with decimals
 */
export function parseAmount(amount: string, decimals: number): bigint {
  if (!amount || amount === "0") return 0n;

  const [integerPart, fractionalPart = ""] = amount.split(".");
  const paddedFractional = fractionalPart
    .padEnd(decimals, "0")
    .slice(0, decimals);
  const combined = integerPart + paddedFractional;

  return BigInt(combined);
}

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerUrl(chain: Chain, txHash: string): string {
  const explorers: Record<string, string> = {
    Ethereum: `https://etherscan.io/tx/${txHash}`,
    Bitcoin: `https://blockstream.info/tx/${txHash}`,
    Avalanche: `https://snowtrace.io/tx/${txHash}`,
    BSC: `https://bscscan.com/tx/${txHash}`,
    Polygon: `https://polygonscan.com/tx/${txHash}`,
    // Add more chains as needed
  };

  return explorers[chain] || "#";
}

/**
 * Validate Ethereum address
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate Bitcoin address
 */
export function isValidBitcoinAddress(address: string): boolean {
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/.test(address);
}
