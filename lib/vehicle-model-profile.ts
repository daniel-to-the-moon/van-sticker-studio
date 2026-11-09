import type { WrapBody } from './wrap-layout.ts';

/** Canonical vehicle frame: metres, nose −X, up +Y, driver side +Z. */
export type AxisId = 'x' | 'y' | 'z';
export type SignedAxis = { axis: AxisId; sign: 1 | -1 };
export type Vec3 = readonly [number, number, number];
export type SourceFrame = {
  unit: 'm' | 'mm';
  rearward: SignedAxis;
  up: SignedAxis;
  driver: SignedAxis;
  /** Source-space point, in source units, that becomes the canonical origin. */
  origin: Vec3;
};
export type PanelClass =
  | 'wrap'
  | 'glass'
  | 'lamp'
  | 'wheel'
  | 'interior'
  | 'trim';
export type SideFace = 'entry' | 'driver' | 'front' | 'rear';
export type LocalFace = SideFace | 'roof' | 'step' | 'slide';
export type PerimeterProjection = {
  kind: 'perimeter';
  face: SideFace;
  /**
   * Registered production wrap shell. Keeps the current editor's perimeter
   * chart, including audited relief. Verification bodies leave this unset.
   */
  shell?: boolean;
};
export type ArcProjection = {
  kind: 'arc';
  springY: number;
  centerZ: number;
  radius: number;
};
export type LocalProjection = {
  kind: 'local';
  face: LocalFace;
  origin: Vec3;
  axisS: Vec3;
  axisH: Vec3;
  width: number;
  height: number;
  outward: Vec3;
};
export type UnsupportedProjection = { kind: 'unsupported'; reason: string };
export type PanelProjection =
  | PerimeterProjection
  | ArcProjection
  | LocalProjection
  | UnsupportedProjection;
export type PanelOpening = {
  id: string;
  s0: number;
  s1: number;
  h0: number;
  h1: number;
};
export type PanelMotion =
  | { kind: 'hinge'; point: Vec3; axis: Vec3; angle: number }
  | { kind: 'slide'; direction: Vec3; distance: number };
export type PanelVoid = { id: string; min: Vec3; max: Vec3; reason: string };
export type VehiclePanel = {
  id: string;
  class: PanelClass;
  meshes: readonly string[];
  projection?: PanelProjection;
  openings?: readonly PanelOpening[];
  motion?: PanelMotion;
  /** Reject when |chart length / world length − 1| exceeds this. Default 0.15. */
  maxStretch?: number;
};
export type MeshRefusal = {
  meshes: readonly string[];
  status: 'excluded' | 'unsupported';
  reason: string;
};
export type VehicleEnvelope = {
  xMin: number;
  length: number;
  width: number;
  height: number;
  centerZ: number;
};
export type VehicleModelProfile = {
  id: string;
  label: string;
  /** Procedural bodies are verification models, not production dimensions. */
  verification: boolean;
  frame: SourceFrame;
  envelope: VehicleEnvelope;
  panels: readonly VehiclePanel[];
  voids?: readonly PanelVoid[];
  refusals?: readonly MeshRefusal[];
};
export type FeedbackStatus = 'applied' | 'excluded' | 'unsupported';
export type PanelFeedback = {
  mesh: string;
  panelId: string | null;
  status: FeedbackStatus;
  reason: string;
};
export type LabIcon = 'cup' | 'runner' | 'badge';
export type LabDesign = {
  version: 1;
  text: string;
  icon: LabIcon;
  swatch: string;
  x: number;
  y: number;
  scale: number;
};
export type DesignMark = {
  kind: 'swatch' | 'icon' | 'text';
  editorX: number;
  editorY: number;
  w: number;
  h: number;
  text?: string;
};
export type MarkPlacement = {
  kind: DesignMark['kind'];
  editorX: number;
  noseDistance: number;
  entryS: number;
  driverS: number;
  mirrorGlyphs: false;
  text?: string;
};

const CLASS_REASON: Record<Exclude<PanelClass, 'wrap'>, string> = {
  glass: '玻璃不贴',
  lamp: '灯具不贴',
  wheel: '轮胎不贴',
  interior: '内表面不贴',
  trim: '饰件不贴',
};

export const canonicalFrame = (): SourceFrame => ({
  unit: 'm',
  rearward: { axis: 'x', sign: 1 },
  up: { axis: 'y', sign: 1 },
  driver: { axis: 'z', sign: 1 },
  origin: [0, 0, 0],
});

const axisVector = (axis: SignedAxis): [number, number, number] => {
  const vector: [number, number, number] = [0, 0, 0];
  vector[axis.axis === 'x' ? 0 : axis.axis === 'y' ? 1 : 2] = axis.sign;
  return vector;
};

/** Right-handed frames only. A left-handed basis would mirror glyphs. */
export function assertRightHanded(frame: SourceFrame): void {
  const rearward = axisVector(frame.rearward);
  const up = axisVector(frame.up);
  const driver = axisVector(frame.driver);
  const cross = [
    rearward[1] * up[2] - rearward[2] * up[1],
    rearward[2] * up[0] - rearward[0] * up[2],
    rearward[0] * up[1] - rearward[1] * up[0],
  ];
  const volume = cross[0] * driver[0] + cross[1] * driver[1] + cross[2] * driver[2];
  if (Math.abs(volume - 1) > 1e-8)
    throw new Error('车体轴向不是右手系，拒绝会镜像字形的左手坐标');
}

export function toCanonical(source: Vec3, frame: SourceFrame): [number, number, number] {
  assertRightHanded(frame);
  const scale = frame.unit === 'mm' ? 0.001 : 1;
  const delta = [
    (source[0] - frame.origin[0]) * scale,
    (source[1] - frame.origin[1]) * scale,
    (source[2] - frame.origin[2]) * scale,
  ];
  const component = (axis: SignedAxis) =>
    delta[axis.axis === 'x' ? 0 : axis.axis === 'y' ? 1 : 2] * axis.sign;
  return [component(frame.rearward), component(frame.up), component(frame.driver)];
}

export function envelopeBody(profile: VehicleModelProfile): WrapBody {
  return {
    xMin: profile.envelope.xMin,
    length: profile.envelope.length,
    width: profile.envelope.width,
    height: profile.envelope.height,
    centerZ: profile.envelope.centerZ,
  };
}

export function findPanel(
  profile: VehicleModelProfile,
  mesh: string,
): VehiclePanel | undefined {
  return profile.panels.find((panel) => panel.meshes.includes(mesh));
}

export function classifyMesh(
  profile: VehicleModelProfile,
  mesh: string,
): PanelFeedback {
  const panel = findPanel(profile, mesh);
  if (panel) {
    if (panel.class !== 'wrap')
      return {
        mesh,
        panelId: panel.id,
        status: 'excluded',
        reason: CLASS_REASON[panel.class],
      };
    if (!panel.projection || panel.projection.kind === 'unsupported')
      return {
        mesh,
        panelId: panel.id,
        status: 'unsupported',
        reason: panel.projection?.reason ?? '该包覆面没有可用投影',
      };
    return {
      mesh,
      panelId: panel.id,
      status: 'applied',
      reason: '已登记包覆面',
    };
  }
  const refusal = profile.refusals?.find((item) => item.meshes.includes(mesh));
  if (refusal)
    return {
      mesh,
      panelId: null,
      status: refusal.status,
      reason: refusal.reason,
    };
  return {
    mesh,
    panelId: null,
    status: 'unsupported',
    reason: '未登记网格，不会静默贴上',
  };
}

/** Whether the current side design may ink this mesh. Registered shells can still be excluded. */
export function designCoverage(
  profile: VehicleModelProfile,
  mesh: string,
): PanelFeedback {
  const classified = classifyMesh(profile, mesh);
  if (classified.status !== 'applied') return classified;
  const projection = findPanel(profile, mesh)?.projection;
  if (!projection || projection.kind === 'unsupported') return classified;
  if (projection.kind === 'arc')
    return {
      ...classified,
      status: 'excluded',
      reason: '曲面顶按弧长建坐标，不拉伸进侧围矩形',
    };
  if (projection.kind === 'local' && (projection.face === 'step' || projection.face === 'roof'))
    return {
      ...classified,
      status: 'excluded',
      reason: '阶梯面不并入侧围矩形',
    };
  if (
    projection.kind === 'perimeter' &&
    (projection.face === 'front' || projection.face === 'rear')
  )
    return {
      ...classified,
      status: 'excluded',
      reason: '端面不套用左右侧围设计',
    };
  return classified;
}

export function withPanelMotion(
  profile: VehicleModelProfile,
  panelId: string,
  motion: PanelMotion,
): VehicleModelProfile {
  return {
    ...profile,
    panels: profile.panels.map((panel) =>
      panel.id === panelId ? { ...panel, motion } : panel,
    ),
  };
}

export const defaultLabDesign = (): LabDesign => ({
  version: 1,
  text: 'MXGARAGE',
  icon: 'cup',
  swatch: '#c4553a',
  x: 0.14,
  y: 0.28,
  scale: 1,
});

/** Editor x = 0 is the nose. The icon sits to the left of the text. */
export function designMarks(design: LabDesign): DesignMark[] {
  const scale = design.scale;
  return [
    {
      kind: 'swatch',
      editorX: design.x,
      editorY: design.y,
      w: 0.58 * scale,
      h: 0.42 * scale,
    },
    {
      kind: 'icon',
      editorX: design.x + 0.03 * scale,
      editorY: design.y + 0.08 * scale,
      w: 0.12 * scale,
      h: 0.22 * scale,
    },
    {
      kind: 'text',
      editorX: design.x + 0.18 * scale,
      editorY: design.y + 0.12 * scale,
      w: 0.34 * scale,
      h: 0.16 * scale,
      text: design.text,
    },
  ];
}

/**
 * Placement along the vehicle, not a glyph mirror.
 * Entry chart s runs rear→front, so editor-left (nose) lands at a larger s.
 * Driver chart s runs front→rear. Glyphs stay left-to-right in the texture.
 */
export function placeDesign(
  profile: VehicleModelProfile,
  design: LabDesign,
): MarkPlacement[] {
  const { length, width } = profile.envelope;
  return designMarks(design).map((mark) => ({
    kind: mark.kind,
    editorX: mark.editorX,
    noseDistance: mark.editorX * length,
    entryS: length * (1 - mark.editorX),
    driverS: length + width + mark.editorX * length,
    mirrorGlyphs: false,
    ...(mark.text ? { text: mark.text } : {}),
  }));
}

export function serializeLabDesign(design: LabDesign): string {
  return JSON.stringify(design);
}

export function parseLabDesign(raw: string): LabDesign {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('设计无法读取');
  }
  if (!value || typeof value !== 'object') throw new Error('设计无法读取');
  const record = value as Record<string, unknown>;
  const icon = record.icon;
  const swatch = record.swatch;
  const text = record.text;
  const numbers = [record.x, record.y, record.scale];
  if (record.version !== 1) throw new Error('设计版本无法读取');
  if (typeof text !== 'string' || text.length < 1 || text.length > 32)
    throw new Error('文字需要 1 到 32 个字符');
  if (icon !== 'cup' && icon !== 'runner' && icon !== 'badge')
    throw new Error('图标不在可用集合里');
  if (typeof swatch !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(swatch))
    throw new Error('色块需要 #RRGGBB');
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item)))
    throw new Error('位置或缩放无法读取');
  const [x, y, scale] = numbers as number[];
  if (x < 0 || x > 0.8 || y < 0 || y > 0.8 || scale < 0.4 || scale > 1.6)
    throw new Error('位置或缩放超出可恢复范围');
  return { version: 1, text, icon, swatch, x, y, scale };
}
