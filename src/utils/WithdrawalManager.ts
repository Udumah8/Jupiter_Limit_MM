/**
 * Withdrawal Manager - Auto-withdrawal and Profit Collection
 * Handles collecting funds from trading wallets back to master
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';
import { Logger } from './Logger.js';
import pRetry from 'p-retry';

export interface WithdrawalConfig {
  autoWithdrawThresholdSol: number;
  minBalanceToKeepSol: number;
  batchSize: number;
  maxRetries: number;
  closeTokenAccounts: boolean;
}

export interface WithdrawalResult {
  wallet: PublicKey;
  solWithdrawn: BN;
  tokenWithdrawn: BN;
  signature: string;
  success: boolean;
}

export class WithdrawalManager {
  private connection: Connection;
  private logger: Logger;
  private config: WithdrawalConfig;

  constructor(connection: Connection, config: WithdrawalConfig, logger: Logger) {
    this.connection = connection;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Auto-withdraw profits from wallets above threshold
   */
  async autoWithdrawProfits(
    wallets: Keypair[],
    masterWallet: Keypair,
    tokenMint?: PublicKey
  ): Promise<WithdrawalResult[]> {
    this.logger.info('Starting auto-withdrawal', {
      walletCount: wallets.length,
      masterWallet: masterWallet.publicKey.toString(),
    });

    const results: WithdrawalResult[] = [];

    for (const wallet of wallets) {
      try {
        const balance = await this.connection.getBalance(wallet.publicKey);
        const balanceSol = balance / LAMPORTS_PER_SOL;

        if (balanceSol > this.config.autoWithdrawThresholdSol) {
          const result = await this.withdrawFromWallet(
            wallet,
            masterWallet,
            tokenMint
          );
          results.push(result);

          this.logger.info('Withdrew from wallet', {
            wallet: wallet.publicKey.toString(),
            solWithdrawn: result.solWithdrawn.toString(),
          });
        }
      } catch (error) {
        this.logger.error('Failed to withdraw from wallet', {
          wallet: wallet.publicKey.toString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        results.push({
          wallet: wallet.publicKey,
          solWithdrawn: new BN(0),
          tokenWithdrawn: new BN(0),
          signature: '',
          success: false,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const totalSol = results.reduce(
      (sum, r) => sum.add(r.solWithdrawn),
      new BN(0)
    );

    this.logger.info('Auto-withdrawal completed', {
      total: results.length,
      successful: successCount,
      totalSolWithdrawn: totalSol.toString(),
    });

    return results;
  }

  /**
   * Withdraw from a single wallet
   */
  async withdrawFromWallet(
    from: Keypair,
    to: Keypair,
    tokenMint?: PublicKey
  ): Promise<WithdrawalResult> {
    const tx = new Transaction();
    let solWithdrawn = new BN(0);
    let tokenWithdrawn = new BN(0);

    try {
      // Get current balance
      const balance = await this.connection.getBalance(from.publicKey);
      const minBalanceLamports = Math.floor(
        this.config.minBalanceToKeepSol * LAMPORTS_PER_SOL
      );

      // Calculate amount to withdraw (leave minimum balance for rent)
      const rentExempt = await this.connection.getMinimumBalanceForRentExemption(0);
      const minToKeep = Math.max(minBalanceLamports, rentExempt + 5000); // 5000 lamports for tx fee
      const amountToWithdraw = balance - minToKeep;

      if (amountToWithdraw > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: from.publicKey,
            toPubkey: to.publicKey,
            lamports: amountToWithdraw,
          })
        );
        solWithdrawn = new BN(amountToWithdraw);
      }

      // Withdraw tokens if specified
      if (tokenMint) {
        const sourceTokenAccount = await getAssociatedTokenAddress(
          tokenMint,
          from.publicKey
        );

        try {
          const tokenAccountInfo = await this.connection.getTokenAccountBalance(
            sourceTokenAccount
          );
          const tokenBalance = new BN(tokenAccountInfo.value.amount);

          if (tokenBalance.gt(new BN(0))) {
            const destTokenAccount = await getAssociatedTokenAddress(
              tokenMint,
              to.publicKey
            );

            // Transfer tokens
            tx.add(
              createTransferInstruction(
                sourceTokenAccount,
                destTokenAccount,
                from.publicKey,
                BigInt(tokenBalance.toString())
              )
            );

            // Optionally close token account to reclaim rent
            if (this.config.closeTokenAccounts) {
              tx.add(
                createCloseAccountInstruction(
                  sourceTokenAccount,
                  from.publicKey,
                  from.publicKey
                )
              );
            }

            tokenWithdrawn = tokenBalance;
          }
        } catch {
          // Token account doesn't exist or has no balance
        }
      }

      // Send transaction
      const signature = await pRetry(
        async () => {
          return await sendAndConfirmTransaction(this.connection, tx, [from], {
            commitment: 'confirmed',
            skipPreflight: false,
          });
        },
        {
          retries: this.config.maxRetries,
          minTimeout: 2000,
          onFailedAttempt: (error) => {
            this.logger.warn('Withdrawal attempt failed', {
              attempt: error.attemptNumber,
              retriesLeft: error.retriesLeft,
              wallet: from.publicKey.toString(),
            });
          },
        }
      );

      return {
        wallet: from.publicKey,
        solWithdrawn,
        tokenWithdrawn,
        signature,
        success: true,
      };
    } catch (error) {
      this.logger.error('Failed to withdraw from wallet', {
        wallet: from.publicKey.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        wallet: from.publicKey,
        solWithdrawn: new BN(0),
        tokenWithdrawn: new BN(0),
        signature: '',
        success: false,
      };
    }
  }

  /**
   * Collect all funds from all wallets (emergency/shutdown)
   */
  async collectAllFunds(
    wallets: Keypair[],
    masterWallet: Keypair,
    tokenMint?: PublicKey
  ): Promise<WithdrawalResult[]> {
    this.logger.warn('Collecting all funds from wallets', {
      walletCount: wallets.length,
    });

    const results: WithdrawalResult[] = [];

    // Process in batches to avoid overwhelming the network
    for (let i = 0; i < wallets.length; i += this.config.batchSize) {
      const batch = wallets.slice(i, i + this.config.batchSize);

      const batchResults = await Promise.all(
        batch.map((wallet) =>
          this.withdrawFromWallet(wallet, masterWallet, tokenMint)
        )
      );

      results.push(...batchResults);

      this.logger.info('Batch collection completed', {
        batch: Math.floor(i / this.config.batchSize) + 1,
        walletsProcessed: results.length,
      });
    }

    const successCount = results.filter((r) => r.success).length;
    const totalSol = results.reduce(
      (sum, r) => sum.add(r.solWithdrawn),
      new BN(0)
    );
    const totalToken = results.reduce(
      (sum, r) => sum.add(r.tokenWithdrawn),
      new BN(0)
    );

    this.logger.info('Fund collection completed', {
      total: results.length,
      successful: successCount,
      totalSolCollected: totalSol.toString(),
      totalTokenCollected: totalToken.toString(),
    });

    return results;
  }

  /**
   * Emergency withdrawal - withdraw everything immediately
   */
  async emergencyWithdraw(
    wallets: Keypair[],
    masterWallet: Keypair,
    tokenMint?: PublicKey
  ): Promise<void> {
    this.logger.error('EMERGENCY WITHDRAWAL INITIATED', {
      walletCount: wallets.length,
    });

    // Temporarily disable minimum balance requirement
    const originalMinBalance = this.config.minBalanceToKeepSol;
    this.config.minBalanceToKeepSol = 0;

    try {
      await this.collectAllFunds(wallets, masterWallet, tokenMint);
    } finally {
      // Restore original config
      this.config.minBalanceToKeepSol = originalMinBalance;
    }

    this.logger.info('Emergency withdrawal completed');
  }

  /**
   * Calculate total withdrawable amount
   */
  async calculateWithdrawableAmount(
    wallets: Keypair[],
    tokenMint?: PublicKey
  ): Promise<{ sol: BN; token: BN }> {
    let totalSol = new BN(0);
    let totalToken = new BN(0);

    const minBalanceLamports = Math.floor(
      this.config.minBalanceToKeepSol * LAMPORTS_PER_SOL
    );

    for (const wallet of wallets) {
      try {
        const balance = await this.connection.getBalance(wallet.publicKey);
        const withdrawable = Math.max(0, balance - minBalanceLamports);
        totalSol = totalSol.add(new BN(withdrawable));

        if (tokenMint) {
          try {
            const tokenAccount = await getAssociatedTokenAddress(
              tokenMint,
              wallet.publicKey
            );
            const tokenAccountInfo = await this.connection.getTokenAccountBalance(
              tokenAccount
            );
            totalToken = totalToken.add(new BN(tokenAccountInfo.value.amount));
          } catch {
            // Token account doesn't exist
          }
        }
      } catch (error) {
        this.logger.warn('Failed to check wallet balance', {
          wallet: wallet.publicKey.toString(),
        });
      }
    }

    return { sol: totalSol, token: totalToken };
  }

  /**
   * Get withdrawal statistics
   */
  async getWithdrawalStats(
    results: WithdrawalResult[]
  ): Promise<{
    totalWallets: number;
    successful: number;
    failed: number;
    totalSol: number;
    totalToken: number;
  }> {
    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    const totalSol = results.reduce(
      (sum, r) => sum.add(r.solWithdrawn),
      new BN(0)
    );
    const totalToken = results.reduce(
      (sum, r) => sum.add(r.tokenWithdrawn),
      new BN(0)
    );

    return {
      totalWallets: results.length,
      successful,
      failed,
      totalSol: totalSol.toNumber() / LAMPORTS_PER_SOL,
      totalToken: totalToken.toNumber(),
    };
  }
}
