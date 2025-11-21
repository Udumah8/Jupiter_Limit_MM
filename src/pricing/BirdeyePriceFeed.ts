
import { IPriceFeed, PriceFeedData } from './IPriceFeed.js';
import { IAppConfig } from '../utils/AppConfig.js';
import { logger } from '../utils/Logger.js';
import fetch from 'node-fetch';

const BIRDEYE_API_ENDPOINT = 'https://public-api.birdeye.so/defi/price';

export class BirdeyePriceFeed implements IPriceFeed {
  private apiKey: string;

  constructor(private config: IAppConfig) {
    this.apiKey = this.config.BIRDEYE_API_KEY || '';
    if (!this.apiKey) {
      logger.warn('Birdeye API key is not configured. Birdeye price feed will be disabled.');
    }
  }

  public async getPrice(baseMint: string, quoteMint: string): Promise<PriceFeedData | null> {
    if (!this.apiKey) {
      return null;
    }
    
    // Birdeye prices tokens in USD, so we get the price of each and derive the pair price.
    // This is a simplification; a robust implementation might find a direct pair market.
    logger.debug('Fetching price from Birdeye...');
    try {
      const basePrice = await this.fetchTokenPrice(baseMint);
      const quotePrice = await this.fetchTokenPrice(quoteMint);

      if (basePrice && quotePrice) {
        const price = basePrice / quotePrice;
        logger.debug(`Birdeye price for ${baseMint}/${quoteMint}: ${price}`);
        return { price, source: 'birdeye' };
      }
      
      return null;

    } catch (error) {
      logger.error('Failed to fetch price from Birdeye.', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }
  
  private async fetchTokenPrice(mint: string): Promise<number | null> {
      const url = `${BIRDEYE_API_ENDPOINT}?address=${mint}`;
      const headers = { 'X-API-KEY': this.apiKey };
      
      const response = await fetch(url, { headers });
      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json() as { data?: { value?: number } };
      if (data?.data?.value) {
          return data.data.value;
      }
      
      return null;
  }
}
