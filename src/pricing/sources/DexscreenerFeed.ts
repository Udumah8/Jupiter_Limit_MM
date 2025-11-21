/**
 * Dexscreener Price Feed
 * Fetches price data from Dexscreener API
 */

import { PublicKey } from '@solana/web3.js';
import { Logger } from '../../utils/Logger.js';

export class DexscreenerFeed {
  private logger: Logger;
  private baseUrl = 'https://api.dexscreener.com';

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Get price from Dexscreener for a token pair
   */
  async getPrice(baseMint: PublicKey, quoteMint: PublicKey): Promise<number | null> {
    try {
      const baseMintStr = baseMint.toString();
      const quoteMintStr = quoteMint.toString();

      // Get all pairs for the base token
      const response = await fetch(
        `${this.baseUrl}/latest/dex/tokens/${baseMintStr}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Dexscreener API returned ${response.status}`);
      }

      const data = await response.json();
      const pairs = (data as any)?.pairs;

      if (!Array.isArray(pairs) || pairs.length === 0) {
        return null;
      }

      // Find the best matching pair
      let selectedPair = null;
      let selectedPrice = null;

      // First, try to find exact pair match
      selectedPair = pairs.find((pair: any) =>
        pair?.baseToken?.address?.toLowerCase() === baseMintStr.toLowerCase() &&
        pair?.quoteToken?.address?.toLowerCase() === quoteMintStr.toLowerCase()
      );

      if (selectedPair) {
        selectedPrice = parseFloat(selectedPair.priceUsd || selectedPair.price);
      } else {
        // Try to find SOL pair if quote is SOL
        if (quoteMintStr === 'So11111111111111111111111111111111111111112') {
          selectedPair = pairs.find((pair: any) =>
            pair?.quoteToken?.symbol === 'SOL' ||
            pair?.quoteToken?.address?.toLowerCase() === quoteMintStr.toLowerCase()
          );

          if (selectedPair) {
            selectedPrice = parseFloat(selectedPair.priceUsd || selectedPair.price);
          }
        }

        // Try to find USDC pair if quote is USDC
        if (!selectedPrice && quoteMintStr === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
          selectedPair = pairs.find((pair: any) =>
            pair?.quoteToken?.symbol === 'USDC' ||
            pair?.quoteToken?.address?.toLowerCase() === quoteMintStr.toLowerCase()
          );

          if (selectedPair) {
            selectedPrice = parseFloat(selectedPair.priceUsd || selectedPair.price);
          }
        }

        // Fallback to first pair with valid price
        if (!selectedPrice) {
          for (const pair of pairs) {
            const price = parseFloat(pair.priceUsd || pair.price);
            if (price && price > 0) {
              selectedPrice = price;
              selectedPair = pair;
              break;
            }
          }
        }
      }

      if (!selectedPrice || selectedPrice <= 0 || !isFinite(selectedPrice)) {
        return null;
      }

      // If we have a SOL pair but quote is not SOL, we need to convert
      if (selectedPair?.quoteToken?.symbol === 'SOL' && quoteMintStr !== 'So11111111111111111111111111111111111111112') {
        // Get SOL price in USD and convert
        try {
          const solResponse = await fetch(
            `${this.baseUrl}/latest/dex/tokens/So11111111111111111111111111111111111111112`
          );

          if (solResponse.ok) {
            const solData = await solResponse.json();
            const solPairs = (solData as any)?.pairs;
            const solPair = solPairs?.find((p: any) => p?.quoteToken?.symbol === 'USDC') || solPairs?.[0];

            if (solPair) {
              const solPriceUSD = parseFloat(solPair.priceUsd || solPair.price);
              if (solPriceUSD && solPriceUSD > 0) {
                selectedPrice = selectedPrice / solPriceUSD;
              }
            }
          }
        } catch (error) {
          this.logger.warn('Failed to convert SOL price', { error: error instanceof Error ? error.message : 'Unknown' });
        }
      }

      this.logger.debug('Fetched Dexscreener price', {
        baseMint: baseMintStr,
        quoteMint: quoteMintStr,
        price: selectedPrice,
        pair: selectedPair?.pairAddress,
      });

      return selectedPrice;

    } catch (error) {
      this.logger.warn('Failed to fetch Dexscreener price', {
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }
}