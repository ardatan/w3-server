import { describe, expect, it, jest } from '@jest/globals';
import { PonyfillBtoa } from '../src/TextEncoderDecoder.js';

it('should work as expected', () => {
  expect(PonyfillBtoa('Hello, world!')).toBe('SGVsbG8sIHdvcmxkIQ==');
});
