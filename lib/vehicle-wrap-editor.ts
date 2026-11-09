import * as THREE from 'three';
import { svgDocument, type Project } from './free-wrap.ts';
import { findFrontWrapTransitions } from './wrap-eligibility.ts';
import { PALETTE_PARTITION, type VehiclePalette } from './vehicle-palettes.ts';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  circumference,
  constrainDecal,
  decalHit,
  perimeterCoordinate,
  wrappedDelta,
  type DecalPlacement,
  type WrapBody,
} from './wrap-layout.ts';

/** Editor hints travel as codes; the React layer localizes them via lib/i18n. */
export type WrapHintCode = 'default' | 'move' | 'scale';
export type WrapEditState = {
  visible: boolean;
  locked: boolean;
  contextMenu: { x: number; y: number } | null;
  x: number;
  y: number;
  scale: number;
  dragging: boolean;
  hintCode: WrapHintCode;
  /** Live snapshot for plan insights (coverage / price); updated on every emit. */
  placements?: DecalPlacement[];
  aspect?: number;
  body?: WrapBody;
};
type Anchor = {
  mesh: THREE.Mesh;
  triangle: THREE.Triangle;
  chart: THREE.Vector2[];
  point: THREE.Vector3;
};
type SurfaceHit = { s: number; h: number; anchor: Anchor };
type BoundaryPoint = {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  normal: THREE.Vector3;
};
const hidden: WrapEditState = {
  visible: false,
  locked: false,
  contextMenu: null,
  x: 0,
  y: 0,
  scale: 1,
  dragging: false,
  hintCode: 'default',
};
type EntryDoorSpan = { s0: number; s1: number; h0: number; h1: number };
/** One gap, in metres, applied only when choosing the rear slot. */
const ENTRY_DOOR_CLEARANCE_M = 0.05;
/** Matches constrainDecal's floor. A smaller request is an explicit miss. */
const MIN_DECAL_SCALE = 0.25;
const DECAL_BASE_WIDTH_M = 3.5;

/** Direct editing uses the same closed-pose surface chart as the rendered ink. */
export class VehicleWrapEditor {
  private designEpoch = 0;
  private designTextures: THREE.Texture[] = [];
  placements: DecalPlacement[];
  private body: WrapBody;
  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private root: THREE.Group;
  private camera: THREE.Camera;
  private controls: OrbitControls;
  private change: (state: WrapEditState) => void;
  private takeCamera: () => void;
  private surfaces: THREE.Mesh[] = [];
  private replaced: THREE.BufferGeometry[] = [];
  private ray = new THREE.Raycaster();
  private texture: THREE.Texture | null = null;
  private aspect = 3;
  private enabled = true;
  private locked = false;
  private contextMenu: WrapEditState['contextMenu'] = null;
  private selected = false;
  private hovered = false;
  private active = 0;
  private lastAnchor: SurfaceHit | null = null;
  private points: BoundaryPoint[] = [];
  private state = hidden;
  private lastEmit = 0;
  private boundaryDirty = true;
  private lastHover = 0;
  private hintCode: WrapHintCode = 'default';
  private drag: {
    mode: 'move' | 'scale';
    planeOnly: boolean;
    id: number;
    x: number;
    y: number;
    start: DecalPlacement;
    entryAdjusted: boolean;
    hit: SurfaceHit | null;
    target: Element | null;
  } | null = null;
  /** Closed-pose chart span. Later image changes must not remeasure a posed door. */
  private entryDoorSpan: EntryDoorSpan | null = null;
  private entryDoorClear = false;
  private entryAdjusted = false;
  private uniforms: { [key: string]: { value: unknown } };
  constructor(options: {
    root: THREE.Group;
    camera: THREE.Camera;
    controls: OrbitControls;
    host: HTMLElement;
    body: WrapBody;
    reveal: { value: number };
    onChange: (state: WrapEditState) => void;
    takeCamera: () => void;
  }) {
    this.root = options.root;
    this.camera = options.camera;
    this.controls = options.controls;
    this.host = options.host;
    this.canvas = this.controls.domElement as HTMLCanvasElement;
    this.body = options.body;
    this.change = options.onChange;
    this.takeCamera = options.takeCamera;
    this.placements = this.defaults();
    this.uniforms = {
      uPaletteEnabled: { value: 0 },
      uPaletteWhite: { value: new THREE.Color() },
      uPaletteAccent: { value: new THREE.Color() },
      uPaletteTrim: { value: new THREE.Color() },
      uPaletteBand: {
        value: new THREE.Vector2(
          PALETTE_PARTITION.accentTop,
          PALETTE_PARTITION.trimTop,
        ),
      },
      uDesignEntry: { value: null },
      uDesignDriver: { value: null },
      uHasDesign: { value: 0 },
      uDesignSize: {
        value: new THREE.Vector3(
          this.body.length,
          this.body.width,
          this.body.height,
        ),
      },
      uDecalMap: { value: null },
      uHasDecal: { value: 0 },
      uDecalAspect: { value: 3 },
      uDecalPeriod: { value: circumference(this.body) },
      uDecalPlacements: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uDecalActive: { value: -1 },
      uAntTime: { value: 0 },
      uWrapReveal: options.reveal,
    };
    this.root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    const transitions = findFrontWrapTransitions(meshes);
    const bounds = new THREE.Box3();
    for (const mesh of meshes)
      if (mesh.name.startsWith('RV_Static_Wrap_'))
        bounds.expandByObject(mesh, true);
    if (!bounds.isEmpty())
      this.body = { ...this.body, centerZ: (bounds.min.z + bounds.max.z) / 2 };
    this.cacheEntryDoor(meshes);
    const materials = new Set<THREE.MeshStandardMaterial>();
    for (const o of meshes) {
      const wrap = [o.material].flat().every((m) => m.name.startsWith('Wrap_'));
      const mask = transitions.get(o);
      if (!wrap && !mask?.some(Boolean)) continue;
      if (!wrap)
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => m.clone())
          : o.material.clone();
      this.surfaces.push(o);
      if (o.geometry.index) {
        this.replaced.push(o.geometry);
        o.geometry = o.geometry.toNonIndexed();
      }
      const position = o.geometry.getAttribute('position'),
        coords = new Float32Array(position.count * 2);
      const world = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        world.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
        coords[i * 2] = perimeterCoordinate(world.x, world.z, this.body);
        coords[i * 2 + 1] = world.y;
      }
      // Lift seam-crossing triangles into one local period before interpolation.
      const period = circumference(this.body);
      for (let i = 0; i < position.count; i += 3) {
        const ss = [coords[i * 2], coords[(i + 1) * 2], coords[(i + 2) * 2]];
        if (Math.max(...ss) - Math.min(...ss) > period / 2)
          for (let j = 0; j < 3; j++)
            if (coords[(i + j) * 2] < period / 2) coords[(i + j) * 2] += period;
      }
      o.geometry.setAttribute(
        'aWrapCoord',
        new THREE.BufferAttribute(coords, 2),
      );
      const eligibility = Float32Array.from(
        { length: position.count },
        (_, i) => (wrap ? 1 : mask![Math.floor(i / 3)]),
      );
      o.geometry.setAttribute(
        'aWrapEligible',
        new THREE.BufferAttribute(eligibility, 1),
      );
      for (const m of [o.material].flat())
        if (m instanceof THREE.MeshStandardMaterial) materials.add(m);
    }
    for (const material of materials) {
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader =
          'attribute vec2 aWrapCoord; attribute float aWrapEligible; varying vec2 vWrapCoord; varying float vWrapEligible;\n' +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWrapCoord = aWrapCoord; vWrapEligible = aWrapEligible;',
        );
        shader.fragmentShader =
          `varying vec2 vWrapCoord; varying float vWrapEligible;
          uniform sampler2D uDecalMap; uniform float uHasDecal, uDecalAspect, uDecalPeriod, uDecalActive, uAntTime, uWrapReveal;
          uniform float uPaletteEnabled;
          uniform sampler2D uDesignEntry, uDesignDriver;
          uniform float uHasDesign; uniform vec3 uDesignSize;
          uniform vec3 uPaletteWhite, uPaletteAccent, uPaletteTrim;
          uniform vec2 uPaletteBand;
          uniform vec3 uDecalPlacements[2];\n` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if(uPaletteEnabled > .5 && vWrapEligible > .5) {
            float edge=max(fwidth(vWrapCoord.y),.0001);
            vec3 paletteColor=mix(uPaletteAccent,uPaletteTrim,smoothstep(uPaletteBand.x-edge,uPaletteBand.x+edge,vWrapCoord.y));
            paletteColor=mix(paletteColor,uPaletteWhite,smoothstep(uPaletteBand.y-edge,uPaletteBand.y+edge,vWrapCoord.y));
            diffuseColor.rgb=paletteColor;
          }
          if(uHasDesign > .5 && vWrapEligible > .5) {
            float s=mod(vWrapCoord.x,uDecalPeriod);
            float y=1.-vWrapCoord.y/uDesignSize.z;
            if(y>=0. && y<=1.) {
              if(s<=uDesignSize.x) {
                vec4 ink=texture2D(uDesignEntry,vec2(s/uDesignSize.x,y));
                diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,ink.a);
              } else if(s>=uDesignSize.x+uDesignSize.y && s<=2.*uDesignSize.x+uDesignSize.y) {
                vec4 ink=texture2D(uDesignDriver,vec2((s-uDesignSize.x-uDesignSize.y)/uDesignSize.x,y));
                diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,ink.a);
              }
            }
          }
          if(uHasDecal > .5 && vWrapEligible > .5) {
            for(int i=0;i<2;i++) {
              vec3 p=uDecalPlacements[i];
              vec2 delta=vec2(mod(vWrapCoord.x-p.x+uDecalPeriod*.5,uDecalPeriod)-uDecalPeriod*.5,vWrapCoord.y-p.y);
              vec2 size=vec2(3.5*p.z,3.5*p.z/uDecalAspect);
              vec2 uv=vec2(delta.x/size.x+.5,.5-delta.y/size.y);
              if(uv.x>=0. && uv.x<=1. && uv.y>=0. && uv.y<=1.) {
                vec4 decal=texture2D(uDecalMap,uv);
                float reveal=smoothstep(uv.x-.08,uv.x+.08,uWrapReveal*1.2-.1);
                diffuseColor.rgb=mix(diffuseColor.rgb,decal.rgb,decal.a*reveal);
              }
              if(abs(uDecalActive-float(i))<.1) {
                vec2 pixel=max(fwidth(delta),vec2(.0003));
                vec2 edge=(abs(delta)-size*.5)/pixel;
                float distanceToBorder=max(edge.x,edge.y);
                float border=1.-smoothstep(.7,1.7,abs(distanceToBorder));
                float along=edge.x>edge.y ? delta.y/pixel.y : delta.x/pixel.x;
                float dash=step(.5,fract(along/14.-uAntTime));
                diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(.018,.05,.037),vec3(1.),dash),border);
              }
            }
          }`,
        );
      };
      material.customProgramCacheKey = () =>
        'mxgarage-continuous-wrap-editor-v4-design';
      material.needsUpdate = true;
    }
    this.sync();
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.hover, true);
    this.canvas.addEventListener('pointerleave', this.leave);
    this.canvas.addEventListener('keydown', this.key, true);
    this.canvas.addEventListener('contextmenu', this.context, true);
    window.addEventListener('pointerdown', this.outside, true);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    window.addEventListener('blur', this.blur);
  }
  private defaults() {
    return [
      {
        center: this.body.length - (1 - this.body.xMin),
        height: 1.28,
        scale: 1,
      },
      {
        center: this.body.length + this.body.width + 1 - this.body.xMin,
        height: 1.28,
        scale: 1,
      },
    ];
  }
  /** Only update palette uniforms; keep the user's texture, placements and lock. */
  async setDesign(project: Project | null) {
    const epoch = ++this.designEpoch;
    if (!project) {
      this.uniforms.uHasDesign.value = 0;
      this.designTextures.forEach((t) => t.dispose());
      this.designTextures = [];
      return;
    }
    const textures = await Promise.all(
      (['entry', 'driver'] as const).map(
        (side) =>
          new Promise<THREE.Texture>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              const texture = new THREE.Texture(image);
              texture.flipY = false;
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.needsUpdate = true;
              resolve(texture);
            };
            image.onerror = () => reject(new Error('无法生成贴画预览'));
            image.src =
              'data:image/svg+xml;charset=utf-8,' +
              encodeURIComponent(svgDocument(project, side, true));
          }),
      ),
    );
    if (epoch !== this.designEpoch) {
      textures.forEach((t) => t.dispose());
      return;
    }
    this.designTextures.forEach((t) => t.dispose());
    this.designTextures = textures;
    this.uniforms.uDesignEntry.value = textures[0];
    this.uniforms.uDesignDriver.value = textures[1];
    this.uniforms.uHasDesign.value = 1;
  }
  setPalette(palette: VehiclePalette | null) {
    this.uniforms.uPaletteEnabled.value = palette ? 1 : 0;
    if (!palette) return;
    (this.uniforms.uPaletteWhite.value as THREE.Color).set(palette.white);
    (this.uniforms.uPaletteAccent.value as THREE.Color).set(palette.accent);
    (this.uniforms.uPaletteTrim.value as THREE.Color).set(palette.trim);
  }
  setImage(image: HTMLImageElement | null) {
    this.finish(false);
    this.contextMenu = null;
    this.texture?.dispose();
    this.texture = null;
    if (image) {
      this.aspect = image.naturalWidth / image.naturalHeight;
      if (!this.entryAdjusted) this.applyEntryDefault();
      this.texture = new THREE.Texture(image);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.flipY = false;
      this.texture.anisotropy = 8;
      this.texture.needsUpdate = true;
    } else {
      this.placements = this.defaults();
      this.entryAdjusted = false;
      this.entryDoorClear = false;
      this.selected = false;
      this.hovered = false;
      this.locked = false;
      this.lastAnchor = null;
    }
    this.uniforms.uDecalMap.value = this.texture;
    this.uniforms.uHasDecal.value = image ? 1 : 0;
    this.uniforms.uDecalAspect.value = this.aspect;
    this.sync();
    this.refreshBoundary();
    if (!image) this.emit(hidden);
    else
      // Keep sidebar insights in sync with the new image's aspect/placements
      // even before the user next hovers the decal.
      this.emit({
        ...this.state,
        scale: this.placements[this.active].scale,
      });
  }
  setEnabled(value: boolean) {
    if (this.enabled === value) return;
    this.enabled = value;
    if (!value) {
      this.finish(false);
      this.hovered = false;
      this.selected = false;
      this.contextMenu = null;
      this.uniforms.uDecalActive.value = -1;
      this.emit(hidden);
    }
  }
  getState() {
    return {
      placements: this.placements.map((p) => ({ ...p })),
      ...this.state,
      active: this.active,
      locked: this.locked,
      contextMenu: this.contextMenu,
      dragging: !!this.drag,
      entryDoorClear: this.entryDoorClear,
      entryAdjusted: this.entryAdjusted,
      entryDoorSpan: this.entryDoorSpan ? { ...this.entryDoorSpan } : null,
    };
  }
  private sync() {
    const values = this.uniforms.uDecalPlacements.value as THREE.Vector3[];
    this.placements = this.placements.map((p) =>
      constrainDecal(p, this.aspect, this.body),
    );
    this.placements.forEach((p, i) =>
      values[i].set(p.center, p.height, p.scale),
    );
  }
  private setRay(x: number, y: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        1 - ((y - rect.top) / rect.height) * 2,
      ),
      this.camera,
    );
  }
  private surfaceAt(x: number, y: number): SurfaceHit | null {
    this.setRay(x, y);
    const hit = this.ray
      .intersectObject(this.root, true)
      .find((h) => h.object instanceof THREE.Mesh);
    if (
      !hit ||
      !(hit.object instanceof THREE.Mesh) ||
      !this.surfaces.includes(hit.object) ||
      !hit.face
    )
      return null;
    if (
      hit.object.geometry.getAttribute('aWrapEligible').getX(hit.face.a) < 0.5
    )
      return null;
    const mesh = hit.object,
      pos = mesh.geometry.getAttribute('position'),
      coord = mesh.geometry.getAttribute('aWrapCoord');
    const ids = [hit.face.a, hit.face.b, hit.face.c];
    const pts = ids.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    const chart = ids.map((i) =>
      new THREE.Vector2().fromBufferAttribute(coord, i),
    );
    const triangle = new THREE.Triangle(pts[0], pts[1], pts[2]);
    const point = mesh.worldToLocal(hit.point.clone());
    return this.chartAt({ mesh, triangle, chart, point }, point);
  }
  private chartAt(anchor: Anchor, point: THREE.Vector3): SurfaceHit | null {
    const bary = anchor.triangle.getBarycoord(point, new THREE.Vector3());
    if (!bary) return null;
    const { chart } = anchor;
    return {
      s: chart[0].x * bary.x + chart[1].x * bary.y + chart[2].x * bary.z,
      h: chart[0].y * bary.x + chart[1].y * bary.y + chart[2].y * bary.z,
      anchor,
    };
  }
  private pickDecal(x: number, y: number) {
    const hit = this.surfaceAt(x, y);
    if (!hit) return null;
    const index = this.placements.findIndex((p) =>
      decalHit(hit.s, hit.h, p, this.aspect, circumference(this.body)),
    );
    return index < 0 ? null : { hit, index };
  }
  private down = (e: PointerEvent) => {
    if (!this.enabled || !this.texture) return;
    // Reserve right-click on ink for the menu, without starting OrbitControls pan.
    if (e.button === 2 && this.pickDecal(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.button !== 0 || this.locked) return;
    const hit = this.pickDecal(e.clientX, e.clientY);
    if (!hit) {
      this.selected = false;
      this.hovered = false;
      return;
    }
    this.active = hit.index;
    this.lastAnchor = hit.hit;
    this.selected = true;
    this.begin('move', e);
  };
  private hover = (e: PointerEvent) => {
    if (
      !this.enabled ||
      !this.texture ||
      this.locked ||
      this.contextMenu ||
      e.buttons ||
      this.drag
    )
      return;
    if (performance.now() - this.lastHover < 65) return;
    this.lastHover = performance.now();
    const hit = this.pickDecal(e.clientX, e.clientY);
    this.hovered = !!hit;
    if (hit) {
      if (this.active !== hit.index || !this.points.length) {
        this.active = hit.index;
        this.refreshBoundary();
      }
      this.lastAnchor = hit.hit;
      this.canvas.style.cursor = 'move';
      e.stopImmediatePropagation();
    }
  };
  private leave = () => {
    if (!this.drag) this.hovered = false;
  };
  keepVisible() {
    if (!this.locked) this.hovered = true;
  }
  setLocked(value: boolean) {
    if (!this.texture || !this.enabled) return;
    this.finish(false);
    this.locked = value;
    this.contextMenu = null;
    this.selected = !value;
    this.hovered = !value;
    this.uniforms.uDecalActive.value = value ? -1 : this.active;
    this.canvas.style.cursor = value ? 'grab' : 'move';
    this.canvas.focus({ preventScroll: true });
    this.refreshBoundary();
    if (value) this.emit(hidden);
    else {
      this.lastEmit = -Infinity;
      this.update(performance.now(), false);
    }
  }
  dismissMenu() {
    if (!this.contextMenu) return;
    this.contextMenu = null;
    this.emit(this.state);
  }
  private context = (e: MouseEvent) => {
    if (!this.enabled || !this.texture) return;
    const hit = this.pickDecal(e.clientX, e.clientY);
    if (!hit) {
      this.dismissMenu();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    this.active = hit.index;
    this.lastAnchor = hit.hit;
    this.selected = !this.locked;
    this.hovered = false;
    this.refreshBoundary();
    this.openMenu(e.clientX, e.clientY);
  };
  private openMenu(x: number, y: number) {
    const rect = this.host.getBoundingClientRect();
    this.contextMenu = {
      x: Math.max(12, Math.min(this.host.clientWidth - 168, x - rect.left)),
      y: Math.max(12, Math.min(this.host.clientHeight - 58, y - rect.top)),
    };
    this.emit(this.state);
  }
  private outside = (e: PointerEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest('[data-wrap-menu]'))
      this.dismissMenu();
  };
  private projectAnchor(anchor: Anchor, x: number, y: number) {
    this.setRay(x, y);
    const plane = new THREE.Plane().setFromCoplanarPoints(
      anchor.triangle.a.clone().applyMatrix4(anchor.mesh.matrixWorld),
      anchor.triangle.b.clone().applyMatrix4(anchor.mesh.matrixWorld),
      anchor.triangle.c.clone().applyMatrix4(anchor.mesh.matrixWorld),
    );
    const point = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    return point ? this.chartAt(anchor, anchor.mesh.worldToLocal(point)) : null;
  }
  begin(mode: 'move' | 'scale', e: PointerEvent) {
    if (!this.enabled || !this.texture || this.locked || this.drag) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    this.takeCamera();
    this.controls.enabled = false;
    this.selected = true;
    const planeOnly = e.target !== this.canvas;
    const startHit =
      planeOnly && this.lastAnchor
        ? this.projectAnchor(this.lastAnchor.anchor, e.clientX, e.clientY)
        : this.lastAnchor;
    this.drag = {
      mode,
      planeOnly,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: { ...this.placements[this.active] },
      entryAdjusted: this.entryAdjusted,
      hit: startHit,
      target: e.target instanceof Element ? e.target : null,
    };
    this.drag.target?.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = mode === 'move' ? 'grabbing' : 'nesw-resize';
    this.hintCode = mode === 'move' ? 'move' : 'scale';
    this.refreshBoundary();
  }
  private move = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault();
    const p = { ...drag.start };
    if (drag.mode === 'scale')
      p.scale *= Math.exp((e.clientX - drag.x - (e.clientY - drag.y)) * 0.006);
    else {
      let hit = drag.planeOnly ? null : this.surfaceAt(e.clientX, e.clientY);
      if (!hit && drag.hit) {
        hit = this.projectAnchor(drag.hit.anchor, e.clientX, e.clientY);
      }
      if (!hit || !drag.hit) return;
      const ds = wrappedDelta(hit.s, drag.hit.s, circumference(this.body));
      p.center += ds;
      p.height += hit.h - drag.hit.h;
    }
    this.placements[this.active] = constrainDecal(p, this.aspect, this.body);
    this.sync();
    this.refreshBoundary();
  };
  private up = (e: PointerEvent) => {
    if (e.pointerId === this.drag?.id) this.finish(false);
  };
  private cancel = (e: PointerEvent) => {
    if (e.pointerId === this.drag?.id) this.finish(true);
  };
  private blur = () => {
    this.finish(true);
    this.dismissMenu();
  };
  private finish(revert: boolean) {
    const drag = this.drag;
    if (!drag) return;
    if (revert) {
      this.placements[this.active] = drag.start;
      this.entryAdjusted = drag.entryAdjusted;
    } else if (
      this.active === 0 &&
      !this.sameDecal(this.placements[0], drag.start)
    )
      this.entryAdjusted = true;
    if (drag.target?.hasPointerCapture(drag.id))
      drag.target.releasePointerCapture(drag.id);
    this.drag = null;
    this.controls.enabled = true;
    this.canvas.style.cursor = 'grab';
    this.hintCode = 'default';
    this.sync();
    this.refreshBoundary();
  }
  scaleBy(factor: number) {
    if (!this.enabled || !this.texture || this.locked) return;
    this.selected = true;
    const active = this.active;
    const before = { ...this.placements[active] };
    this.placements[active].scale *= factor;
    this.sync();
    this.noteEntryEdit(active, before);
    this.refreshBoundary();
  }
  nudge(dx: number, dy: number) {
    if (!this.enabled || !this.texture || this.locked) return;
    const active = this.active;
    const before = { ...this.placements[active] };
    this.placements[active].center += dx;
    this.placements[active].height += dy;
    this.sync();
    this.noteEntryEdit(active, before);
    this.refreshBoundary();
  }
  reset() {
    if (!this.enabled || !this.texture || this.locked) return;
    this.entryAdjusted = false;
    const legacy = this.defaults();
    const entry = this.entryDefault(this.aspect);
    this.entryDoorClear = entry.clear;
    this.placements = [entry.placement, legacy[1]];
    this.sync();
    this.refreshBoundary();
  }
  private sameDecal(a: DecalPlacement, b: DecalPlacement) {
    return (
      a.center === b.center && a.height === b.height && a.scale === b.scale
    );
  }
  private noteEntryEdit(active: number, before: DecalPlacement) {
    if (active === 0 && !this.sameDecal(this.placements[0], before))
      this.entryAdjusted = true;
  }
  private cacheEntryDoor(meshes: THREE.Mesh[]) {
    const bounds = new THREE.Box3();
    for (const mesh of meshes)
      if (mesh.name.startsWith('RV_WebRig_EntryDoor_'))
        bounds.expandByObject(mesh, true);
    if (bounds.isEmpty()) {
      this.entryDoorSpan = null;
      return;
    }
    const projected = [bounds.min.x, bounds.max.x].flatMap((x) =>
      [bounds.min.z, bounds.max.z].map((z) => this.entryChartPoint(x, z)),
    );
    const ss = projected.map((p) => p.s);
    const s0 = Math.min(...ss);
    const s1 = Math.max(...ss);
    const period = circumference(this.body);
    const usable =
      projected.every((p) => p.entry) &&
      s1 - s0 < period / 2 &&
      s0 > 0 &&
      s1 < period;
    this.entryDoorSpan = usable
      ? { s0, s1, h0: bounds.min.y, h1: bounds.max.y }
      : null;
  }
  /** Side test beside perimeterCoordinate; s itself always comes from that function. */
  private entryChartPoint(x: number, z: number) {
    const b = this.body;
    const zLocal = z - (b.centerZ || 0);
    const half = b.length / 2;
    const w = b.width / 2;
    const dx = x - (b.xMin + half);
    const r = Math.max(Math.abs(dx) / half, Math.abs(zLocal) / w, 1e-6);
    const px = dx / r;
    const pz = zLocal / r;
    const onSide = Math.abs(pz / w) >= Math.abs(px / half) - 1e-8;
    const s = perimeterCoordinate(x, z, b);
    const period = circumference(b);
    const sideS = (((half - px) % period) + period) % period;
    return {
      s,
      entry:
        onSide && pz < 0 && Math.abs(wrappedDelta(s, sideS, period)) <= 1e-6,
    };
  }
  private applyEntryDefault() {
    const entry = this.entryDefault(this.aspect);
    this.entryDoorClear = entry.clear;
    this.placements[0] = entry.placement;
  }
  private entryDefault(aspect: number) {
    const legacy = this.defaults()[0];
    const door = this.entryDoorSpan;
    if (!door) return { placement: legacy, clear: false };
    const rear0 = ENTRY_DOOR_CLEARANCE_M;
    const rear1 = door.s0 - ENTRY_DOOR_CLEARANCE_M;
    const width = rear1 - rear0;
    if (!(width > 0) || width / DECAL_BASE_WIDTH_M < MIN_DECAL_SCALE)
      return { placement: legacy, clear: false };
    const requested = {
      center: (rear0 + rear1) / 2,
      height: 1.28,
      scale: Math.min(1, width / DECAL_BASE_WIDTH_M),
    };
    const placement = constrainDecal(requested, aspect, this.body);
    if (this.placementHitsDoor(placement, aspect, door))
      return { placement: legacy, clear: false };
    return { placement, clear: true };
  }
  private placementHitsDoor(
    placement: DecalPlacement,
    aspect: number,
    door: EntryDoorSpan,
  ) {
    const halfW = (DECAL_BASE_WIDTH_M * placement.scale) / 2;
    const halfH = halfW / aspect;
    const h0 = placement.height - halfH;
    const h1 = placement.height + halfH;
    if (!(h0 < door.h1 && door.h0 < h1)) return false;
    const period = circumference(this.body);
    const s0 = placement.center - halfW;
    const s1 = placement.center + halfW;
    if (s0 < 0 || s1 > period) return true;
    return s0 < door.s1 && door.s0 < s1;
  }
  private key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.dismissMenu();
      this.finish(true);
      this.selected = false;
      this.hovered = false;
      return;
    }
    if (!this.enabled || !this.texture) return;
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const rect = this.host.getBoundingClientRect();
      this.openMenu(
        rect.left + this.host.clientWidth / 2,
        rect.top + this.host.clientHeight / 2,
      );
      return;
    }
    if (!this.selected || this.locked) return;
    if (
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        '+',
        '-',
        '=',
      ].includes(e.key)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (['+', '-', '='].includes(e.key))
        this.scaleBy(e.key === '-' ? 1 / 1.05 : 1.05);
      else
        this.nudge(
          e.key === 'ArrowLeft' ? -0.025 : e.key === 'ArrowRight' ? 0.025 : 0,
          e.key === 'ArrowUp' ? 0.025 : e.key === 'ArrowDown' ? -0.025 : 0,
        );
    }
  };
  /** Clip actual triangles in chart space, retaining their local positions for moving hinges. */
  private refreshBoundary() {
    this.boundaryDirty = true;
  }
  private rebuildBoundary() {
    this.boundaryDirty = false;
    this.points = [];
    if (!this.texture) return;
    const p = this.placements[this.active],
      halfW = (3.5 * p.scale) / 2,
      halfH = halfW / this.aspect,
      period = circumference(this.body);
    for (const mesh of this.surfaces) {
      const coords = mesh.geometry.getAttribute('aWrapCoord'),
        pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < coords.count; i += 3) {
        if (mesh.geometry.getAttribute('aWrapEligible').getX(i) < 0.5) continue;
        const center =
          (coords.getX(i) + coords.getX(i + 1) + coords.getX(i + 2)) / 3;
        const shift = Math.round((p.center - center) / period) * period;
        let polygon = [0, 1, 2].map((j) => ({
          s: coords.getX(i + j) + shift - p.center,
          h: coords.getY(i + j) - p.height,
          point: new THREE.Vector3().fromBufferAttribute(pos, i + j),
        }));
        if (
          Math.min(...polygon.map((v) => v.s)) > halfW ||
          Math.max(...polygon.map((v) => v.s)) < -halfW ||
          Math.min(...polygon.map((v) => v.h)) > halfH ||
          Math.max(...polygon.map((v) => v.h)) < -halfH
        )
          continue;
        const normal = new THREE.Triangle(
          polygon[0].point,
          polygon[1].point,
          polygon[2].point,
        ).getNormal(new THREE.Vector3());
        for (const [axis, sign, limit] of [
          ['s', 1, halfW],
          ['s', -1, halfW],
          ['h', 1, halfH],
          ['h', -1, halfH],
        ] as const) {
          const output: typeof polygon = [];
          for (let j = 0; j < polygon.length; j++) {
            const a = polygon[j],
              b = polygon[(j + 1) % polygon.length],
              da = a[axis] * sign - limit,
              db = b[axis] * sign - limit;
            if (da <= 0) output.push(a);
            if (da < 0 !== db < 0) {
              const t = da / (da - db);
              output.push({
                s: a.s + (b.s - a.s) * t,
                h: a.h + (b.h - a.h) * t,
                point: a.point.clone().lerp(b.point, t),
              });
            }
          }
          polygon = output;
          if (!polygon.length) break;
        }
        for (const v of polygon)
          this.points.push({ mesh, position: v.point, normal });
      }
    }
  }
  update(now: number, reduced: boolean) {
    const visible =
      this.enabled &&
      !!this.texture &&
      !this.locked &&
      (this.hovered || this.selected || !!this.drag);
    this.uniforms.uDecalActive.value = visible ? this.active : -1;
    this.uniforms.uAntTime.value = reduced ? 0 : now / 900;
    if (!visible) {
      if (
        this.state.visible ||
        this.state.contextMenu !== this.contextMenu ||
        this.state.locked !== this.locked
      )
        this.emit(hidden);
      return;
    }
    if (now - this.lastEmit < 40) return;
    if (this.boundaryDirty) this.rebuildBoundary();
    let minY = Infinity,
      maxX = -Infinity,
      minX = Infinity,
      maxY = -Infinity;
    const cameraPosition = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);
    for (const sample of this.points) {
      const point = sample.position
        .clone()
        .applyMatrix4(sample.mesh.matrixWorld);
      const normal = sample.normal
        .clone()
        .transformDirection(sample.mesh.matrixWorld);
      if (normal.dot(cameraPosition.clone().sub(point)) < 0) continue;
      point.project(this.camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = ((point.x + 1) / 2) * this.host.clientWidth,
        y = ((1 - point.y) / 2) * this.host.clientHeight;
      maxX = Math.max(maxX, x);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (
      !Number.isFinite(maxX) ||
      maxX < 0 ||
      minX > this.host.clientWidth ||
      maxY < 0 ||
      minY > this.host.clientHeight
    ) {
      this.emit(hidden);
      return;
    }
    this.lastEmit = now;
    this.emit({
      visible: true,
      x: Math.max(12, Math.min(this.host.clientWidth - 250, maxX - 237)),
      y: Math.max(90, Math.min(this.host.clientHeight - 130, minY - 55)),
      scale: this.placements[this.active].scale,
      dragging: !!this.drag,
      hintCode: this.hintCode,
      locked: this.locked,
      contextMenu: this.contextMenu,
    });
  }
  private emit(state: WrapEditState) {
    this.state = {
      ...state,
      locked: this.locked,
      contextMenu: this.contextMenu,
    };
    // Live reflux for sidebar insights rides on the emitted payload only.
    // It must not be stored on this.state: getState() spreads this.state
    // after its own fresh placements copy, so a stored snapshot would
    // shadow the live placements there.
    this.change({
      ...this.state,
      placements: this.placements.map((p) => ({ ...p })),
      aspect: this.aspect,
      body: { ...this.body },
    });
  }
  dispose() {
    this.designEpoch++;
    this.designTextures.forEach((t) => t.dispose());
    this.finish(false);
    this.texture?.dispose();
    this.replaced.forEach((g) => g.dispose());
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.hover, true);
    this.canvas.removeEventListener('pointerleave', this.leave);
    this.canvas.removeEventListener('keydown', this.key, true);
    this.canvas.removeEventListener('contextmenu', this.context, true);
    window.removeEventListener('pointerdown', this.outside, true);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.cancel);
    window.removeEventListener('blur', this.blur);
  }
}
