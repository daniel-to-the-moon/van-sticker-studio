/**
 * Bounded M2/L03 domain foundation: rectangular floor fixture placement validator.
 * Uses millimeters, positive finite sizes, x/y offsets from envelope origin.
 * Rotation: 0 or 90 degrees only.
 * Distinguishes: invalid geometry, outside envelope, collision with occupied fixtures
 * or reserved opening clearance rectangles, and valid placement.
 * Touching edges allowed. Existing fixtures remain untouched.
 */

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Envelope {
  width: number;
  height: number;
}

export interface Fixture extends Rectangle {
  /** x and y locate the top-left corner of the rotated footprint. */
  rotation: 0 | 90;
}

export type PlacementResult =
  | { valid: true }
  | { valid: false; reason: 'invalid_geometry' }
  | { valid: false; reason: 'outside_envelope' }
  | { valid: false; reason: 'collision_with_fixture' }
  | { valid: false; reason: 'collision_with_clearance' }
  | { valid: false; reason: 'unsupported_rotation' };

/**
 * Validates placement of a candidate fixture within a verified interior envelope.
 * @param candidate - The fixture to validate
 * @param envelope - The interior space envelope
 * @param existingFixtures - Already placed fixtures (must remain untouched)
 * @param openingClearances - Reserved clearance rectangles around openings
 * @returns PlacementResult indicating validity or specific rejection reason
 */
export function validateFixturePlacement(
  candidate: Fixture,
  envelope: Envelope,
  existingFixtures: readonly Fixture[],
  openingClearances: readonly Rectangle[],
): PlacementResult {
  // Reject unsupported rotation
  if (candidate.rotation !== 0 && candidate.rotation !== 90) {
    return { valid: false, reason: 'unsupported_rotation' };
  }

  // Validate candidate geometry
  if (!isValidGeometry(candidate)) {
    return { valid: false, reason: 'invalid_geometry' };
  }

  // Validate envelope
  if (!isFinitePositive(envelope.width) || !isFinitePositive(envelope.height)) {
    return { valid: false, reason: 'invalid_geometry' };
  }

  // Validate existing fixtures and clearances
  for (const fixture of existingFixtures) {
    if (!isValidGeometry(fixture)) {
      return { valid: false, reason: 'invalid_geometry' };
    }
    if (fixture.rotation !== 0 && fixture.rotation !== 90) {
      return { valid: false, reason: 'invalid_geometry' };
    }
  }

  for (const clearance of openingClearances) {
    if (!isValidRectangle(clearance)) {
      return { valid: false, reason: 'invalid_geometry' };
    }
    if (!isFiniteRect(clearance)) {
      return { valid: false, reason: 'invalid_geometry' };
    }
  }

  // Get candidate bounds after rotation
  const candidateBounds = getRotatedBounds(candidate);
  if (!isFiniteRect(candidateBounds)) {
    return { valid: false, reason: 'invalid_geometry' };
  }

  // Check envelope bounds
  if (!isWithinEnvelope(candidateBounds, envelope)) {
    return { valid: false, reason: 'outside_envelope' };
  }

  // Check collision with existing fixtures
  for (const fixture of existingFixtures) {
    const fixtureBounds = getRotatedBounds(fixture);
    if (!isFiniteRect(fixtureBounds)) {
      return { valid: false, reason: 'invalid_geometry' };
    }
    if (rectanglesOverlap(candidateBounds, fixtureBounds)) {
      return { valid: false, reason: 'collision_with_fixture' };
    }
  }

  // Check collision with opening clearances
  for (const clearance of openingClearances) {
    if (rectanglesOverlap(candidateBounds, clearance)) {
      return { valid: false, reason: 'collision_with_clearance' };
    }
  }

  return { valid: true };
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidRectangle(rect: Rectangle): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    isFinitePositive(rect.width) &&
    isFinitePositive(rect.height)
  );
}

function isValidGeometry(fixture: Fixture): boolean {
  return isValidRectangle(fixture);
}

function isFiniteRect(rect: Rectangle): boolean {
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  return Number.isFinite(x2) && Number.isFinite(y2);
}

function getRotatedBounds(fixture: Fixture): Rectangle {
  if (fixture.rotation === 90) {
    return {
      x: fixture.x,
      y: fixture.y,
      width: fixture.height,
      height: fixture.width,
    };
  }
  return {
    x: fixture.x,
    y: fixture.y,
    width: fixture.width,
    height: fixture.height,
  };
}

function isWithinEnvelope(rect: Rectangle, envelope: Envelope): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= envelope.width &&
    rect.y + rect.height <= envelope.height
  );
}

function rectanglesOverlap(a: Rectangle, b: Rectangle): boolean {
  // Touching edges are allowed (strict inequality)
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
