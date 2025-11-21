#!/usr/bin/env node

/**
 * Encryption Key Generator
 * 
 * Generates a cryptographically secure 32-character encryption key
 * for the WALLET_ENCRYPTION_KEY environment variable.
 */

import crypto from 'crypto';

function generateEncryptionKey() {
  // Generate 32 random bytes and convert to base64
  const buffer = crypto.randomBytes(32);
  const key = buffer.toString('base64').slice(0, 32);
  
  console.log('🔐 Generated Encryption Key:');
  console.log('');
  console.log(key);
  console.log('');
  console.log('📋 Instructions:');
  console.log('1. Copy the key above');
  console.log('2. Replace "your_32_character_encryption_key_here" in your .env file');
  console.log('3. Keep this key safe - you will need it to decrypt your wallet keys');
  console.log('4. Do not share this key with anyone');
  console.log('');
  console.log('⚠️  SECURITY WARNING:');
  console.log('- Store this key in a secure location');
  console.log('- If you lose this key, you cannot recover your encrypted wallet keys');
  console.log('- Consider using a password manager to store this key securely');
  console.log('');
  
  return key;
}

// Generate multiple keys for choice
console.log('🎲 Generating secure encryption keys...\n');

for (let i = 1; i <= 3; i++) {
  console.log(`Option ${i}:`);
  generateEncryptionKey();
  console.log('─'.repeat(50));
}

console.log('\n💡 Choose one of the keys above and update your .env file.');