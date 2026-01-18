#!/usr/bin/env bun

/**
 * Test script to verify Chinese input handling in CLI
 *
 * This script simulates the key events that would be generated
 * when typing Chinese characters through an IME.
 */

import { parseKeypress, KeyEvent } from '@opentui/core'

// Simulate Chinese character input
function simulateChineseInput(text) {
  console.log(`Testing Chinese input: "${text}"`)
  console.log(`Character codes: ${Array.from(text).map(c => c.charCodeAt(0)).join(', ')}`)
  console.log(`UTF-8 bytes: ${Array.from(new TextEncoder().encode(text)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`)

  // Create a buffer with the UTF-8 encoded text
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)

  console.log(`\nSimulating keypress events for "${text}":`)

  // Parse as a single keypress event (this is what should happen)
  const key = parseKeypress(Buffer.from(bytes))

  if (key) {
    console.log('Parsed key event:')
    console.log(`  name: ${JSON.stringify(key.name)}`)
    console.log(`  sequence: ${JSON.stringify(key.sequence)}`)
    console.log(`  sequence length: ${key.sequence?.length}`)
    console.log(`  has name: ${!!key.name}`)

    // Test our isPrintableCharacterKey logic
    function isPrintableCharacterKey(key) {
      const name = key.name
      const sequence = key.sequence
      const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f]/

      // If we have a sequence but no name, this is likely multi-byte input
      if (!name && sequence && sequence.length > 0) {
        if (!sequence.startsWith('\x1B') && !CONTROL_CHAR_REGEX.test(sequence)) {
          return true
        }
      }

      if (!name) return true
      if (name.length === 1) return true
      if (name === 'space') return true
      return false
    }

    const isPrintable = isPrintableCharacterKey(key)
    console.log(`  isPrintableCharacterKey: ${isPrintable}`)

    if (isPrintable) {
      console.log(`  ✓ Would insert: "${key.sequence}"`)
    } else {
      console.log(`  ✗ Would be rejected`)
    }
  } else {
    console.log('  ✗ parseKeypress returned null')
  }

  console.log('')
}

// Test various Chinese inputs
console.log('=== Testing Chinese Input Handling ===\n')

// Single character
simulateChineseInput('你')

// Multiple characters
simulateChineseInput('你好')

// Longer phrase
simulateChineseInput('你好世界')

// Mixed with ASCII
simulateChineseInput('Hello你好')

console.log('=== Test Complete ===')
