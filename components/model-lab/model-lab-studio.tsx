'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VEHICLE_MODEL_URL } from '@/lib/vehicle-assets';
import {
  buildVerificationBody,
  disposeVerificationBody,
  isLabVehicle,
  labCamera,
  labDesignToProject,
  labProfile,
  type LabVehicleId,
} from '@/lib/vehicle-model-fixtures';
import {
  defaultLabDesign,
  designCoverage,
  envelopeBody,
  parseLabDesign,
  serializeLabDesign,
  type LabDesign,
  type LabIcon,
  type PanelFeedback,
} from '@/lib/vehicle-model-profile';
import { meshStats } from '@/lib/vehicle-wrap-adapter';
import { VehicleWrapEditor } from '@/lib/vehicle-wrap-editor';

const STORAGE_KEY = 'mxgarage.model-lab.design.v1';
const VEHICLES: { id: LabVehicleId; name: string }[] = [
  { id: 'current-glb', name: '当前车辆资产' },
  { id: 'box-trailer', name: '箱式 / 拖挂' },
  { id: 'high-roof', name: '高顶曲面厢车' },
  { id: 'step-slide', name: '阶梯额头 / 拓展舱' },
];
const ICONS: { id: LabIcon; name: string }[] = [
  { id: 'cup', name: '杯子' },
  { id: 'runner', name: '行者' },
  { id: 'badge', name: '徽章' },
];

function uniqueFeedback(items: PanelFeedback[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.status}:${item.mesh}:${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function ModelLabStudio() {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<VehicleWrapEditor | null>(null);
  const resetView = useRef<() => void>(() => {});
  const designRef = useRef<LabDesign>(defaultLabDesign());
  const [vehicle, setVehicle] = useState<LabVehicleId>('box-trailer');
  const [design, setDesign] = useState<LabDesign>(defaultLabDesign());
  const [feedback, setFeedback] = useState<PanelFeedback[]>([]);
  const [stats, setStats] = useState({ triangles: 0, drawCalls: 0, degenerate: 0 });
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('正在把设计送进贴画着色器');
  const profile = labProfile(vehicle);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('vehicle');
    if (isLabVehicle(requested) && requested !== vehicle) {
      queueMicrotask(() => setVehicle(requested));
      return;
    }
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf3eee6);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff8f1, 0xc8bba8, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(-4, 8, -6);
    scene.add(sun);
    const grid = new THREE.GridHelper(18, 18, 0xb9a89a, 0xe4d9cc);
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const activeProfile = labProfile(vehicle);
    const applyCamera = () => {
      const view = labCamera(activeProfile);
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      controls.target.set(view.target[0], view.target[1], view.target[2]);
      controls.update();
    };
    resetView.current = applyCamera;
    applyCamera();
    const resize = () => {
      const width = element.clientWidth || 640;
      const height = element.clientHeight || 640;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    let root: THREE.Object3D | null = null;
    let editor: VehicleWrapEditor | null = null;
    let frame = 0;
    const loop = () => {
      controls.update();
      editor?.update(performance.now(), false);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    setReady(false);
    setNotice('正在把设计送进贴画着色器');
    const boot = async () => {
      const loaded =
        vehicle === 'current-glb'
          ? (await new GLTFLoader().loadAsync(VEHICLE_MODEL_URL)).scene
          : buildVerificationBody(vehicle);
      if (cancelled) {
        disposeVerificationBody(loaded);
        return;
      }
      root = loaded;
      scene.add(loaded);
      loaded.updateMatrixWorld(true);
      editor = new VehicleWrapEditor({
        root: loaded,
        camera,
        controls,
        host: element,
        body: envelopeBody(activeProfile),
        profile: activeProfile,
        reveal: { value: 1 },
        onChange() {},
        takeCamera() {
          controls.enabled = true;
        },
      });
      editorRef.current = editor;
      const names: string[] = [];
      loaded.traverse((object) => {
        if (object instanceof THREE.Mesh) names.push(object.name);
      });
      setFeedback(names.map((name) => designCoverage(activeProfile, name)));
      setStats(meshStats(loaded));
      await editor.setDesign(labDesignToProject(designRef.current));
      if (!cancelled) {
        setReady(true);
        setNotice('贴画着色器已使用当前 profile');
      }
    };
    void boot().catch((error: unknown) => {
      if (!cancelled)
        setNotice(error instanceof Error ? error.message : '车型未能载入');
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      editorRef.current = null;
      editor?.dispose();
      if (root) {
        scene.remove(root);
        disposeVerificationBody(root);
      }
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [vehicle]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let cancelled = false;
    void editor.setDesign(labDesignToProject(design)).then(() => {
      if (!cancelled) setNotice('贴画着色器已使用当前 profile');
    });
    return () => {
      cancelled = true;
    };
  }, [design]);

  const grouped = {
    applied: uniqueFeedback(feedback.filter((item) => item.status === 'applied')),
    excluded: uniqueFeedback(feedback.filter((item) => item.status === 'excluded')),
    unsupported: uniqueFeedback(
      feedback.filter((item) => item.status === 'unsupported'),
    ),
  };
  const update = (patch: Partial<LabDesign>) => {
    setDesign((current) => {
      const next = { ...current, ...patch };
      designRef.current = next;
      return next;
    });
  };

  return (
    <main
      data-model-lab-ready={ready ? '1' : '0'}
      data-vehicle={vehicle}
      style={{
        minHeight: '100vh',
        background: '#f7f1e8',
        color: '#1c2430',
        fontFamily: 'Georgia, "Songti SC", serif',
      }}
    >
      <header style={{ padding: '20px 24px 0' }}>
        <p style={{ margin: 0, letterSpacing: '0.14em', fontSize: 12 }}>
          MXGARAGE VAN
        </p>
        <h1 style={{ margin: '4px 0 8px', fontSize: 28 }}>车型适配验证</h1>
        <p style={{ margin: 0, maxWidth: 760, lineHeight: 1.5 }}>
          {profile.verification
            ? '这是验证模型，不是量产尺寸。同一套文字、图标和色块经过适配器进入现有贴画着色器。'
            : '当前车辆资产只贴已登记的包覆面。未登记网格会列在下面，不会被静默拉伸。'}
        </p>
      </header>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 360px) 1fr',
          gap: 20,
          padding: 24,
          alignItems: 'start',
        }}
      >
        <section style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {VEHICLES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setVehicle(item.id)}
                aria-pressed={vehicle === item.id}
                style={{
                  border: '1px solid #1c2430',
                  background: vehicle === item.id ? '#1c2430' : 'transparent',
                  color: vehicle === item.id ? '#f7f1e8' : '#1c2430',
                  borderRadius: 999,
                  padding: '6px 12px',
                  cursor: 'pointer',
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
          <label>
            文字
            <input
              value={design.text}
              maxLength={32}
              onChange={(event) => update({ text: event.target.value || ' ' })}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
          <label>
            图标
            <select
              value={design.icon}
              onChange={(event) => update({ icon: event.target.value as LabIcon })}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            >
              {ICONS.map((icon) => (
                <option key={icon.id} value={icon.id}>
                  {icon.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            色块
            <input
              type="color"
              value={design.swatch}
              onChange={(event) => update({ swatch: event.target.value })}
              style={{ display: 'block', marginTop: 4 }}
            />
          </label>
          <label>
            前后位置 {design.x.toFixed(2)}
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={design.x}
              onChange={(event) => update({ x: Number(event.target.value) })}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <label>
            上下位置 {design.y.toFixed(2)}
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={design.y}
              onChange={(event) => update({ y: Number(event.target.value) })}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <label>
            缩放 {design.scale.toFixed(2)}
            <input
              type="range"
              min={0.4}
              max={1.6}
              step={0.01}
              value={design.scale}
              onChange={(event) => update({ scale: Number(event.target.value) })}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(STORAGE_KEY, serializeLabDesign(design));
                setNotice('设计已保存');
              }}
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) {
                  setNotice('还没有可恢复的设计');
                  return;
                }
                const restored = parseLabDesign(raw);
                designRef.current = restored;
                setDesign(restored);
                setNotice('设计已恢复');
              }}
            >
              恢复
            </button>
            <button type="button" onClick={() => resetView.current()}>
              同视角
            </button>
          </div>
          <p style={{ margin: 0 }}>{notice}</p>
          <p style={{ margin: 0 }}>
            三角面 {stats.triangles} · 绘制调用 {stats.drawCalls} · 退化面{' '}
            {stats.degenerate}
          </p>
          {!profile.panels.some((panel) => panel.class === 'wheel') ? (
            <p style={{ margin: 0 }}>
              当前资产没有单独的轮胎网格，不会把轮胎写成已经支持。
            </p>
          ) : null}
          <FeedbackList title="可贴" items={grouped.applied} />
          <FeedbackList title="明确不贴" items={grouped.excluded} />
          <FeedbackList title="无法支持" items={grouped.unsupported} />
        </section>
        <div
          ref={host}
          aria-label="车型适配预览"
          style={{
            minHeight: 640,
            background: '#f3eee6',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        />
      </div>
    </main>
  );
}

function FeedbackList({ title, items }: { title: string; items: PanelFeedback[] }) {
  const shown = items.slice(0, 8);
  return (
    <div>
      <h2 style={{ fontSize: 16, margin: '8px 0' }}>
        {title} · {items.length}
      </h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {shown.map((item) => (
          <li key={`${item.mesh}-${item.reason}`}>
            {item.mesh}：{item.reason}
          </li>
        ))}
      </ul>
      {items.length > shown.length ? <p style={{ margin: '4px 0 0' }}>其余已折叠</p> : null}
    </div>
  );
}
