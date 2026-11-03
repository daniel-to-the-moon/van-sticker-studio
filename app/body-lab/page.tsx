'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import BodyConfigPanel from '@/components/studio/BodyConfigPanel';
import { configForRegisteredModel } from '@/lib/announcement-db-data';
import { t, type Lang } from '@/lib/i18n';
import {
  DEFAULT_BODY_CONFIG,
  checkBodyConstraints,
  easeOutCubic,
  lerpTrio,
  trioLengthMm,
  trioOf,
  type BodyConfig,
  type ChassisTrio,
} from '@/lib/parametric-body';
import {
  BOUNCE_DURATION_MS,
  bounceScale,
  buildParametricBody,
  disposeParametricBody,
} from '@/lib/parametric-body-scene';

/**
 * Body lab (slice 1): parametric B-type body configurator.
 * Deliberately separate from the main wrap studio page: the shipped GLB
 * model and the decal flow are untouched. The preview here is a schematic
 * procedural body, not the real van model.
 */
export default function BodyLabPage() {
  const [lang, setLang] = useState<Lang>('zh');
  const [config, setConfig] = useState<BodyConfig>(DEFAULT_BODY_CONFIG);
  /** Rendered config: follows the target, gliding the B trio on snaps. */
  const [display, setDisplay] = useState<BodyConfig>(DEFAULT_BODY_CONFIG);
  const configRef = useRef(config);
  const displayRef = useRef(config);
  const animRef = useRef<{
    from: ChassisTrio;
    to: ChassisTrio;
    start: number;
    dur: number;
  } | null>(null);
  /**
   * Slice 5 registry gate: null is the demo view (prototype defaults,
   * not configurable); a registered model id drives the config from
   * its announcement row.
   */
  const [registeredModelId, setRegisteredModelId] = useState<string | null>(
    null,
  );

  const handleSelectModel = (modelId: string | null) => {
    setRegisteredModelId(modelId);
    const next =
      modelId === null
        ? { ...DEFAULT_BODY_CONFIG }
        : configForRegisteredModel(modelId);
    if (next === null) return;
    const prev = displayRef.current;
    configRef.current = next;
    setConfig(next);
    if (
      prev.vehicleKind === 'motorhome-b' &&
      next.vehicleKind === 'motorhome-b'
    ) {
      animRef.current = {
        from: trioOf(prev),
        to: trioOf(next),
        start: performance.now(),
        dur: 300,
      };
    } else {
      animRef.current = null;
      displayRef.current = next;
      setDisplay(next);
    }
  };
  const [popKey, setPopKey] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const bodyRef = useRef<THREE.Group | null>(null);
  /** performance.now() timestamp of the last slider release; 0 = idle. */
  const bounceRef = useRef(0);
  const view = useRef({ azimuth: 0.7, polar: 1.15, radius: 10 });

  /** Slider drag ended: spring the body once and pop the value badge. */
  const handleRelease = () => {
    bounceRef.current = performance.now();
    setPopKey((key) => key + 1);
  };

  /** Panel change (drag or button): cancel any glide, follow directly. */
  const handleChange = (next: BodyConfig) => {
    animRef.current = null;
    configRef.current = next;
    displayRef.current = next;
    setConfig(next);
    setDisplay(next);
  };

  /** Trio slider released on a snapped value: glide the params to it. */
  const handleSnapRelease = (snapped: BodyConfig) => {
    animRef.current = {
      from: trioOf(displayRef.current),
      to: trioOf(snapped),
      start: performance.now(),
      dur: 350,
    };
    configRef.current = snapped;
    setConfig(snapped);
  };

  const results = useMemo(() => checkBodyConstraints(config), [config]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf4e9e3);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4b0, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(6, 10, 4);
    scene.add(sun);
    const grid = new THREE.GridHelper(20, 20, 0x9e4b4b, 0xd8cbb8);
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const target = new THREE.Vector3(0, 1.2, 0);

    const resize = () => {
      const width = element.clientWidth || 640;
      const height = element.clientHeight || 520;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    const frame = () => {
      const { azimuth, polar, radius } = view.current;
      camera.position.set(
        target.x + radius * Math.sin(polar) * Math.sin(azimuth),
        target.y + radius * Math.cos(polar),
        target.z + radius * Math.sin(polar) * Math.cos(azimuth),
      );
      camera.lookAt(target);
      const anim = animRef.current;
      if (anim) {
        const t = Math.min(
          1,
          (performance.now() - anim.start) / anim.dur,
        );
        const trio = lerpTrio(anim.from, anim.to, easeOutCubic(t));
        const base = configRef.current;
        const nextDisplay = {
          ...base,
          ...trio,
          lengthMm: trioLengthMm(trio),
        };
        displayRef.current = nextDisplay;
        setDisplay(nextDisplay);
        if (t >= 1) {
          animRef.current = null;
          displayRef.current = configRef.current;
          setDisplay(configRef.current);
        }
      }
      const body = bodyRef.current;
      if (body && bounceRef.current > 0) {
        const elapsed = performance.now() - bounceRef.current;
        if (elapsed >= BOUNCE_DURATION_MS) {
          body.scale.set(1, 1, 1);
          bounceRef.current = 0;
        } else {
          const s = bounceScale(elapsed);
          body.scale.set(s.x, s.y, s.z);
        }
      }
      renderer.render(scene, camera);
    };
    const loop = () => {
      frame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      view.current.azimuth -= (event.clientX - lastX) * 0.005;
      view.current.polar = Math.min(
        1.5,
        Math.max(0.15, view.current.polar + (event.clientY - lastY) * 0.005),
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      view.current.radius = Math.min(
        18,
        Math.max(4, view.current.radius * (1 + event.deltaY * 0.001)),
      );
    };
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      if (bodyRef.current) {
        scene.remove(bodyRef.current);
        disposeParametricBody(bodyRef.current);
        bodyRef.current = null;
      }
      sceneRef.current = null;
      renderer.dispose();
      element.removeChild(canvas);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (bodyRef.current) {
      scene.remove(bodyRef.current);
      disposeParametricBody(bodyRef.current);
    }
    const next = buildParametricBody(display);
    scene.add(next);
    bodyRef.current = next;
  }, [display]);

  return (
    <main style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 4px' }}>{t(lang, 'bodylab.title')}</h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>
            {t(lang, 'bodylab.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setLang('zh')}>
            {t(lang, 'bodylab.langZh')}
          </button>
          <button type="button" onClick={() => setLang('en')}>
            {t(lang, 'bodylab.langEn')}
          </button>
        </div>
      </header>
      <div
        style={{
          display: 'flex',
          gap: 20,
          marginTop: 20,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ width: 340, flexShrink: 0 }}>
          <BodyConfigPanel
            lang={lang}
            config={config}
            results={results}
            onChange={handleChange}
            popKey={popKey}
            onRelease={handleRelease}
            onSnapRelease={handleSnapRelease}
            registeredModelId={registeredModelId}
            onSelectModel={handleSelectModel}
          />
        </div>
        <div
          ref={host}
          aria-label={t(lang, 'bodylab.canvasAria')}
          style={{
            flex: 1,
            minWidth: 320,
            minHeight: 520,
            background: '#f4e9e3',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        />
      </div>
      <p style={{ fontSize: 13, opacity: 0.75 }}>
        {t(lang, 'bodylab.orbitHint')}
      </p>
    </main>
  );
}
