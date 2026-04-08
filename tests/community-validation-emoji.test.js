'use strict';

const test = require('node:test');
const assert = require('node:assert');
const cv = require('../telegram-bot/lib/community-validation.js');

test('containsEmojiOrPictograph: scudo, smile e nome pulito', () => {
  assert.strictEqual(cv.containsEmojiOrPictograph('foo🛡bar'), true);
  assert.strictEqual(cv.containsEmojiOrPictograph('x😀y'), true);
  assert.strictEqual(cv.containsEmojiOrPictograph('Mario#2J2VLPP9R'), false);
  assert.strictEqual(cv.containsEmojiOrPictograph('Mario Rossi#2J2VLPP9R'), false);
  assert.strictEqual(cv.containsEmojiOrPictograph('cafè_99#2J2VLPP9R'), false);
});

test('containsEmojiOrPictograph: sequenza bandiera (due indicatori)', () => {
  assert.strictEqual(cv.containsEmojiOrPictograph('\uD83C\uDDEE\uD83C\uDDF9'), true);
});
