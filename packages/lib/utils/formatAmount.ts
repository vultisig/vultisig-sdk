const million = 1000000;
const billion = 1000000000;

type Precision = "medium" | "high";

const maximumFractionDigitsRecord: Record<Precision, number> = {
  medium: 3,
  high: 8,
};

const locale = "en-US";

// Smallest fiat amount that still rounds to a non-zero value at 2 decimal
// places. Anything below this would render as "$0.00", so it gets the compact
// small-amount treatment instead.
const smallestStandardCurrencyAmount = 0.005;

// Significant digits kept when rendering a tiny fiat amount (e.g. the "3" in
// $0.0₇3, or the "1234" in $0.0001234).
const tinyCurrencySignificantDigits = 4;

// Minimum number of leading zeros before switching from plain decimals
// (e.g. $0.0001234) to compact subscript notation (e.g. $0.0₇3).
const subscriptNotationThreshold = 4;

const subscriptDigits = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

const toSubscript = (value: number): string =>
  String(value)
    .split("")
    .map((digit) => subscriptDigits[Number(digit)])
    .join("");

type FormatAmountOptions =
  | {
      currency: string;
    }
  | {
      ticker: string;
    }
  | {
      precision: Precision;
    };

/**
 * Splits a zero-amount currency format into the parts that surround the number,
 * so a custom numeric string can be injected while preserving the currency
 * symbol and its locale-specific placement (e.g. "$" prefix, "€" / " kr" etc.).
 */
const getCurrencyAffixes = (
  currency: string,
): { prefix: string; suffix: string } => {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).formatToParts(0);

  let prefix = "";
  let suffix = "";
  let hasSeenNumber = false;

  for (const part of parts) {
    const isNumberPart =
      part.type === "integer" ||
      part.type === "group" ||
      part.type === "decimal" ||
      part.type === "fraction" ||
      part.type === "minusSign";

    if (isNumberPart) {
      hasSeenNumber = true;
      continue;
    }

    if (hasSeenNumber) {
      suffix += part.value;
    } else {
      prefix += part.value;
    }
  }

  return { prefix, suffix };
};

/**
 * Renders a positive fiat amount smaller than one cent without rounding it away
 * to "$0.00". Keeps a few significant digits and, once there are enough leading
 * zeros, collapses them into subscript notation (e.g. 0.00000003 -> $0.0₇3).
 */
const formatTinyCurrencyAmount = (amount: number, currency: string): string => {
  const { prefix, suffix } = getCurrencyAffixes(currency);

  let exponent = Math.floor(Math.log10(amount));
  const significand = () => amount / Math.pow(10, exponent);

  let digits = significand().toFixed(tinyCurrencySignificantDigits - 1);
  // Rounding can carry the significand up to 10 (e.g. 9.9996 -> "10.0"),
  // which shifts it into the next decimal place.
  if (Number(digits) >= 10) {
    exponent += 1;
    digits = significand().toFixed(tinyCurrencySignificantDigits - 1);
  }

  const significantDigits = digits.replace(".", "").replace(/0+$/, "") || "0";

  const leadingZeros = -exponent - 1;

  const decimals =
    leadingZeros >= subscriptNotationThreshold
      ? `0${toSubscript(leadingZeros)}${significantDigits}`
      : `${"0".repeat(leadingZeros)}${significantDigits}`;

  return `${prefix}0.${decimals}${suffix}`;
};

/**
 * Formats a numeric amount for display. Large values are abbreviated with M/B
 * suffixes, currency amounts use the locale currency style, and tiny fiat
 * amounts (below one cent) fall back to significant-digit / subscript notation
 * so they are not rounded to "$0.00".
 */
export const formatAmount = (
  amount: number,
  options: FormatAmountOptions = { precision: "medium" },
  suffix?: string,
): string => {
  if (amount >= billion) {
    return formatAmount(amount / billion, options, "B");
  }
  if (amount >= million) {
    return formatAmount(amount / million, options, "M");
  }

  const isCurrency = options && "currency" in options;

  if (isCurrency && amount > 0 && amount < smallestStandardCurrencyAmount) {
    return formatTinyCurrencyAmount(amount, options.currency.toUpperCase());
  }

  const getPrecision = (): Precision => {
    if ("precision" in options) {
      return options.precision;
    }
    return "high";
  };

  const formatOptions: Intl.NumberFormatOptions = isCurrency
    ? {
        maximumFractionDigits: 2,
      }
    : {
        maximumFractionDigits: maximumFractionDigitsRecord[getPrecision()],
      };

  if (isCurrency) {
    formatOptions.currency = options.currency.toUpperCase();
    formatOptions.style = "currency";
  }

  const formatter = new Intl.NumberFormat(locale, formatOptions);

  const formattedAmount = formatter.format(amount);

  let result = formattedAmount;

  if (suffix) {
    result = `${formattedAmount}${suffix}`;
  }

  if (options && "ticker" in options) {
    return `${result} ${options.ticker}`;
  }

  return result;
};
