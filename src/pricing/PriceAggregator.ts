/**
 * Multi-Source Price Aggregator
 * Blends prices from Pyth, Birdeye, Jupiter, and Dexscreener
 * Uses median for robustness against outliers
 */

import { PublicKey } from '@solana/web3.js';
import { JupiterPriceFeed } from './sources/JupiterPriceFeed.js';
import { PythPriceFeed } from './sources/PythPriceFeed.js';
import { BirdeyePriceFeed } from './sources/BirdeyePriceFeed.js';
import { DexscreenerFeed } from './sources/DexscreenerFeed.js';
import { Logger } from '../utils/Logger.js';

export interface PriceData {
  price: number;
  source: string;
  confidence: number;
  timestamp: number;
}

export interface AggregatedPrice {
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  sources: PriceData[];
  confidence: number;
  timestamp: number;
}

export interface PriceAggregatorConfig {
  cacheDurationMs: number;
  minSources: number;
  maxPriceDeviationPercent: number;
  spreadPercent: number;
  enableCircuitBreaker: boolean;
  circuitBreakerThresholdPercent: number;
}

export class PriceAggregator {
  private jupiterFeed: JupiterPriceFeed;
  private pythFeed: PythPriceFeed;
  private birdeyeFeed: BirdeyePriceFeed;
  private dexscreenerFeed: DexscreenerFeed;
  private logger: Logger;
  private config: PriceAggregatorConfig;
  
  private cache: Map<string, AggregatedPrice> = new Map();
  private lastPrice: number | null = null;

  constructor(config: PriceAggregatorConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    
    this.jupiterFeed = new JupiterPriceFeed(logger);
    this.pythFeed = new PythPriceFeed(logger);
    this.birdeyeFeed = new BirdeyePriceFeed(logger);
    this.dexscreenerFeed = new DexscreenerFeed(logger);
  }

  /**
   * Get aggregated price from multiple sources
   */
  async getPrice(
    baseMint: PublicKey,
    quoteMint: PublicKey,
    forceRefresh: boolean = false
  ): Promise<AggregatedPrice> {
    const cacheKey = `${baseMint.toString()}_${quoteMint.toString()}`;
    
    // Check cache
    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheDurationMs) {
        return cached;
      }
    }

    // Fetch from all sources in parallel
    const pricePromises = [
      this.fetchJupiterPrice(baseMint, quoteMint),
      this.fetchPythPrice(baseMint, quoteMint),
      this.fetchBirdeyePrice(baseMint, quoteMint),
      this.fetchDexscreenerPrice(baseMint, quoteMint),
    ];

    const results = await Promise.allSettled(pricePromises);
    const validPrices: PriceData[] = [];

    // Collect valid prices
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        validPrices.push(result.value);
      }
    }

    // Validate minimum sources
    if (validPrices.length < this.config.minSources) {
      this.logger.warn('Insufficient price sources', {
        available: validPrices.length,
        required: this.config.minSources,
      });
      
      // Use last known price if available
      if (this.lastPrice) {
        return this.createFallbackPrice(this.lastPrice);
      }
      
      throw new Error(`Insufficient price sources: ${validPrices.length}/${this.config.minSources}`);
    }

    // Calculate median price
    const prices = validPrices.map(p => p.price).sort((a, b) => a - b);
    const medianPrice = this.calculateMedian(prices);

    // Filter outliers
    const filteredPrices = validPrices.filter(p => {
      const deviation = Math.abs((p.price - medianPrice) / medianPrice) * 100;
      return deviation <= this.config.maxPriceDeviationPercent;
    });

    // Recalculate median with filtered prices
    const finalPrices = filteredPrices.map(p => p.price).sort((a, b) => a - b);
    const finalMedian = this.calculateMedian(finalPrices);

    // Circuit breaker check
    if (this.config.enableCircuitBreaker && this.lastPrice) {
      const priceChange = Math.abs((finalMedian - this.lastPrice) / this.lastPrice) * 100;
      
      if (priceChange > this.config.circuitBreakerThresholdPercent) {
        this.logger.error('Circuit breaker triggered', {
          currentPrice: finalMedian,
          lastPrice: this.lastPrice,
          changePercent: priceChange.toFixed(2),
        });
        
        // Use dampened price
        const dampenedPrice = this.lastPrice * (finalMedian > this.lastPrice ? 1.2 : 0.8);
        return this.createAggregatedPrice(dampenedPrice, filteredPrices);
      }
    }

    // Update last price
    this.lastPrice = finalMedian;

    // Create aggregated result
    const aggregated = this.createAggregatedPrice(finalMedian, filteredPrices);
    
    // Cache result
    this.cache.set(cacheKey, aggregated);
    
    return aggregated;
  }

  /**
   * Fetch price from Jupiter
   */
  private async fetchJupiterPrice(
    baseMint: PublicKey,
    quoteMint: PublicKey
  ): Promise<PriceData | null> {
    try {
      const price = await this.jupiterFeed.getPrice(baseMint, quoteMint);
      if (price && price > 0 && isFinite(price)) {
        return {
          price,
          source: 'jupiter',
          confidence: 0.9,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      this.logger.debug('Jupiter price fetch failed', { error });
    }
    return null;
  }

  /**
   * Fetch price from Pyth
   */
  private async fetchPythPrice(
    baseMint: PublicKey,
    quoteMint: PublicKey
  ): Promise<PriceData | null> {
    try {
      const price = await this.pythFeed.getPrice(baseMint, quoteMint);
      if (price && price > 0 && isFinite(price)) {
        return {
          price,
          source: 'pyth',
          confidence: 0.95,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      this.logger.debug('Pyth price fetch failed', { error });
    }
    return null;
  }

  /**
   * Fetch price from Birdeye
   */
  private async fetchBirdeyePrice(
    baseMint: PublicKey,
    quoteMint: PublicKey
  ): Promise<PriceData | null> {
    try {
      const price = await this.birdeyeFeed.getPrice(baseMint, quoteMint);
      if (price && price > 0 && isFinite(price)) {
        return {
          price,
          source: 'birdeye',
          confidence: 0.85,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      this.logger.debug('Birdeye price fetch failed', { error });
    }
    return null;
  }

  /**
   * Fetch price from Dexscreener
   */
  private async fetchDexscreenerPrice(
    baseMint: PublicKey,
    quoteMint: PublicKey
  ): Promise<PriceData | null> {
    try {
      const price = await this.dexscreenerFeed.getPrice(baseMint, quoteMint);
      if (price && price > 0 && isFinite(price)) {
        return {
          price,
          source: 'dexscreener',
          confidence: 0.8,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      this.logger.debug('Dexscreener price fetch failed', { error });
    }
    return null;
  }

  /**
   * Calculate median of array
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    return sorted[mid];
  }

  /**
   * Create aggregated price result
   */
  private createAggregatedPrice(
    midPrice: number,
    sources: PriceData[]
  ): AggregatedPrice {
    const spreadHalf = this.config.spreadPercent / 100 / 2;
    
    // Calculate confidence based on source agreement
    const avgConfidence = sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length;
    
    return {
      midPrice,
      bestBid: midPrice * (1 - spreadHalf),
      bestAsk: midPrice * (1 + spreadHalf),
      sources,
      confidence: avgConfidence,
      timestamp: Date.now(),
    };
  }

  /**
   * Create fallback price when sources fail
   */
  private createFallbackPrice(price: number): AggregatedPrice {
    const spreadHalf = this.config.spreadPercent / 100 / 2;
    
    return {
      midPrice: price,
      bestBid: price * (1 - spreadHalf),
      bestAsk: price * (1 + spreadHalf),
      sources: [{
        price,
        source: 'fallback',
        confidence: 0.5,
        timestamp: Date.now(),
      }],
      confidence: 0.5,
      timestamp: Date.now(),
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
