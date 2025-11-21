
import { IPriceFeed, PriceFeedData } from './IPriceFeed.js';
import { logger } from '../utils/Logger.js';
import fetch from 'node-fetch';

// NOTE: This is a simplified client. A production version would use the Pyth.network SDK
// for on-chain price verification. For a bot, an off-chain API is often sufficient and faster.

const PYTH_API_ENDPOINT = 'https://hermes.pyth.network/v2/updates/price/latest';

export class PythPriceFeed implements IPriceFeed {
  
  // A mapping from human-readable symbols to Pyth's price feed IDs.
  // This would need to be expanded for other tokens.
  private static symbolToId: Record<string, string> = {
      'SOL': '0xef0d8b6145a242f32af23233b20701540ca528f42d4a0f44e8f2433f016f8462', // SOL/USD
      'USDC': '0x8f9a2d017b9463b7c2b6fb0b9322588b3b12e45a331f8f01c8a74da9142f102d' // USDC/USD
      // Add other tokens here e.g. BONK, WIF etc.
  };

  public async getPrice(baseMint: string, quoteMint: string): Promise<PriceFeedData | null> {
    logger.debug('Fetching price from Pyth...');
    try {
        // For now, we will assume standard pairs against USDC
        // A full implementation would need a routing logic for pairs like BONK/SOL
        const baseSymbol = this.mintToSymbol(baseMint);
        const quoteSymbol = this.mintToSymbol(quoteMint);
        
        if (quoteSymbol !== 'USDC') {
            logger.warn(`Pyth feed currently only supports pairs against USDC. Quote: ${quoteMint}`);
            return null;
        }

        const basePriceId = PythPriceFeed.symbolToId[baseSymbol];
        if (!basePriceId) {
            logger.warn(`No Pyth price feed ID found for mint ${baseMint}`);
            return null;
        }

        const response = await fetch(`${PYTH_API_ENDPOINT}?ids[]=${basePriceId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json() as { parsed?: Array<{ price?: { price: number; expo: number } }> };
        const priceData = data.parsed?.[0]?.price;
        
        if (!priceData) {
            logger.warn('No price data found in Pyth response');
            return null;
        }
        
        // Pyth prices are integers with an exponent
        const price = priceData.price * (10 ** priceData.expo);

        logger.debug(`Pyth price for ${baseSymbol}: ${price}`);
        return { price, source: 'pyth' };

    } catch (error) {
      logger.error('Failed to fetch price from Pyth.', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }
  
  // This is a placeholder. A real implementation would use a token registry.
  private mintToSymbol(mint: string): string {
      const registry: Record<string, string> = {
          'So11111111111111111111111111111111111111112': 'SOL',
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC'
      };
      return registry[mint] || 'UNKNOWN';
  }
}
