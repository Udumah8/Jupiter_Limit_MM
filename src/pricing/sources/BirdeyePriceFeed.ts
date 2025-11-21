/**
 * Birdeye Price Feed
 * Fetches price data from Birdeye API
 */

import { PublicKey } from '@solana/web3.js';
import { Logger } from '../../utils/Logger.js';

export class BirdeyePriceFeed {
  private logger: Logger;
  private baseUrl = 'https://public-api.birdeye.so';
  private apiKey?: string;

  constructor(logger: Logger, apiKey?: string) {
    this.logger = logger;
    this.apiKey = apiKey;
  }

  /**
   * Get price from Birdeye for a token pair
   */
  async getPrice(baseMint: PublicKey, quoteMint: PublicKey): Promise<number | null> {
    try {
      const baseMintStr = baseMint.toString();
      const quoteMintStr = quoteMint.toString();

      // Get base token price in USD
      const baseResponse = await fetch(
        `${this.baseUrl}/defi/price?address=${baseMintStr}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Chain': 'solana',
            ...(this.apiKey && { 'X-API-KEY': this.apiKey }),
          },
        }
      );

      if (!baseResponse.ok) {
        throw new Error(`Birdeye API returned ${baseResponse.status} for base token`);
      }

      const baseData = await baseResponse.json();
      const basePriceUSD = parseFloat((baseData as any)?.data?.value);

      if (!basePriceUSD || basePriceUSD <= 0) {
        return null;
      }

      // Handle different quote tokens
      if (quoteMintStr === 'So11111111111111111111111111111111111111112') {
        // SOL quote - need to get SOL price and convert
        const solResponse = await fetch(
          `${this.baseUrl}/defi/price?address=${quoteMintStr}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Chain': 'solana',
              ...(this.apiKey && { 'X-API-KEY': this.apiKey }),
            },
          }
        );

        if (!solResponse.ok) {
          throw new Error(`Birdeye API returned ${solResponse.status} for SOL`);
        }

        const solData = await solResponse.json();
        const solPriceUSD = parseFloat((solData as any)?.data?.value);

        if (!solPriceUSD || solPriceUSD <= 0) {
          return null;
        }

        const price = basePriceUSD / solPriceUSD;

        if (!isFinite(price) || price <= 0) {
          return null;
        }

        this.logger.debug('Fetched Birdeye base/SOL price', {
          baseMint: baseMintStr,
          quoteMint: quoteMintStr,
          price,
        });

        return price;

      } else if (quoteMintStr === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
        // USDC quote - price is already in USD
        this.logger.debug('Fetched Birdeye base/USDC price', {
          baseMint: baseMintStr,
          quoteMint: quoteMintStr,
          price: basePriceUSD,
        });

        return basePriceUSD;

      } else {
        // Other quote token - try to get its price and convert
        const quoteResponse = await fetch(
          `${this.baseUrl}/defi/price?address=${quoteMintStr}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Chain': 'solana',
              ...(this.apiKey && { 'X-API-KEY': this.apiKey }),
            },
          }
        );

        if (!quoteResponse.ok) {
          // Fallback: assume USD quote
          this.logger.warn('Failed to get quote token price, assuming USD', {
            quoteMint: quoteMintStr,
          });
          return basePriceUSD;
        }

        const quoteData = await quoteResponse.json();
        const quotePriceUSD = parseFloat((quoteData as any)?.data?.value);

        if (!quotePriceUSD || quotePriceUSD <= 0) {
          // Fallback: assume USD quote
          return basePriceUSD;
        }

        const price = basePriceUSD / quotePriceUSD;

        if (!isFinite(price) || price <= 0) {
          return null;
        }

        this.logger.debug('Fetched Birdeye base/quote price', {
          baseMint: baseMintStr,
          quoteMint: quoteMintStr,
          price,
        });

        return price;
      }

    } catch (error) {
      this.logger.warn('Failed to fetch Birdeye price', {
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}