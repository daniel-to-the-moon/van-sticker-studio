import assert from 'node:assert';
import { test } from 'node:test';
import {
  validateFixturePlacement,
  type Envelope,
  type Fixture,
  type Rectangle,
} from '../lib/interior-placement.ts';

const envelope: Envelope = { width: 5000, height: 2000 };

void test('valid placement within envelope', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

void test('valid placement with rotation 90', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: 600, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

void test('reject unsupported rotation', () => {
  const candidate = Object.assign({ x: 100, y: 100, width: 800, height: 600 }, { rotation: 45 });
  const result = validateFixturePlacement(candidate as unknown as Fixture, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'unsupported_rotation');
  }
});

void test('reject missing x coordinate', () => {
  const candidate = { y: 100, width: 800, height: 600, rotation: 0 } as unknown as Fixture;
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject non-finite x coordinate', () => {
  const candidate: Fixture = { x: NaN, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject non-finite y coordinate', () => {
  const candidate: Fixture = { x: 100, y: Infinity, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject zero width', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 0, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject negative height', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: -600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject non-finite computed endpoint', () => {
  const candidate: Fixture = { x: Number.MAX_VALUE, y: 100, width: Number.MAX_VALUE, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject outside envelope - negative x', () => {
  const candidate: Fixture = { x: -10, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

void test('reject outside envelope - exceeds width', () => {
  const candidate: Fixture = { x: 4500, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

void test('reject outside envelope - exceeds height', () => {
  const candidate: Fixture = { x: 100, y: 1800, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

void test('valid placement at envelope boundary', () => {
  const candidate: Fixture = { x: 0, y: 0, width: 5000, height: 2000, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

void test('valid placement touching envelope edge', () => {
  const candidate: Fixture = { x: 4200, y: 1400, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

void test('reject collision with existing fixture', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 700, y: 600, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'collision_with_fixture');
  }
});

void test('valid placement touching existing fixture edge', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 1500, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, true);
});

void test('valid placement adjacent to existing fixture', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 500, y: 1300, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, true);
});

void test('reject collision with opening clearance', () => {
  const clearance: Rectangle = { x: 2000, y: 800, width: 600, height: 400 };
  const candidate: Fixture = { x: 2100, y: 900, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], [clearance]);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'collision_with_clearance');
  }
});

void test('valid placement touching opening clearance edge', () => {
  const clearance: Rectangle = { x: 2000, y: 800, width: 600, height: 400 };
  const candidate: Fixture = { x: 2600, y: 800, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], [clearance]);
  assert.strictEqual(result.valid, true);
});

void test('valid with rotation 90 swapping dimensions', () => {
  const candidate: Fixture = { x: 100, y: 100, width: 1500, height: 600, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, true);
});

void test('reject rotated fixture outside envelope', () => {
  const candidate: Fixture = { x: 4500, y: 100, width: 1500, height: 600, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'outside_envelope');
  }
});

void test('reject rotated fixture collision', () => {
  const existing: Fixture = { x: 500, y: 500, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 400, y: 400, width: 1200, height: 500, rotation: 90 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'collision_with_fixture');
  }
});

void test('reject invalid existing fixture geometry', () => {
  const existing: Fixture = { x: 500, y: NaN, width: 1000, height: 800, rotation: 0 };
  const candidate: Fixture = { x: 2000, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject invalid existing fixture rotation', () => {
  const existing = Object.assign({ x: 500, y: 500, width: 1000, height: 800 }, { rotation: 180 });
  const candidate: Fixture = { x: 2000, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [existing as unknown as Fixture], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject invalid clearance rectangle', () => {
  const clearance: Rectangle = { x: 2000, y: 800, width: -600, height: 400 };
  const candidate: Fixture = { x: 3000, y: 500, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], [clearance]);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject clearance with overflow before overlap check', () => {
  const clearance: Rectangle = { x: Number.MAX_VALUE, y: 800, width: Number.MAX_VALUE, height: 400 };
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, envelope, [], [clearance]);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('reject invalid envelope', () => {
  const invalidEnvelope: Envelope = { width: 5000, height: 0 };
  const candidate: Fixture = { x: 100, y: 100, width: 800, height: 600, rotation: 0 };
  const result = validateFixturePlacement(candidate, invalidEnvelope, [], []);
  assert.strictEqual(result.valid, false);
  if (!result.valid) {
    assert.strictEqual(result.reason, 'invalid_geometry');
  }
});

void test('existing fixtures unchanged after validation', () => {
  const existing: Fixture[] = [
    { x: 500, y: 500, width: 1000, height: 800, rotation: 0 },
    { x: 2000, y: 1000, width: 600, height: 400, rotation: 90 },
  ];
  const candidate: Fixture = { x: 3000, y: 100, width: 800, height: 600, rotation: 0 };
  const originalExisting = JSON.parse(JSON.stringify(existing));
  validateFixturePlacement(candidate, envelope, existing, []);
  assert.deepStrictEqual(existing, originalExisting);
});

void test('valid with multiple existing fixtures and clearances', () => {
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

void test('rotation changes containment and collisions', () => {
  const nearRight: Fixture = { x: 4300, y: 100, width: 1500, height: 600, rotation: 0 };
  assert.deepEqual(validateFixturePlacement(nearRight, envelope, [], []), {
    valid: false, reason: 'outside_envelope',
  });
  assert.deepEqual(validateFixturePlacement({ ...nearRight, rotation: 90 }, envelope, [], []), {
    valid: true,
  });

  const nearBottom = { ...nearRight, x: 100, y: 1000 };
  assert.deepEqual(validateFixturePlacement(nearBottom, envelope, [], []), { valid: true });
  assert.deepEqual(validateFixturePlacement({ ...nearBottom, rotation: 90 }, envelope, [], []), {
    valid: false, reason: 'outside_envelope',
  });

  const narrow: Fixture = { x: 500, y: 500, width: 200, height: 800, rotation: 0 };
  const adjacent: Fixture = { x: 1000, y: 500, width: 200, height: 200, rotation: 0 };
  assert.deepEqual(validateFixturePlacement(narrow, envelope, [adjacent], []), { valid: true });
  assert.deepEqual(validateFixturePlacement({ ...narrow, rotation: 90 }, envelope, [adjacent], []), {
    valid: false, reason: 'collision_with_fixture',
  });
  assert.deepEqual(validateFixturePlacement(adjacent, envelope, [{ ...narrow, rotation: 90 }], []), {
    valid: false, reason: 'collision_with_fixture',
  });
  assert.deepEqual(validateFixturePlacement({ ...narrow, rotation: 90 }, envelope, [], [adjacent]), {
    valid: false, reason: 'collision_with_clearance',
  });
});
