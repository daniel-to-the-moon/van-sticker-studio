'use client';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  MousePointer2,
  Hand,
  PenLine,
  Palette,
  Type,
  ImagePlus,
  Undo2,
  Redo2,
  Box,
  Layers,
  Trash2,
  Copy,
  LockKeyhole,
  Eye,
  EyeOff,
  Link2,
  Unlink,
  Download,
  Upload,
  RotateCcw,
  Plus,
  Minus,
} from 'lucide-react';
import VehicleScene, { type VehicleHandle } from './VehicleScene';
import FirstRunShell, {
  isChassisId,
  isDrawingFailure,
  projectMirrored,
  setMarkColor,
  setMarkIcon,
  setShopName,
  shopNameOf,
  switchChassis,
  starterProject,
  type ChassisId,
  type FirstRunState,
} from './FirstRunShell';
import {
  addLayer,
  artMarkup,
  commit,
  editLayer,
  history,
  newLayer,
  parseProject,
  pathData,
  redo,
  regionPoints,
  removeLayer,
  setLinked,
  shortcut,
  svgDocument,
  tidy,
  undo,
  type Art,
  type History,
  type Point,
  type Project,
  type Side,
} from '@/lib/free-wrap';
import './wrap-design.css';
import guides from '@/lib/wrap-guides.json';
import { DraftPersistence, type DraftStatus } from '@/lib/draft-persistence';
const STORE = 'mxgarage-free-wrap-v1';
type Tool = 'select' | 'region' | 'stroke' | 'nodes' | 'pan';
type Gesture = {
  id: number;
  start: Point;
  base: Project;
  art: Art | null;
  layer: string;
  points: Point[];
  node: number | null;
};
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const freshId = () => crypto.randomUUID();
const labels: Record<Tool, string> = {
  select: '选择',
  pan: '平移',
  region: '画边界',
  stroke: '画涂鸦',
  nodes: '调整节点',
};
function download(content: string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function IconButton({
  label,
  onClick,
  icon,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

export default function WrapDesignStudio({
  initialAdvanced = false,
  initialChassis = 'current-glb',
  initialProject,
}: {
  initialAdvanced?: boolean;
  initialChassis?: ChassisId;
  initialProject?: Project;
} = {}) {
  const [h, setH] = useState<History>(() =>
    history(initialProject ?? starterProject()),
  );
  const [advanced, setAdvanced] = useState(initialAdvanced);
  const [chassisId, setChassisId] = useState<ChassisId>(() =>
    isChassisId(initialChassis) ? initialChassis : 'current-glb',
  );
  const [hydrated, setHydrated] = useState(false),
    [saveStatus, setSaveStatus] = useState<DraftStatus>('loading');
  const draft = useRef<DraftPersistence | null>(null);
  const [side, setSide] = useState<Side>('entry'),
    [selected, setSelected] = useState('');
  const [tool, setTool] = useState<Tool>('select'),
    [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [preview, setPreview] = useState<Project | null>(null),
    [line, setLine] = useState<Point[]>([]);
  const [color, setColor] = useState('#8aafa1'),
    [linked, setDefaultLinked] = useState(true);
  const [region, setRegion] = useState<'above' | 'below' | 'closed'>('below');
  const [dashed, setDashed] = useState(true),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const [message, setMessage] = useState(''),
    [layerPanel, setLayerPanel] = useState(false);
  const [parts, setParts] = useState<Record<string, boolean>>({});
  const board = useRef<SVGSVGElement>(null),
    scene = useRef<VehicleHandle>(null);
  const gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    distance: number;
    zoom: number;
    center: { x: number; y: number };
    pan: Point;
  } | null>(null);
  const pinchObject = useRef<{
    distance: number;
    art: Art;
    layer: string;
  } | null>(null);
  const multi = useRef(false);
  const mousePan = useRef<{ x: number; y: number; pan: Point } | null>(null);
  const project = preview ?? h.present,
    layer = project.layers.find((l) => l.id === selected),
    art = layer?.[side];
  const showPreview = !advanced || mode === 'preview';
  const showCanvas = !advanced || mode === 'edit';
  const shellState = (): FirstRunState => ({
    advanced,
    mirror: projectMirrored(h.present),
    chassisId,
    project: h.present,
  });
  function applyShell(next: FirstRunState) {
    if (next.project !== h.present) save(next.project);
    if (next.chassisId !== chassisId) setChassisId(next.chassisId);
  }
  useEffect(() => {
    let active = true;
    const persistence = new DraftPersistence(
      {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      },
      STORE,
      {
        onStatus: (status) => {
          if (active) setSaveStatus(status);
        },
      },
    );
    draft.current = persistence;
    const detach = persistence.attachLifecycle(
      window,
      document,
      () => document.visibilityState === 'hidden',
    );
    const timer = setTimeout(() => {
      try {
        const saved = persistence.restore();
        if (saved) setH(history(saved));
      } catch {
        setSaveStatus('blocked');
      }
      setHydrated(true);
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      detach();
      persistence.dispose();
      if (draft.current === persistence) draft.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (hydrated) draft.current?.schedule(h.present);
  }, [h.present, hydrated]);
  function save(p: Project): boolean {
    try {
      parseProject(JSON.stringify(p));
      setH((old) => commit(old, p));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : '保存失败，请减少图层或图片大小',
      );
      return false;
    }
    setPreview(null);
    return true;
  }
  function cancel() {
    gesture.current = null;
    mousePan.current = null;
    pinchObject.current = null;
    setPreview(null);
    setLine([]);
  }
  function chooseSide(next: Side) {
    cancel();
    setSide(next);
    setTool('select');
  }
  function lookOtherSide() {
    const next: Side = side === 'entry' ? 'driver' : 'entry';
    cancel();
    setSide(next);
    scene.current?.setView(next);
  }
  function toggleAdvancedOpen() {
    cancel();
    if (advanced) {
      setTool('select');
      setMessage((current) => (isDrawingFailure(current) ? '' : current));
      setAdvanced(false);
      return;
    }
    setMode('edit');
    setAdvanced(true);
  }
  function chooseTool(next: Tool) {
    cancel();
    setTool(next);
    if (next === 'region' || next === 'stroke') setSelected('');
    board.current?.parentElement?.focus();
  }
  function updateArt(changes: Partial<Art>) {
    if (
      layer &&
      (!art?.locked || Object.keys(changes).every((key) => key === 'locked'))
    )
      save(editLayer(h.present, layer.id, side, changes));
  }
  function insert(kind: Art['kind'], patch: Partial<Art> = {}) {
    try {
      let item = newLayer(kind, freshId());
      item = { ...item, entry: { ...item.entry!, color, ...patch } };
      if (!save(addLayer(h.present, item, side, linked))) return;
      setSelected(item.id);
      setTool('select');
      setMessage('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '添加失败');
    }
  }
  function point(e: ReactPointerEvent<SVGSVGElement>): Point {
    const svg = board.current!,
      matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: clamp(p.x / 1000), y: clamp(p.y / 400) };
  }
  function onDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.parentElement?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) {
      const selectedArt = h.present.layers.find((l) => l.id === selected)?.[
        side
      ];
      cancel();
      multi.current = true;
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (tool === 'select' && selected && selectedArt && !selectedArt.locked) {
        pinch.current = null;
        pinchObject.current = {
          distance,
          art: selectedArt,
          layer: selected,
        };
      } else {
        pinchObject.current = null;
        pinch.current = {
          distance,
          zoom,
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          pan,
        };
      }
      return;
    }
    multi.current = false;
    if (tool === 'pan' || e.button === 1) {
      e.preventDefault();
      mousePan.current = { x: e.clientX, y: e.clientY, pan };
      return;
    }
    const target = e.target as Element,
      id = target.closest('[data-layer]')?.getAttribute('data-layer') ?? '';
    const nodeAttr = target.closest('[data-node]')?.getAttribute('data-node');
    const nodeIndex =
      nodeAttr === undefined || nodeAttr === null ? null : Number(nodeAttr);
    const value = h.present.layers.find((l) => l.id === id)?.[side] ?? null;
    const edgeDrag =
      !advanced &&
      nodeIndex !== null &&
      !!art &&
      art.kind === 'region' &&
      art.rotation === 0 &&
      !art.locked;
    if (tool === 'select' && !edgeDrag) {
      setSelected(id);
      if (!value || value.locked) return;
    }
    if (tool === 'nodes' && (nodeIndex === null || !art || art.locked)) return;
    const start = point(e);
    const nodeMode = tool === 'nodes' || edgeDrag;
    gesture.current = {
      id: e.pointerId,
      start,
      base: h.present,
      art: nodeMode ? (art ?? null) : value,
      layer: nodeMode ? selected : id,
      points: [start],
      node: nodeIndex,
    };
    if (tool === 'region' || tool === 'stroke') setLine([start]);
  }
  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (multi.current) {
      const [a, b] = [...pointers.current.values()];
      const object = pinchObject.current;
      if (a && b && object) {
        const ratio =
          Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, object.distance);
        setPreview(
          editLayer(h.present, object.layer, side, {
            w: clamp(object.art.w * ratio, 0.02, 1.5),
            h: clamp(object.art.h * ratio, 0.02, 1.5),
          }),
        );
        return;
      }
      const start = pinch.current;
      if (a && b && start) {
        setZoom(
          clamp(
            (start.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
              Math.max(1, start.distance),
            1,
            5,
          ),
        );
        const r = board.current!.getBoundingClientRect();
        setPan({
          x: clamp(
            start.pan.x -
              (((a.x + b.x) / 2 - start.center.x) * 1000) /
                r.width /
                start.zoom,
            -500,
            500,
          ),
          y: clamp(
            start.pan.y -
              (((a.y + b.y) / 2 - start.center.y) * 400) /
                r.height /
                start.zoom,
            -200,
            200,
          ),
        });
      }
      return;
    }
    const drag = mousePan.current;
    if (drag) {
      const r = board.current!.getBoundingClientRect();
      setPan({
        x: clamp(
          drag.pan.x - ((e.clientX - drag.x) * 1000) / r.width / zoom,
          -500,
          500,
        ),
        y: clamp(
          drag.pan.y - ((e.clientY - drag.y) * 400) / r.height / zoom,
          -200,
          200,
        ),
      });
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const p = point(e);
    const draggingNode =
      g.node !== null &&
      !!g.art &&
      (tool === 'nodes' || (!advanced && g.art.kind === 'region'));
    if (tool === 'select' && g.art && !draggingNode)
      setPreview(
        editLayer(g.base, g.layer, side, {
          x: clamp(g.art.x + p.x - g.start.x, -0.9, 1),
          y: clamp(g.art.y + p.y - g.start.y, -0.9, 1),
        }),
      );
    if (draggingNode && g.art && g.node !== null) {
      const points = g.art.points.map((q, i) =>
        i === g.node
          ? {
              x: clamp((p.x - g.art!.x) / g.art!.w),
              y: clamp((p.y - g.art!.y) / g.art!.h),
            }
          : q,
      );
      setPreview(editLayer(g.base, g.layer, side, { points }));
    }
    if (tool === 'region' || tool === 'stroke') {
      if (
        g.points.length < 1800 &&
        Math.hypot(p.x - g.points.at(-1)!.x, p.y - g.points.at(-1)!.y) > 0.002
      ) {
        g.points.push(p);
        setLine([...g.points]);
      }
    }
  }
  function onUp(e: ReactPointerEvent<SVGSVGElement>) {
    mousePan.current = null;
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (multi.current) {
      if (!pointers.current.size) {
        multi.current = false;
        pinch.current = null;
        if (pinchObject.current) {
          pinchObject.current = null;
          if (preview) save(preview);
        }
      }
      return;
    }
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (tool === 'select' || tool === 'nodes') {
      if (preview) save(preview);
      return;
    }
    try {
      const pts =
        tool === 'region' ? regionPoints(g.points, region) : tidy(g.points);
      if (pts.length < 2) throw new Error('请画一条线');
      if (pts.length > 512) throw new Error('这条线太复杂，请分成几笔');
      insert(tool === 'region' ? 'region' : 'stroke', {
        points: pts,
        dashed: tool === 'stroke' && dashed,
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '请重新画线');
    }
    setLine([]);
  }
  async function importFile(file: File | undefined, image = false) {
    if (!file) return;
    try {
      if (image) {
        if (
          file.size > 1_400_000 ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
        )
          throw new Error('请使用小于 1.4 MB 的 PNG、JPG 或 WebP');
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () =>
            typeof r.result === 'string'
              ? resolve(r.result)
              : reject(new Error('图片格式无效'));
          r.onerror = () => reject(new Error('图片读取失败'));
          r.readAsDataURL(file);
        });
        insert('image', { src: data });
      } else {
        if (file.size > 8_000_000) throw new Error('草稿超过 8 MB');
        const imported = parseProject(await file.text());
        if (!save(imported)) return;
        draft.current?.replace(imported);
        setSelected('');
        setMessage('已导入，可撤销恢复之前的设计');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '导入失败');
    }
  }
  const handleKey = useEffectEvent((e: KeyboardEvent) => {
    if (!showCanvas || e.defaultPrevented) return;
    if (!(e.target instanceof Element) || !e.target.closest('.wrap-workspace'))
      return;

    const typing =
      (e.target as HTMLElement).closest(
        'input,textarea,select,[contenteditable="true"]',
      ) !== null;
    const action = shortcut(e.key, e.ctrlKey || e.metaKey, e.shiftKey, typing);
    if (!action) return;
    if (action === 'cancel') {
      cancel();
      setTool('select');
      setSelected('');
    } else if (action === 'undo') {
      cancel();
      setH(undo);
    } else if (action === 'redo') {
      cancel();
      setH(redo);
    } else if (action === 'delete' && art && !art.locked) {
      save(removeLayer(h.present, selected, side));
      setSelected('');
    } else if (action.startsWith('Arrow') && art && !art.locked) {
      const d = e.shiftKey ? 0.01 : 0.002;
      updateArt({
        x: clamp(
          art.x +
            (action === 'ArrowRight' ? d : action === 'ArrowLeft' ? -d : 0),
          -1,
          2,
        ),
        y: clamp(
          art.y + (action === 'ArrowDown' ? d : action === 'ArrowUp' ? -d : 0),
          -1,
          2,
        ),
      });
    } else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return (
    <div
      className={`wrap-workspace ${advanced ? 'is-advanced' : 'is-first-run'}`}
      role="application"
      aria-label="车身贴画编辑器"
      data-first-run={advanced ? 'advanced' : 'simple'}
      data-mirror={projectMirrored(project) ? 'on' : 'off'}
      data-layers={project.layers.length}
      data-chassis={chassisId}
    >
      <header className="wrap-header">
        <Link href="/" aria-label="返回首页">
          <ArrowLeft size={18} />
        </Link>
        <Link href="/" className="wrap-brand">
          MXGARAGE
        </Link>
        <span className="wrap-file">自由贴画</span>
        <div className="wrap-header-actions">
          {
            <IconButton
              label={'撤销'}
              onClick={() => {
                cancel();
                setH(undo);
              }}
              icon={<Undo2 size={18} />}
              disabled={!h.past.length}
            />
          }
          {
            <IconButton
              label={'重做'}
              onClick={() => {
                cancel();
                setH(redo);
              }}
              icon={<Redo2 size={18} />}
              disabled={!h.future.length}
            />
          }
          {advanced && (
            <button
              onClick={() => {
                cancel();
                setMode(mode === 'edit' ? 'preview' : 'edit');
              }}
              className="wrap-primary"
            >
              <Box size={17} />
              {mode === 'edit' ? '3D 预览' : '返回编辑'}
            </button>
          )}
          <button
            type="button"
            className="wrap-advanced-toggle"
            aria-pressed={advanced}
            onClick={toggleAdvancedOpen}
          >
            高级
          </button>
        </div>
      </header>
      <div className="wrap-layout">
        {advanced && (
        <nav className="wrap-tools" id="wrap-advanced-tools" aria-label="创作工具">
          <button
            aria-pressed={tool === 'select'}
            onClick={() => chooseTool('select')}
          >
            <MousePointer2 />
            <span>选择</span>
          </button>
          <button
            aria-pressed={tool === 'region'}
            onClick={() => {
              setMode('edit');
              chooseTool('region');
            }}
          >
            <Palette />
            <span>范围</span>
          </button>
          <button onClick={() => insert('text')}>
            <Type />
            <span>文字</span>
          </button>
          <button
            aria-pressed={tool === 'stroke'}
            onClick={() => {
              setMode('edit');
              chooseTool('stroke');
            }}
          >
            <PenLine />
            <span>涂鸦</span>
          </button>
          <label className="wrap-tool-upload" title="添加图片">
            <ImagePlus />
            <span>图片</span>
            <input
              aria-label="添加图片"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                void importFile(e.target.files?.[0], true);
                e.target.value = '';
              }}
            />
          </label>
          <button
            aria-pressed={tool === 'pan'}
            onClick={() => chooseTool('pan')}
          >
            <Hand />
            <span>平移</span>
          </button>
          <button
            aria-expanded={layerPanel}
            onClick={() => setLayerPanel(!layerPanel)}
          >
            <Layers />
            <span>图层</span>
          </button>
        </nav>
        )}
        <section className="wrap-stage">
          <div className="wrap-stagebar">
            {advanced && (
            <div className="wrap-segment" aria-label="车身侧面">
              <button
                aria-pressed={side === 'entry'}
                onClick={() => chooseSide('entry')}
              >
                入口侧
              </button>
              <button
                aria-pressed={side === 'driver'}
                onClick={() => chooseSide('driver')}
              >
                另一侧
              </button>
            </div>
            )}
            <span className="wrap-save-state">
              {
                {
                  loading: '正在恢复草稿',
                  saved: '已保存到本机',
                  pending: '正在保存…',
                  error: '尚未保存',
                  blocked: '原草稿受保护',
                }[saveStatus]
              }
            </span>
          </div>
          {(saveStatus === 'error' || saveStatus === 'blocked') && (
            <output className="wrap-message" aria-live="polite">
              <span>
                {saveStatus === 'blocked'
                  ? '原草稿未能恢复，已保留原记录。请导入有效备份；当前编辑可下载保存。'
                  : '尚未保存到本机。请重试，或下载草稿保留进度。'}
              </span>
              {saveStatus === 'error' && (
                <button onClick={() => draft.current?.flush()}>重试保存</button>
              )}
            </output>
          )}
          {showCanvas && (
            <div className="wrap-canvas-shell">
              <button
                className="wrap-canvas-focus"
                aria-label="贴画画布；方向键移动，Delete 删除，Esc 取消"
                type="button"
              >
                <svg
                  ref={board}
                  className="wrap-canvas"

                  aria-label={`车身贴画画布：${labels[tool]}，车头在左`}
                  preserveAspectRatio="none"
                  viewBox={`${500 - 500 / zoom + pan.x} ${200 - 200 / zoom + pan.y} ${1000 / zoom} ${400 / zoom}`}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={(e) => {
                    pointers.current.delete(e.pointerId);
                    cancel();
                  }}
                  onLostPointerCapture={(e) => {
                    pointers.current.delete(e.pointerId);
                    if (gesture.current?.id === e.pointerId) cancel();
                  }}
                  onWheel={(e) => {
                    setZoom((z) => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 1, 5));
                  }}
                >
                  <defs>
                    <mask
                      id="side-guide"
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="1000"
                      height="400"
                    >
                      <image
                        href={guides[side].mask}
                        width="1000"
                        height="400"
                      />
                    </mask>
                  </defs>
                  <image
                    href={guides[side].image}
                    width="1000"
                    height="400"
                    pointerEvents="none"
                  />
                  <g mask="url(#side-guide)">
                    <rect width="1000" height="400" fill={project.background} />
                    {project.layers.map(
                      (l) =>
                        l[side]?.visible && (
                          <g
                            key={l.id}
                            data-layer={l.id}
                            dangerouslySetInnerHTML={{
                              __html: artMarkup(l[side]!),
                            }}
                          />
                        ),
                    )}
                  </g>
                  {art && art.visible && (
                    <rect
                      pointerEvents="none"
                      x={art.x * 1000}
                      y={art.y * 400}
                      width={art.w * 1000}
                      height={art.h * 400}
                      fill="none"
                      stroke="#286d48"
                      strokeWidth={2 / zoom}
                      strokeDasharray="5 4"
                      transform={`rotate(${art.rotation} ${(art.x + art.w / 2) * 1000} ${(art.y + art.h / 2) * 400})`}
                    />
                  )}
                  {(tool === 'nodes' ||
                    (!advanced &&
                      art?.kind === 'region' &&
                      art.rotation === 0)) &&
                    art &&
                    art.points.map((p, i) => (
                      <circle
                        key={i}
                        data-node={i}
                        cx={(art.x + p.x * art.w) * 1000}
                        cy={(art.y + p.y * art.h) * 400}
                        r={9 / zoom}
                        fill="white"
                        stroke="#286d48"
                        strokeWidth="2"
                      />
                    ))}
                  {line.length > 0 && (
                    <path
                      d={pathData(line)}
                      fill="none"
                      stroke={color}
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              </button>
              <div className="wrap-canvas-foot">
                {advanced && <span>侧面贴画展开图 · 门窗区域保留</span>}
                <div>
                  {
                    <IconButton
                      label={'缩小'}
                      onClick={() => setZoom((z) => clamp(z / 1.2, 1, 5))}
                      icon={<Minus size={16} />}
                    />
                  }
                  <span>{Math.round(zoom * 100)}%</span>
                  {
                    <IconButton
                      label={'放大'}
                      onClick={() => setZoom((z) => clamp(z * 1.2, 1, 5))}
                      icon={<Plus size={16} />}
                    />
                  }
                  {
                    <IconButton
                      label={'适合画布'}
                      onClick={() => {
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                      icon={<RotateCcw size={16} />}
                    />
                  }
                </div>
              </div>
            </div>
          )}
          {showPreview && (
            <div className="wrap-preview">
              <VehicleScene
                ref={scene}
                design={h.present}
                lang="zh"
                presentation="render"
                palette={null}
                generating={false}
                onCommit={() => {}}
                parts={parts}
                wipers={false}
                environment="studio"
                onPick={(id) => setParts((p) => ({ ...p, [id]: !p[id] }))}
                onReady={() => scene.current?.setView(side)}
              />
              <div className="wrap-preview-views">
                {advanced ? (
                  <>
                    {[
                      ['entry', '入口正侧面'],
                      ['driver', '另一侧'],
                      ['hero', '立体'],
                      ['front', '正面'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => scene.current?.setView(id)}
                      >
                        {label}
                      </button>
                    ))}
                    <button onClick={() => setParts({})}>关合部件</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={lookOtherSide}>
                      看另一侧
                    </button>
                    <button
                      type="button"
                      onClick={() => scene.current?.setView('hero')}
                    >
                      转转车子
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {message && (advanced || !isDrawingFailure(message)) && (
            <output className="wrap-message">
              {message}
              <button aria-label="关闭提示" onClick={() => setMessage('')}>
                ×
              </button>
            </output>
          )}
        </section>
        <aside className="wrap-inspector">
          <FirstRunShell
            shopName={shopNameOf(h.present)}
            mirror={projectMirrored(h.present)}
            chassisId={chassisId}
            density={advanced ? 'compact' : 'full'}
            onShopName={(name) => applyShell(setShopName(shellState(), name))}
            onChassis={(id) => applyShell(switchChassis(shellState(), id))}
            onIcon={(icon) => applyShell(setMarkIcon(shellState(), icon))}
            onIconColor={(next) => applyShell(setMarkColor(shellState(), next))}
          />
          {advanced && (
          <>
          <h1>{art ? layer!.name : '设计你的车身'}</h1>
          {(tool === 'region' || tool === 'stroke') && (
            <div className="wrap-section">
              <p>
                {tool === 'region'
                  ? '画一条边界，自动整理后填色'
                  : '一笔画出涂鸦，松手整理线条'}
              </p>
              {tool === 'region' ? (
                <label>
                  填充范围
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value as typeof region)}
                  >
                    <option value="below">边界下方</option>
                    <option value="above">边界上方</option>
                    <option value="closed">圈选范围</option>
                  </select>
                </label>
              ) : (
                <label>
                  <input
                    type="checkbox"
                    checked={dashed}
                    onChange={(e) => setDashed(e.target.checked)}
                  />
                  虚线
                </label>
              )}
            </div>
          )}
          <div className="wrap-section">
            <label>
              颜色
              <input
                aria-label="对象颜色"
                type="color"
                value={art?.color ?? color}
                onChange={(e) => {
                  setColor(e.target.value);
                  if (art) updateArt({ color: e.target.value });
                }}
              />
            </label>
            <div className="wrap-swatches">
              {[
                '#8aafa1',
                '#f3eedf',
                '#17201c',
                '#bd7453',
                '#faf9f4',
                '#dfbb4d',
              ].map((c) => (
                <button
                  key={c}
                  style={{ background: c }}
                  aria-label={`颜色 ${c}`}
                  onClick={() => {
                    setColor(c);
                    if (art) updateArt({ color: c });
                  }}
                />
              ))}
            </div>
            {art ? (
              <button
                className="wrap-link-control"
                disabled={art.locked}
                onClick={() =>
                  save(setLinked(h.present, selected, side, !layer!.linked))
                }
              >
                {layer!.linked ? <Link2 size={17} /> : <Unlink size={17} />}{' '}
                {layer!.linked
                  ? '双侧关联 · 点击只改此侧'
                  : '此侧独立 · 点击用此侧同步两侧'}
              </button>
            ) : (
              <label>
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={(e) => setDefaultLinked(e.target.checked)}
                />
                新增内容默认双侧同步
              </label>
            )}
          </div>
          {art && (
            <div className="wrap-section">
              {art.kind === 'text' && (
                <>
                  <label>
                    文字
                    <input
                      aria-label="招牌文字"
                      value={art.text}
                      maxLength={200}
                      onChange={(e) => updateArt({ text: e.target.value })}
                    />
                  </label>
                  <label>
                    字体
                    <select
                      value={art.font}
                      onChange={(e) =>
                        updateArt({ font: e.target.value as Art['font'] })
                      }
                    >
                      <option value="hand">手写</option>
                      <option value="sans">简洁</option>
                    </select>
                  </label>
                </>
              )}
              <label>
                宽度
                <input
                  aria-label="对象宽度"
                  type="range"
                  min="0.02"
                  max="1"
                  step=".01"
                  value={art.w}
                  onChange={(e) => updateArt({ w: Number(e.target.value) })}
                />
              </label>
              <label>
                高度
                <input
                  aria-label="对象高度"
                  type="range"
                  min="0.02"
                  max="1"
                  step=".01"
                  value={art.h}
                  onChange={(e) => updateArt({ h: Number(e.target.value) })}
                />
              </label>
              <label>
                旋转
                <input
                  aria-label="对象旋转"
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={art.rotation}
                  onChange={(e) =>
                    updateArt({ rotation: Number(e.target.value) })
                  }
                />
                <span>{art.rotation}°</span>
              </label>
              {art.kind === 'stroke' && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={art.dashed}
                      onChange={(e) => updateArt({ dashed: e.target.checked })}
                    />
                    虚线
                  </label>
                  <label>
                    线宽
                    <input
                      aria-label="线宽"
                      type="range"
                      min=".002"
                      max=".035"
                      step=".001"
                      value={art.thickness}
                      onChange={(e) =>
                        updateArt({ thickness: Number(e.target.value) })
                      }
                    />
                  </label>
                </>
              )}
              {(art.kind === 'stroke' || art.kind === 'region') && (
                <button
                  disabled={art.rotation !== 0 || art.locked}
                  onClick={() =>
                    chooseTool(tool === 'nodes' ? 'select' : 'nodes')
                  }
                >
                  {tool === 'nodes' ? '完成节点调整' : '调整节点'}
                </button>
              )}
              <div className="wrap-object-actions">
                {
                  <IconButton
                    label={'复制对象'}
                    onClick={() => {
                      const l = structuredClone(layer!);
                      l.id = freshId();
                      l.entry = structuredClone(art);
                      try {
                        if (save(addLayer(h.present, l, side, l.linked)))
                          setSelected(l.id);
                      } catch (e) {
                        setMessage(e instanceof Error ? e.message : '复制失败');
                      }
                    }}
                    icon={<Copy size={17} />}
                  />
                }
                {
                  <IconButton
                    label={art.locked ? '解锁' : '锁定'}
                    onClick={() => updateArt({ locked: !art.locked })}
                    icon={<LockKeyhole size={17} />}
                  />
                }
                {
                  <IconButton
                    label={art.visible ? '隐藏' : '显示'}
                    onClick={() => updateArt({ visible: !art.visible })}
                    icon={
                      art.visible ? <Eye size={17} /> : <EyeOff size={17} />
                    }
                  />
                }
                {
                  <IconButton
                    label={'删除对象'}
                    onClick={() => {
                      save(removeLayer(h.present, selected, side));
                      setSelected('');
                    }}
                    icon={<Trash2 size={17} />}
                    disabled={art.locked}
                  />
                }
              </div>
              <fieldset className="wrap-order" disabled={art.locked}>
                <button
                  onClick={() => {
                    const ls = h.present.layers.filter(
                      (l) => l.id !== selected,
                    );
                    save({ ...h.present, layers: [...ls, layer!] });
                  }}
                >
                  置顶
                </button>
                <button
                  onClick={() => {
                    const ls = h.present.layers.filter(
                      (l) => l.id !== selected,
                    );
                    save({ ...h.present, layers: [layer!, ...ls] });
                  }}
                >
                  置底
                </button>
              </fieldset>
            </div>
          )}
          <div className="wrap-section">
            <h2>添加图案</h2>
            <div className="wrap-assets">
              {[
                ['cup', '咖啡杯'],
                ['runner', '剪影'],
                ['badge', '小标志'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() =>
                    insert('icon', { icon: id as Art['icon'], w: 0.1, h: 0.18 })
                  }
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() =>
                  insert('region', {
                    points: [
                      { x: 0.3, y: 0.24 },
                      { x: 0.69, y: 0.24 },
                      { x: 0.69, y: 0.48 },
                      { x: 0.3, y: 0.48 },
                    ],
                    color: '#17201c',
                  })
                }
              >
                招牌底色
              </button>
              <button
                onClick={() =>
                  insert('stroke', {
                    points: [
                      { x: 0.31, y: 0.77 },
                      { x: 0.73, y: 0.77 },
                    ],
                    thickness: 0.014,
                    dashed: false,
                    color: '#17201c',
                  })
                }
              >
                条纹
              </button>
            </div>
          </div>
          <div className={`wrap-layer-list ${layerPanel ? 'is-open' : ''}`}>
            <h2>图层 · {project.layers.length}</h2>
            {[...project.layers].reverse().map((l) => (
              <button
                key={l.id}
                className={l.id === selected ? 'selected' : ''}
                onClick={() => {
                  cancel();
                  setSelected(l.id);
                  setTool('select');
                  if (!l[side]) setSide(side === 'entry' ? 'driver' : 'entry');
                }}
              >
                <span>
                  {l[side]?.visible === false ? '○' : '●'} {l.name}{' '}
                  {l[side]?.kind === 'text' ? l[side]?.text : ''}
                </span>
                {l.linked ? <Link2 size={14} /> : <Unlink size={14} />}
              </button>
            ))}
          </div>
          <footer className="wrap-files">
            <button
              onClick={() =>
                download(JSON.stringify(h.present, null, 2), '车身贴画.json')
              }
            >
              <Download size={16} />
              下载草稿
            </button>
            <label>
              <Upload size={16} />
              导入草稿
              <input
                aria-label="导入草稿"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  void importFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              onClick={() =>
                download(
                  svgDocument(h.present, side),
                  '侧面贴画.svg',
                  'image/svg+xml',
                )
              }
            >
              导出图案 SVG
            </button>
          </footer>
          </>
          )}
        </aside>
      </div>
    </div>
  );
}
