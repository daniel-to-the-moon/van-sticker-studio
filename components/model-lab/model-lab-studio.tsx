'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VEHICLE_MODEL_URL } from '@/lib/vehicle-assets';
import {
  buildVerificationBody,
  disposeVerificationBody,
  fitVehicleView,
  labDesignToProject,
  labProfile,
  resolveLabVehicle,
  type LabVehicleId,
} from '@/lib/vehicle-model-fixtures';
import {
  defaultLabDesign,
  envelopeBody,
  labFeedbackStatus,
  parseLabDesign,
  serializeLabDesign,
  type LabDesign,
  type LabIcon,
  type PanelFeedback,
  type Vec3,
} from '@/lib/vehicle-model-profile';
import { meshStats } from '@/lib/vehicle-wrap-adapter';
import { VehicleWrapEditor } from '@/lib/vehicle-wrap-editor';
import './model-lab.css';

const STORAGE_KEY = 'mxgarage.model-lab.design.v1';
const ORIGINAL = 'current-glb';
const TESTS: { id: LabVehicleId; name: string }[] = [
  { id: 'box-trailer', name: '箱式 / 拖挂' },
  { id: 'high-roof', name: '高顶曲面厢车' },
  { id: 'step-slide', name: '阶梯额头 / 拓展舱' },
];
const ICONS: { id: LabIcon; name: string }[] = [
  { id: 'cup', name: '杯子' },
  { id: 'runner', name: '行者' },
  { id: 'badge', name: '徽章' },
];

function chooseVehicle(current: LabVehicleId, choice: LabVehicleId) {
  return resolveLabVehicle({
    query: null,
    queryApplied: true,
    current,
    choice,
  }).vehicle;
}

export default function ModelLabStudio() {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<VehicleWrapEditor | null>(null);
  const queryApplied = useRef(false);
  const boundsRef = useRef<{ min: Vec3; max: Vec3 } | null>(null);
  const resetView = useRef<() => void>(() => {});
  const designRef = useRef<LabDesign>(defaultLabDesign());
  const [vehicle, setVehicle] = useState<LabVehicleId>(ORIGINAL);
  const [design, setDesign] = useState<LabDesign>(defaultLabDesign());
  const [feedback, setFeedback] = useState<PanelFeedback[]>([]);
  const [stats, setStats] = useState({ triangles: 0, drawCalls: 0, degenerate: 0 });
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('正在读取我的房车');
  const profile = labProfile(vehicle);
  const grouped = {
    applied: feedback.filter((item) => labFeedbackStatus(item) === 'applied'),
    excluded: feedback.filter((item) => labFeedbackStatus(item) === 'excluded'),
    unsupported: feedback.filter((item) => labFeedbackStatus(item) === 'unsupported'),
  };

  useEffect(() => {
    if (!queryApplied.current) {
      const next = resolveLabVehicle({
        query: new URLSearchParams(window.location.search).get('vehicle'),
        queryApplied: false,
        current: ORIGINAL,
        choice: null,
      });
      queryApplied.current = true;
      if (next.vehicle !== vehicle) {
        queueMicrotask(() => setVehicle(next.vehicle));
        return;
      }
    }
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf5f6f7);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xf7f8f8, 0xd5d8dc, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(-6, 8, -4);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const activeProfile = labProfile(vehicle);
    const fit = () => {
      const bounds = boundsRef.current;
      if (!bounds) return;
      const view = fitVehicleView({
        min: bounds.min,
        max: bounds.max,
        aspect: camera.aspect || 1,
        fovDeg: 38,
      });
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      controls.target.set(view.target[0], view.target[1], view.target[2]);
      camera.near = Math.max(0.05, view.distance / 80);
      camera.far = Math.max(80, view.distance * 12);
      camera.updateProjectionMatrix();
      controls.update();
    };
    resetView.current = fit;
    const resize = () => {
      const width = element.clientWidth || 640;
      const height = element.clientHeight || 640;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fit();
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
    setNotice(vehicle === ORIGINAL ? '正在读取我的房车' : '正在读取适配测试模型');
    const boot = async () => {
      const loaded =
        vehicle === ORIGINAL
          ? (await new GLTFLoader().loadAsync(VEHICLE_MODEL_URL)).scene
          : buildVerificationBody(vehicle);
      if (cancelled) {
        disposeVerificationBody(loaded);
        return;
      }
      root = loaded;
      scene.add(loaded);
      loaded.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(loaded);
      boundsRef.current = {
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
      };
      fit();
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
      setFeedback(editor.getProfileFeedback());
      setStats(meshStats(loaded));
      await editor.setDesign(labDesignToProject(designRef.current));
      if (!cancelled) {
        setReady(true);
        setNotice(vehicle === ORIGINAL ? '我的房车已载入' : '适配测试模型已载入');
      }
    };
    void boot().catch((error: unknown) => {
      if (!cancelled)
        setNotice(error instanceof Error ? error.message : '车型未能载入');
    });
    return () => {
      cancelled = true;
      boundsRef.current = null;
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
    void editor.setDesign(labDesignToProject(design)).catch((error: unknown) => {
      if (!cancelled)
        setNotice(error instanceof Error ? error.message : '设计未能贴上');
    });
    return () => {
      cancelled = true;
    };
  }, [design]);

  const update = (patch: Partial<LabDesign>) => {
    setDesign((current) => {
      const next = { ...current, ...patch };
      designRef.current = next;
      return next;
    });
  };
  const select = (choice: LabVehicleId) => {
    queryApplied.current = true;
    setVehicle(chooseVehicle(vehicle, choice));
  };

  return (
    <main
      className="model-lab"
      data-model-lab-ready={ready ? '1' : '0'}
      data-vehicle={vehicle}
      data-diagnostics="closed"
    >
      <header className="model-lab-bar">
        <span className="model-lab-mark">MXGARAGE VAN</span>
        <Link className="model-lab-editor" href="/">
          进入现有编辑器
        </Link>
      </header>
      <div className="model-lab-body">
        <aside className="model-lab-side">
          <h1>{profile.verification ? '适配测试模型' : '我的房车/原车型'}</h1>
          <p className="model-lab-note">
            {profile.verification
              ? '这是验证模型，不是量产尺寸。贴画只覆盖已登记的侧围。'
              : '这是现有房车资产。未登记的门窗、灯和内饰不会被静默贴上。'}
          </p>
          <button
            type="button"
            className="model-lab-choice"
            aria-pressed={vehicle === ORIGINAL}
            onClick={() => select(ORIGINAL)}
          >
            我的房车/原车型
          </button>
          <details className="model-lab-tests">
            <summary>适配测试模型</summary>
            <p>简化车体只用于检查适配器，不是原车的升级。</p>
            <div className="model-lab-test-list">
              {TESTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="model-lab-choice"
                  aria-pressed={vehicle === item.id}
                  onClick={() => select(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </details>
          <label className="model-lab-field">
            文字
            <input
              value={design.text}
              maxLength={32}
              onChange={(event) => update({ text: event.target.value || ' ' })}
            />
          </label>
          <label className="model-lab-field">
            图标
            <select
              value={design.icon}
              onChange={(event) => update({ icon: event.target.value as LabIcon })}
            >
              {ICONS.map((icon) => (
                <option key={icon.id} value={icon.id}>
                  {icon.name}
                </option>
              ))}
            </select>
          </label>
          <label className="model-lab-field">
            色块
            <input
              type="color"
              value={design.swatch}
              onChange={(event) => update({ swatch: event.target.value })}
            />
          </label>
          <div className="model-lab-actions">
            <button
              type="button"
              className="model-lab-ghost"
              onClick={() => {
                try {
                  localStorage.setItem(STORAGE_KEY, serializeLabDesign(design));
                  setNotice('设计已保存');
                } catch {
                  setNotice('此环境无法保存');
                }
              }}
            >
              保存
            </button>
            <button
              type="button"
              className="model-lab-ghost"
              onClick={() => {
                try {
                  const raw = localStorage.getItem(STORAGE_KEY);
                  if (!raw) {
                    setNotice('还没有可恢复的设计');
                    return;
                  }
                  const restored = parseLabDesign(raw);
                  designRef.current = restored;
                  setDesign(restored);
                  setNotice('设计已恢复');
                } catch {
                  setNotice('设计无法恢复');
                }
              }}
            >
              恢复
            </button>
            <button type="button" className="model-lab-ghost" onClick={() => resetView.current()}>
              入框
            </button>
          </div>
          <p className="model-lab-note">{notice}</p>
          <details className="model-lab-diagnostics">
            <summary>诊断</summary>
            <p>
              三角面 {stats.triangles} · 绘制调用 {stats.drawCalls} · 退化面 {stats.degenerate}
            </p>
            {!profile.panels.some((panel) => panel.class === 'wheel') ? (
              <p>当前资产没有单独的轮胎网格，不会把轮胎写成已经支持。</p>
            ) : null}
            <FeedbackList title="可贴" items={grouped.applied} />
            <FeedbackList title="明确不贴" items={grouped.excluded} />
            <FeedbackList title="无法支持" items={grouped.unsupported} />
          </details>
        </aside>
        <div className="model-lab-stage-wrap">
          <div ref={host} className="model-lab-stage" aria-label="房车预览" />
          <p className="model-lab-caption">
            {profile.verification ? '适配测试模型，不是量产尺寸' : '我的房车/原车型'}
          </p>
        </div>
      </div>
    </main>
  );
}

function FeedbackList({ title, items }: { title: string; items: PanelFeedback[] }) {
  const shown = items.slice(0, 6);
  if (!shown.length) return null;
  return (
    <div>
      <p>
        {title} · {items.length}
      </p>
      <ul>
        {shown.map((item) => (
          <li key={`${item.mesh}-${item.reason}`}>
            {item.mesh}：{item.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
