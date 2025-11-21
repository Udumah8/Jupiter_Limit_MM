
import { IPriceFeed, PriceFeedData } from './IPriceFeed.js';
import { logger } from '../utils/Logger.js';
import fetch from 'node-fetch';
import { IAppConfig } from '../utils/AppConfig.js';

const JUPITER_API_ENDPOINT = 'https://quote-api.jup.ag/v6/quote';

export class JupiterPriceFeed implements IPriceFeed {

  constructor(_config: IAppConfig) {}

  public async getPrice(baseMint: string, quoteMint: string): Promise<PriceFeedData | null> {
    logger.debug('Fetching price from Jupiter...');
    try {
      // We fetch the price for a small, fixed amount of the base token to get the current rate.
      // 1000 is a placeholder for a small amount in quote currency units (e.g. $10)
      const url = `${JUPITER_API_ENDPOINT}?inputMint=${baseMint}&outputMint=${quoteMint}&amount=1000&slippageBps=50`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as { outAmount?: string; inAmount?: string };
      if (data && data.outAmount && data.inAmount) {
        const inAmount = parseInt(data.inAmount, 10);
        const outAmount = parseInt(data.outAmount, 10);
        
        // This is a rough price derivation. A more robust solution would account for decimals.
        // For now, this is sufficient for a price feed.
        if (inAmount > 0) {
            const price = outAmount / inAmount;
            logger.debug(`Jupiter price for ${baseMint}/${quoteMint}: ${price}`);
            return { price, source: 'jupiter' };
        }
      }
      
      return null;

    } catch (error) {
      logger.error('Failed to fetch price from Jupiter.', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }
}
