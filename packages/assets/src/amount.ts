import { Asset, Layer } from './asset.js';

/**
 * Decimal conversion utilities
 */
export function nativeToThorchain(amount: bigint, asset: Asset): bigint {
  const scale = asset.decimals.thorchain - asset.decimals.native;
  return scale >= 0 ? amount * 10n ** BigInt(scale) : amount / 10n ** BigInt(-scale);
}

export function thorchainToNative(amount: bigint, asset: Asset): bigint {
  const scale = asset.decimals.native - asset.decimals.thorchain;
  return scale >= 0 ? amount * 10n ** BigInt(scale) : amount / 10n ** BigInt(-scale);
}

export function thorchainToFin(amount: bigint, asset: Asset): bigint {
  const scale = asset.decimals.thorchain - asset.decimals.fin;
  return amount / 10n ** BigInt(scale);
}

export function finToThorchain(amount: bigint, asset: Asset): bigint {
  const scale = asset.decimals.thorchain - asset.decimals.fin;
  return amount * 10n ** BigInt(scale);
}

export function nativeToFin(amount: bigint, asset: Asset): bigint {
  // Convert through THORChain as intermediate
  const thorchainAmount = nativeToThorchain(amount, asset);
  return thorchainToFin(thorchainAmount, asset);
}

export function finToNative(amount: bigint, asset: Asset): bigint {
  // Convert through THORChain as intermediate
  const thorchainAmount = finToThorchain(amount, asset);
  return thorchainToNative(thorchainAmount, asset);
}

/**
 * Amount class representing a value on a specific layer
 */
export class Amount {
  readonly asset: Asset;
  readonly layer: Layer;
  readonly raw: bigint;

  constructor(asset: Asset, layer: Layer, raw: bigint) {
    this.asset = asset;
    this.layer = layer;
    this.raw = raw;
  }

  /**
   * Create Amount from human-readable string
   */
  static from(human: string, asset: Asset, layer: Layer): Amount {
    const decimals = asset.decimals[layer];
    const parts = human.split('.');
    
    let raw = BigInt(parts[0]) * 10n ** BigInt(decimals);
    
    if (parts[1]) {
      const fractionalDigits = Math.min(parts[1].length, decimals);
      const fractionalPart = parts[1].substring(0, fractionalDigits).padEnd(decimals, '0');
      raw += BigInt(fractionalPart);
    }
    
    return new Amount(asset, layer, raw);
  }

  /**
   * Create Amount from raw bigint value
   */
  static fromRaw(raw: bigint, asset: Asset, layer: Layer): Amount {
    return new Amount(asset, layer, raw);
  }

  /**
   * Convert to specific layer
   */
  toLayer(target: Layer): Amount {
    if (this.layer === target) {
      return this;
    }

    let targetRaw: bigint;

    if (this.layer === 'native' && target === 'thorchain') {
      targetRaw = nativeToThorchain(this.raw, this.asset);
    } else if (this.layer === 'thorchain' && target === 'native') {
      targetRaw = thorchainToNative(this.raw, this.asset);
    } else if (this.layer === 'thorchain' && target === 'fin') {
      targetRaw = thorchainToFin(this.raw, this.asset);
    } else if (this.layer === 'fin' && target === 'thorchain') {
      targetRaw = finToThorchain(this.raw, this.asset);
    } else if (this.layer === 'native' && target === 'fin') {
      targetRaw = nativeToFin(this.raw, this.asset);
    } else if (this.layer === 'fin' && target === 'native') {
      targetRaw = finToNative(this.raw, this.asset);
    } else {
      throw new Error(`Cannot convert from ${this.layer} to ${target}`);
    }

    return new Amount(this.asset, target, targetRaw);
  }

  /**
   * Convert to native layer
   */
  toNative(): Amount {
    return this.toLayer('native');
  }

  /**
   * Convert to THORChain layer
   */
  toThorchain(): Amount {
    return this.toLayer('thorchain');
  }

  /**
   * Convert to FIN layer
   */
  toFin(): Amount {
    return this.toLayer('fin');
  }

  /**
   * Get human-readable representation
   */
  toHuman(precision?: number): string {
    const decimals = this.asset.decimals[this.layer];
    const divisor = 10n ** BigInt(decimals);
    
    const wholePart = this.raw / divisor;
    const fractionalPart = this.raw % divisor;
    
    if (fractionalPart === 0n) {
      return wholePart.toString();
    }
    
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    const trimmed = precision !== undefined 
      ? fractionalStr.substring(0, precision).replace(/0+$/, '')
      : fractionalStr.replace(/0+$/, '');
    
    return trimmed.length > 0 
      ? `${wholePart}.${trimmed}`
      : wholePart.toString();
  }

  /**
   * Get display string with asset name
   */
  toDisplay(precision?: number): string {
    return `${this.toHuman(precision)} ${this.asset.id.toUpperCase()}`;
  }

  /**
   * Get raw bigint value
   */
  toRaw(): bigint {
    return this.raw;
  }

  /**
   * Add two amounts (must be same asset and layer)
   */
  add(other: Amount): Amount {
    if (this.asset.id !== other.asset.id) {
      throw new Error('Cannot add amounts of different assets');
    }
    if (this.layer !== other.layer) {
      throw new Error('Cannot add amounts from different layers');
    }
    
    return new Amount(this.asset, this.layer, this.raw + other.raw);
  }

  /**
   * Subtract two amounts (must be same asset and layer)
   */
  subtract(other: Amount): Amount {
    if (this.asset.id !== other.asset.id) {
      throw new Error('Cannot subtract amounts of different assets');
    }
    if (this.layer !== other.layer) {
      throw new Error('Cannot subtract amounts from different layers');
    }
    
    return new Amount(this.asset, this.layer, this.raw - other.raw);
  }

  /**
   * Multiply amount by a factor
   */
  multiply(factor: number): Amount {
    const factorBigInt = BigInt(Math.round(factor * 1000000)) * this.raw / 1000000n;
    return new Amount(this.asset, this.layer, factorBigInt);
  }

  /**
   * Check if amount is zero
   */
  isZero(): boolean {
    return this.raw === 0n;
  }

  /**
   * Check if amount is positive
   */
  isPositive(): boolean {
    return this.raw > 0n;
  }

  /**
   * Compare with another amount
   */
  equals(other: Amount): boolean {
    return this.asset.id === other.asset.id && 
           this.layer === other.layer && 
           this.raw === other.raw;
  }
}