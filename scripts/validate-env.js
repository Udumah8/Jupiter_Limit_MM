#!/usr/bin/env node

/**
 * Environment Configuration Validation Script
 * 
 * This script validates the .env configuration file to ensure all required
 * parameters are properly set before running the market making bot.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found');
    process.exit(1);
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLines = envContent.split('\n');
  const env = {};
  
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  }
  
  return env;
}

// Validation rules
const validationRules = {
  // Required fields
  required: [
    'SOLANA_RPC_URL',
    'SOLANA_NETWORK',
    'DEX_NAME',
    'BASE_MINT',
    'QUOTE_MINT',
    'FUNDING_WALLET_PRIVATE_KEY',
    'WALLET_ENCRYPTION_KEY',
    'BOT_ENABLED'
  ],
  
  // Numeric ranges
  numericRanges: {
    'NUMBER_OF_TRADING_WALLETS': { min: 1, max: 20 },
    'MIN_TRADING_WALLET_BALANCE': { min: 0, max: null },
    'BASE_TRADE_AMOUNT': { min: 0.001, max: null },
    'SPREAD_PERCENTAGE': { min: 0.1, max: 10.0 },
    'MAX_POSITION_SIZE': { min: 0.01, max: null },
    'INVENTORY_SKEW': { min: 0, max: 1.0 },
    'MAX_SLIPPAGE': { min: 0.1, max: 5.0 },
    'STOP_LOSS_PERCENTAGE': { min: 0.1, max: 20.0 },
    'TAKE_PROFIT_PERCENTAGE': { min: 0.1, max: 10.0 },
    'MAX_REQUESTS_PER_MINUTE': { min: 1, max: 1000 },
    'MAX_RETRY_ATTEMPTS': { min: 1, max: 10 },
    'RETRY_DELAY_MS': { min: 100, max: 10000 },
    'ORDER_REFRESH_TIME': { min: 10, max: 300 },
    'MIN_ORDER_SIZE': { min: 0.0001, max: null },
    'MAX_ORDER_SIZE': { min: 0.001, max: null }
  },
  
  // Boolean fields
  booleanFields: [
    'BOT_ENABLED',
    'DRY_RUN',
    'SIMULATION_MODE',
    'ENABLE_TELEGRAM_NOTIFICATIONS',
    'ENABLE_PROFILING',
    'PROFILE_OPERATIONS'
  ],
  
  // Network validation
  networks: ['mainnet-beta', 'devnet', 'testnet'],
  
  // DEX validation
  dexes: ['raydium', 'orca', 'serum']
};

function validateConfiguration(env) {
  const errors = [];
  const warnings = [];
  const info = [];
  
  console.log('🔍 Validating .env configuration...\n');
  
  // Check required fields
  for (const required of validationRules.required) {
    if (!env[required] || env[required].includes('your_')) {
      errors.push(`Missing or placeholder value for required field: ${required}`);
    }
  }
  
  // Validate numeric ranges
  for (const [field, range] of Object.entries(validationRules.numericRanges)) {
    if (env[field]) {
      const value = parseFloat(env[field]);
      if (isNaN(value)) {
        errors.push(`${field} must be a valid number, got: ${env[field]}`);
      } else {
        if (range.min !== null && value < range.min) {
          errors.push(`${field} (${value}) is below minimum (${range.min})`);
        }
        if (range.max !== null && value > range.max) {
          errors.push(`${field} (${value}) exceeds maximum (${range.max})`);
        }
      }
    }
  }
  
  // Validate boolean fields
  for (const field of validationRules.booleanFields) {
    if (env[field] && !['true', 'false'].includes(env[field].toLowerCase())) {
      errors.push(`${field} must be 'true' or 'false', got: ${env[field]}`);
    }
  }
  
  // Validate network
  if (env.SOLANA_NETWORK && !validationRules.networks.includes(env.SOLANA_NETWORK)) {
    errors.push(`SOLANA_NETWORK must be one of: ${validationRules.networks.join(', ')}, got: ${env.SOLANA_NETWORK}`);
  }
  
  // Validate DEX
  if (env.DEX_NAME && !validationRules.dexes.includes(env.DEX_NAME.toLowerCase())) {
    warnings.push(`DEX_NAME '${env.DEX_NAME}' may not be fully supported. Recommended: ${validationRules.dexes.join(', ')}`);
  }
  
  // Check for common issues
  if (env.FUNDING_WALLET_PRIVATE_KEY && env.FUNDING_WALLET_PRIVATE_KEY.includes('your_')) {
    errors.push('⚠️  SECURITY: Please update FUNDING_WALLET_PRIVATE_KEY with your actual wallet private key');
  }
  
  if (env.WALLET_ENCRYPTION_KEY && (env.WALLET_ENCRYPTION_KEY.includes('your_') || env.WALLET_ENCRYPTION_KEY.length !== 32)) {
    errors.push('⚠️  SECURITY: WALLET_ENCRYPTION_KEY must be exactly 32 characters and not a placeholder');
  }
  
  // Check for dangerous configurations
  if (env.BOT_ENABLED === 'true' && env.DRY_RUN === 'false') {
    warnings.push('⚠️  WARNING: Bot is enabled for live trading (DRY_RUN=false). Ensure you have tested thoroughly!');
  }
  
  if (env.BASE_TRADE_AMOUNT && parseFloat(env.BASE_TRADE_AMOUNT) > 0.1) {
    warnings.push('⚠️  WARNING: BASE_TRADE_AMOUNT is high. Consider starting with smaller amounts for testing.');
  }
  
  if (env.SPREAD_PERCENTAGE && parseFloat(env.SPREAD_PERCENTAGE) < 0.1) {
    warnings.push('⚠️  WARNING: SPREAD_PERCENTAGE is very low. This may result in uncompetitive pricing.');
  }
  
  // Check for missing optional but recommended fields
  if (!env.ENABLE_TELEGRAM_NOTIFICATIONS) {
    info.push('ℹ️  Consider setting up Telegram notifications for monitoring');
  }
  
  if (env.LOG_LEVEL && env.LOG_LEVEL !== 'info') {
    info.push(`ℹ️  Log level set to: ${env.LOG_LEVEL}`);
  }
  
  return { errors, warnings, info };
}

function printResults(validation) {
  const { errors, warnings, info } = validation;
  
  if (errors.length > 0) {
    console.log('❌ VALIDATION ERRORS:');
    errors.forEach(error => console.log(`   ${error}`));
    console.log('');
  }
  
  if (warnings.length > 0) {
    console.log('⚠️  VALIDATION WARNINGS:');
    warnings.forEach(warning => console.log(`   ${warning}`));
    console.log('');
  }
  
  if (info.length > 0) {
    console.log('ℹ️  ADDITIONAL INFO:');
    info.forEach(infoMsg => console.log(`   ${infoMsg}`));
    console.log('');
  }
  
  // Summary
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Configuration validation passed! Your .env file looks good.');
  } else if (errors.length === 0) {
    console.log('✅ Configuration validation passed with warnings. Review warnings above.');
  } else {
    console.log('❌ Configuration validation failed. Please fix the errors above before running the bot.');
    process.exit(1);
  }
}

function printQuickSummary(env) {
  console.log('📋 CONFIGURATION SUMMARY:');
  console.log(`   Network: ${env.SOLANA_NETWORK || 'Not set'}`);
  console.log(`   DEX: ${env.DEX_NAME || 'Not set'}`);
  console.log(`   Base Token: ${env.BASE_MINT ? (env.BASE_MINT.substring(0, 8) + '...') : 'Not set'}`);
  console.log(`   Quote Token: ${env.QUOTE_MINT ? (env.QUOTE_MINT.substring(0, 8) + '...') : 'Not set'}`);
  console.log(`   Bot Enabled: ${env.BOT_ENABLED || 'Not set'}`);
  console.log(`   Dry Run: ${env.DRY_RUN || 'Not set'}`);
  console.log(`   Trade Amount: ${env.BASE_TRADE_AMOUNT || 'Not set'} SOL`);
  console.log(`   Spread: ${env.SPREAD_PERCENTAGE || 'Not set'}%`);
  console.log('');
}

// Main execution
try {
  const env = loadEnv();
  printQuickSummary(env);
  const validation = validateConfiguration(env);
  printResults(validation);
} catch (error) {
  console.error('❌ Error validating configuration:', error.message);
  process.exit(1);
}