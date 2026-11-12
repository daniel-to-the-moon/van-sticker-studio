import {
  addLayer,
  editLayer,
  emptyProject,
  newLayer,
  type Art,
  type Project,
  type Side,
} from '@/lib/free-wrap';
import { defaultLabDesign, designMarks } from '@/lib/vehicle-model-profile';

/**
 * First-run shell for /design.
 * The starter artwork is the existing lab default (one finished scheme already
 * on main). Theme catalogs stay in S2 (`lib/wrap-themes.ts`); this file only
 * reserves the one-tap slot.
 */
export const CHASSIS_IDS = [
  'current-glb',
  'box-trailer',
  'high-roof',
  'step-slide',
] as const;
export type ChassisId = (typeof CHASSIS_IDS)[number];
export type MarkIcon = Art['icon'];

export type FirstRunState = {
  advanced: boolean;
  mirror: boolean;
  chassisId: ChassisId;
  project: Project;
};

export const CHASSIS_OPTIONS: { id: ChassisId; label: string }[] = [
  { id: 'current-glb', label: '当前车型' },
  { id: 'box-trailer', label: '箱式 / 拖挂（验证）' },
  { id: 'high-roof', label: '高顶曲面厢车（验证）' },
  { id: 'step-slide', label: '阶梯额头 / 拓展舱（验证）' },
];

const ICONS: { id: MarkIcon; label: string }[] = [
  { id: 'cup', label: '咖啡杯' },
  { id: 'runner', label: '剪影' },
  { id: 'badge', label: '小标志' },
];

const ICON_COLORS = ['#1c2430', '#8aafa1', '#bd7453', '#dfbb4d'];

export function isChassisId(value: string): value is ChassisId {
  return (CHASSIS_IDS as readonly string[]).includes(value);
}

/** Both sides carry the same linked artwork, so lettering stays readable. */
export function projectMirrored(project: Project): boolean {
  return (
    project.layers.length > 0 &&
    project.layers.every(
      (layer) =>
        layer.linked &&
        layer.entry !== null &&
        layer.driver !== null &&
        JSON.stringify(layer.entry) === JSON.stringify(layer.driver),
    )
  );
}

/** Existing single finished scheme. Not the S2 theme pack. */
export function starterProject(): Project {
  const design = defaultLabDesign();
  let project: Project = { ...emptyProject(), background: '#f4efe4' };
  for (const mark of designMarks(design)) {
    const kind = mark.kind === 'swatch' ? 'region' : mark.kind;
    project = addLayer(project, newLayer(kind, mark.kind), 'entry', true);
    project = editLayer(project, mark.kind, 'entry', {
      x: mark.editorX,
      y: mark.editorY,
      w: mark.w,
      h: mark.h,
      color: mark.kind === 'swatch' ? design.swatch : '#1c2430',
      text: design.text,
      icon: design.icon,
      ...(mark.kind === 'swatch'
        ? {
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
          }
        : {}),
    });
  }
  return project;
}

export function createFirstRunState(): FirstRunState {
  const project = starterProject();
  return {
    advanced: false,
    mirror: projectMirrored(project),
    chassisId: 'current-glb',
    project,
  };
}

export function shopNameOf(project: Project): string {
  for (const layer of project.layers) {
    const art = layer.entry ?? layer.driver;
    if (art?.kind === 'text') return art.text;
  }
  return '';
}

function editKind(
  project: Project,
  kind: Art['kind'],
  patch: Partial<Art>,
): Project {
  const layer = project.layers.find(
    (item) => item.entry?.kind === kind || item.driver?.kind === kind,
  );
  if (!layer) {
    if (kind !== 'text') return project;
    const created = newLayer('text', 'text');
    return editLayer(
      addLayer(project, created, 'entry', true),
      created.id,
      'entry',
      patch,
    );
  }
  const side: Side = layer.entry ? 'entry' : 'driver';
  return editLayer(project, layer.id, side, patch);
}

export function setShopName(state: FirstRunState, name: string): FirstRunState {
  const project = editKind(state.project, 'text', { text: name.slice(0, 200) });
  return { ...state, project, mirror: projectMirrored(project) };
}

export function setMarkIcon(
  state: FirstRunState,
  icon: MarkIcon,
): FirstRunState {
  const project = editKind(state.project, 'icon', { icon });
  return { ...state, project, mirror: projectMirrored(project) };
}

export function setMarkColor(
  state: FirstRunState,
  color: string,
): FirstRunState {
  const project = editKind(state.project, 'icon', { color });
  return { ...state, project, mirror: projectMirrored(project) };
}

export function toggleAdvanced(state: FirstRunState): FirstRunState {
  return { ...state, advanced: !state.advanced };
}

export function switchChassis(
  state: FirstRunState,
  chassisId: string,
): FirstRunState {
  if (!isChassisId(chassisId) || chassisId === state.chassisId) return state;
  return { ...state, chassisId };
}

export function isDrawingFailure(message: string): boolean {
  return /线太短|请重新画|请画一条线|请画一个闭合|边界交叉|这条线太复杂/.test(
    message,
  );
}

export default function FirstRunShell({
  shopName,
  mirror,
  chassisId,
  density,
  onShopName,
  onChassis,
  onIcon,
  onIconColor,
  onAddBlock,
  onDeleteBlock,
  canDeleteBlock,
}: {
  shopName: string;
  mirror: boolean;
  chassisId: ChassisId;
  density: 'full' | 'compact';
  onShopName: (name: string) => void;
  onChassis: (id: ChassisId) => void;
  onIcon: (icon: MarkIcon) => void;
  onIconColor: (color: string) => void;
  onAddBlock: () => void;
  onDeleteBlock: () => void;
  canDeleteBlock: boolean;
}) {
  return (
    <section className={`wrap-first-run is-${density}`} aria-label="首屏">
      <label className="wrap-shop-name">
        店名
        <input
          aria-label="店名"
          value={shopName}
          maxLength={200}
          onChange={(event) => onShopName(event.target.value)}
        />
      </label>
      <p className="wrap-mirror-note">
        {mirror
          ? '另一侧已自动同步，文字正向可读'
          : '这一侧单独保留，另一侧不会跟着改'}
      </p>
      <div className="wrap-theme-slot" data-theme-slot="s2-pending">
        <button
          type="button"
          disabled
          aria-describedby="wrap-theme-slot-note"
        >
          换一套主题
        </button>
        <p id="wrap-theme-slot-note">
          主题包接入后可一键更换，当前仍是这一套成品
        </p>
      </div>
      <label className="wrap-chassis">
        车型
        <select
          aria-label="车型"
          value={chassisId}
          onChange={(event) => {
            if (isChassisId(event.target.value)) onChassis(event.target.value);
          }}
        >
          {CHASSIS_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {chassisId !== 'current-glb' && (
        <p className="wrap-chassis-note">
          店名、对称和手势保持不变。这辆验证车体的立体预览仍用当前车型，按新车身重映射尚未接入。
        </p>
      )}
      <div className="wrap-section">
        <h2>店铺底色块</h2>
        <div className="wrap-assets">
          <button type="button" onClick={onAddBlock}>
            添加底色块
          </button>
          <button type="button" onClick={onDeleteBlock} disabled={!canDeleteBlock}>
            删除底色块
          </button>
        </div>
        <p>拖顶点改范围，拖边上的点可以拐弯，绕开车窗，不用手绘路径。</p>
      </div>
      {density === 'full' && (
        <>
          <p className="wrap-tweak-hint">点选图案后拖动，双指缩放</p>
          <div className="wrap-section">
            <h2>换一个图标</h2>
            <div className="wrap-assets">
              {ICONS.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  onClick={() => onIcon(icon.id)}
                >
                  {icon.label}
                </button>
              ))}
            </div>
            <div className="wrap-swatches" aria-label="图标颜色">
              {ICON_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  style={{ background: color }}
                  aria-label={`图标颜色 ${color}`}
                  onClick={() => onIconColor(color)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
