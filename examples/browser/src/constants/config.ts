export const APP_NAME = "Vultisig Browser Example";
export const APP_VERSION = "0.1.0";

export const PASSWORD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const SUPPORTED_FIAT_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
] as const;

export const EVENT_LOG_MAX_ENTRIES = 1000;

export const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds
