/**
 * Jupiter Price Feed
 * Fetches price data from Jupiter's quote API
 */

import { PublicKey } from '@solana/web3.js';
import { Logger } from '../../utils/Logger.js';

export class JupiterPriceFeed {
  private logger: Logger;
  private baseUrl = 'https://quote-api.jup.ag/v6';

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Get price from Jupiter for a token pair
   */
  async getPrice(baseMint: PublicKey, quoteMint: PublicKey): Promise<number | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/quote?inputMint=${baseMint.toString()}&outputMint=${quoteMint.toString()}&amount=1000000&slippageBps=50`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Jupiter API returned ${response.status}`);
      }

      const data = await response.json() as any;
      const routes = data.data || data.routes || [data];

      if (!routes || routes.length === 0) {
        return null;
      }

      const bestRoute = routes[0];

      if (!bestRoute.outAmount || !bestRoute.inAmount) {
        return null;
      }

      // Calculate price: output tokens / input tokens
      const inAmount = Number(bestRoute.inAmount);
      const outAmount = Number(bestRoute.outAmount);

      if (inAmount <= 0 || outAmount <= 0) {
        return null;
      }

      const price = outAmount / inAmount;

      if (!isFinite(price) || price <= 0) {
        return null;
      }

      this.logger.debug('Fetched Jupiter price', {
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
        price,
      });

      return price;

    } catch (error) {
      this.logger.warn('Failed to fetch Jupiter price', {
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}