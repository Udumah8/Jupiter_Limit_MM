/**
 * Pyth Price Feed - Enhanced with Proper SDK
 * Uses Pyth Price Service Client for reliable price data
 */

import { PublicKey } from '@solana/web3.js';
import pythPkg from '@pythnetwork/price-service-client';
const { PriceServiceConnection } = pythPkg;
import { Logger } from '../../utils/Logger.js';

export interface PythPriceData {
  price: number;
  confidence: number;
  publishTime: number;
  isStale: boolean;
}

export class PythPriceFeed {
  private logger: Logger;
  private connection: any; // PriceServiceConnection type from CommonJS
  private priceCache: Map<string, PythPriceData> = new Map();
  private cacheDurationMs: number = 5000; // 5 seconds
  private stalenessThresholdMs: number = 60000; // 60 seconds

  constructor(logger: Logger, hermesUrl: string = 'https://hermes.pyth.network') {
    this.logger = logger;
    this.connection = new (PriceServiceConnection as any)(hermesUrl, {
      priceFeedRequestConfig: {
        binary: true,
      },
    });
  }

  /**
   * Get price from Pyth for a token pair
   */
  async getPrice(baseMint: PublicKey, quoteMint: PublicKey): Promise<number | null> {
    try {
      const baseFeedId = this.getPythFeedId(baseMint);
      const quoteFeedId = this.getPythFeedId(quoteMint);

      if (!baseFeedId || !quoteFeedId) {
        this.logger.debug('No Pyth feed ID mapping', {
          baseMint: baseMint.toString(),
          quoteMint: quoteMint.toString(),
        });
        return null;
      }

      // Check cache
      const cacheKey = `${baseFeedId}_${quoteFeedId}`;
      const cached = this.priceCache.get(cacheKey);
      if (cached && Date.now() - cached.publishTime < this.cacheDurationMs) {
        return cached.price;
      }

      // Fetch latest prices
      const priceFeeds = await this.connection.getLatestPriceFeeds([
        baseFeedId,
        quoteFeedId,
      ]);

      if (!priceFeeds || priceFeeds.length < 2) {
        return null;
      }

      const baseFeed = priceFeeds.find((f: any) => f.id === baseFeedId);
      const quoteFeed = priceFeeds.find((f: any) => f.id === quoteFeedId);

      if (!baseFeed || !quoteFeed) {
        return null;
      }

      // Get price data
      const basePrice = baseFeed.getPriceUnchecked();
      const quotePrice = quoteFeed.getPriceUnchecked();

      if (!basePrice || !quotePrice) {
        return null;
      }

      // Check confidence intervals
      const baseConfidence = this.calculateConfidence(basePrice);
      const quoteConfidence = this.calculateConfidence(quotePrice);

      if (baseConfidence < 0.95 || quoteConfidence < 0.95) {
        this.logger.warn('Low Pyth price confidence', {
          baseConfidence,
          quoteConfidence,
        });
      }

      // Check staleness
      const baseStale = this.isStale(basePrice.publishTime);
      const quoteStale = this.isStale(quotePrice.publishTime);

      if (baseStale || quoteStale) {
        this.logger.warn('Stale Pyth price data', {
          baseStale,
          quoteStale,
        });
        return null;
      }

      // Calculate price ratio
      const basePriceNum = Number(basePrice.price) * Math.pow(10, basePrice.expo);
      const quotePriceNum = Number(quotePrice.price) * Math.pow(10, quotePrice.expo);

      if (basePriceNum <= 0 || quotePriceNum <= 0) {
        return null;
      }

      const price = basePriceNum / quotePriceNum;

      if (!isFinite(price) || price <= 0) {
        return null;
      }

      // Cache result
      const priceData: PythPriceData = {
        price,
        confidence: Math.min(baseConfidence, quoteConfidence),
        publishTime: Date.now(),
        isStale: false,
      };
      this.priceCache.set(cacheKey, priceData);

      this.logger.debug('Fetched Pyth price', {
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
        price,
        confidence: priceData.confidence,
      });

      return price;
    } catch (error) {
      this.logger.warn('Failed to fetch Pyth price', {
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Subscribe to price updates (WebSocket)
   */
  async subscribeToPriceUpdates(
    baseMint: PublicKey,
    quoteMint: PublicKey,
    callback: (price: number) => void
  ): Promise<void> {
    const baseFeedId = this.getPythFeedId(baseMint);
    const quoteFeedId = this.getPythFeedId(quoteMint);

    if (!baseFeedId || !quoteFeedId) {
      throw new Error('No Pyth feed ID mapping for tokens');
    }

    this.logger.info('Subscribing to Pyth price updates', {
      baseMint: baseMint.toString(),
      quoteMint: quoteMint.toString(),
    });

    // Subscribe to price feeds
    this.connection.subscribePriceFeedUpdates([baseFeedId, quoteFeedId], (priceFeed: any) => {
      try {
        const price = priceFeed.getPriceUnchecked();
        if (price) {
          const priceNum = Number(price.price) * Math.pow(10, price.expo);
          callback(priceNum);
        }
      } catch (error) {
        this.logger.error('Price update callback error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }

  /**
   * Calculate confidence level (0-1)
   */
  private calculateConfidence(price: any): number {
    if (!price.conf || !price.price) {
      return 0;
    }

    const priceNum = Math.abs(Number(price.price));
    const confNum = Number(price.conf);

    if (priceNum === 0) {
      return 0;
    }

    // Confidence = 1 - (confidence_interval / price)
    const confidence = 1 - confNum / priceNum;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Check if price data is stale
   */
  private isStale(publishTime: number): boolean {
    const now = Date.now() / 1000; // Convert to seconds
    const age = (now - publishTime) * 1000; // Convert back to ms

    return age > this.stalenessThresholdMs;
  }

  /**
   * Get Pyth price feed ID for a token mint
   */
  private getPythFeedId(mint: PublicKey): string | null {
    const mintStr = mint.toString();

    // Comprehensive mappings for common tokens
    const mappings: Record<string, string> = {
      // SOL/USD
      So11111111111111111111111111111111111111112:
        '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
      // USDC/USD
      EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:
        '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
      // USDT/USD
      Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:
        '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
      // BTC/USD (Wrapped)
      '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E':
        '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
      // ETH/USD (Wrapped)
      '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs':
        '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    };

    return mappings[mintStr] || null;
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    // Pyth connection doesn't need explicit closing
    this.priceCache.clear();
    this.logger.info('Pyth price feed connection closed');
  }
}