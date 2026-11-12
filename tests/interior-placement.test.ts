import assert from 'node:assert';
import { test } from 'node:test';
import {
  validateFixturePlacement,
  type Envelope,
  type Fixture,
  type Rectangle,
} from '../lib/interior-placement.ts';

const envelope: Envelope = { width: 5000, height: 2000 };

test('valid placement within envelope', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

test('valid placement with rotation 90', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: 600, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

test('reject unsupported rotation', () => {
  const candidate = { x: 100, y: 100, width: 800, height: 600, rotation: 45 } as Fixture;
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'unsupported_rotation');
  }
});

test('reject missing x coordinate', () => {
  const candidate = { y: 100, width: 800, height: 600, rotation: 0 } as unknown as Fixture;
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject non-finite x coordinate', () => {
  const candidate: Fixture = { x: NaN, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject non-finite y coordinate', () => {
  const candidate: Fixture = { x: 100, y: Infinity, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject zero width', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 0, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject negative height', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: -600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject non-finite computed endpoint', () => {
  const candidate: Fixture = { x: Number.MAX_VALUE, y: 100, width: Number.MAX_VALUE, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject outside envelope - negative x', () => {
  const candidate: Fixture = { x: -10, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

test('reject outside envelope - exceeds width', () => {
  const candidate: Fixture = { x: 4500, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

test('reject outside envelope - exceeds height', () => {
  const candidate: Fixture = { x: 100, y: 1800, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

test('valid placement at envelope boundary', () => {
  const candidate: Fixture = { x: 0, y: 0, width: 5000, height: 2000, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

test('valid placement touching envelope edge', () => {
  const candidate: Fixture = { x: 4200, y: 1400, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

test('reject collision with existing fixture', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 700, y: 600, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'collision_with_fixture');
  }
});

test('valid placement touching existing fixture edge', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 1500, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, true);
});

test('valid placement adjacent to existing fixture', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 500, y: 1300, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, true);
});

test('reject collision with opening clearance', () => {
  const clearance: Rectangle = { x: 2000, y: 800, width: 600, height: 400 };
  const candidate: Fixture = { x: 2100, y: 900, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], [clearance]);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'collision_with_clearance');
  }
});

test('valid placement touching opening clearance edge', () => {
  const clearance: Rectangle = { x: 2000, y: 800, width: 600, height: 400 };
  const candidate: Fixture = { x: 2600, y: 800, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], [clearance]);
  assert.strictEqual(result.valid, true);
});

test('valid with rotation 90 swapping dimensions', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 1500, height: 600, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

test('reject rotated fixture outside envelope', () => {
  const candidate: Fixture = { x: 4500, y: 100, width: 1500, height: 600, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

test('reject rotated fixture collision', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 400, y: 400, width: 1200, height: 500, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'collision_with_fixture');
  }
});

test('reject invalid existing fixture geometry', () => {
  const existing: Fixture = { x: 500, y: NaN, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 2000, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject invalid existing fixture rotation', () => {
  const existing = { x: 500, y: 500, width: 1000, height: 800, rotation: 180 } as Fixture;
  const candidate: Fixture = { x: 2000, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject invalid clearance rectangle', () => {
  const clearance: Rectangle = { x: 2000, y: 800, width: -600, height: 400 };
  const candidate: Fixture = { x: 3000, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], [clearance]);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('reject invalid envelope', () => {
  const invalidEnvelope: Envelope = { width: 5000, height: 0 };
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, invalidEnvelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

test('existing fixtures unchanged after validation', () => {
  const existing: Fixture[] = [
    { x: 500, y: 500, width: 1000, height: 800, rotation: 0 },
    { x: 2000, y: 1000, width: 600, height: 400, rotation: 90 },
  ];
  const candidate: Fixture = { x: 3000, y: 100, width: 800, height: 600, rotation: 0 };
  const originalExisting = JSON.parse(JSON.stringify(existing));
  validateFixturePlacement(candidate, envelope, existing, []);
  assert.deepStrictEqual(existing, originalExisting);
});

test('valid with multiple existing fixtures and clearances', () => {
  const existing: Fixture[] = [
    { x: 500, y: 500, width: 1000, height: 800, rotation: 0 },
    { x: 2000, y: 100, width: 600, height: 400, rotation: 90 },
  ];
  const clearances: Rectangle[] = [
    { x: 3000, y: 1200, width: 500, height: 300 },
    { x: 100, y: 1500, width: 400, height: 200 },
  ];
  const candidate: Fixture = { x: 3500, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, existing, clearances);
  assert.strictEqual(result.valid, true);
});

