"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { validateFixturePlacement, type Fixture } from "@/lib/interior-placement";
import styles from "./layout.module.css";

const ENVELOPE_WIDTH = 5000;
const ENVELOPE_HEIGHT = 2000;
const PALETTE_WIDTH = 700;
const PALETTE_HEIGHT = 450;
const KEYBOARD_STEP = 100;

const INITIAL_FIXTURES: Fixture[] = [
  { x: 1000, y: 500, width: 800, height: 600, rotation: 0 },
];

const OPENING_CLEARANCES = [
  { x: 3000, y: 0, width: 800, height: 500 },
];

const REASON_LABELS: Record<string, string> = {
  invalid_geometry: "无效的几何形状",
  outside_envelope: "超出布局边界",
  collision_with_fixture: "与已有家具冲突",
  collision_with_clearance: "占用预留开口空间",
  unsupported_rotation: "不支持的旋转角度",
};

interface PreviewState {
  x: number;
  y: number;
  valid: boolean;
  reason?: string;
}

export default function InteriorLayoutPage() {
  const [placedFixtures, setPlacedFixtures] = useState<Fixture[]>(INITIAL_FIXTURES);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [keyboardPosition, setKeyboardPosition] = useState({ x: 0, y: 0 });

  const paletteRef = useRef<HTMLButtonElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const computePreview = useCallback((mmX: number, mmY: number): PreviewState => {
    const candidate: Fixture = {
      x: mmX,
      y: mmY,
      width: PALETTE_WIDTH,
      height: PALETTE_HEIGHT,
      rotation: 0,
    };

    const result = validateFixturePlacement(
      candidate,
      { width: ENVELOPE_WIDTH, height: ENVELOPE_HEIGHT },
      placedFixtures,
      OPENING_CLEARANCES
    );

    if (result.valid) {
      return { x: mmX, y: mmY, valid: true };
    } else {
      return { x: mmX, y: mmY, valid: false, reason: result.reason };
    }
  }, [placedFixtures]);

  const pointerToMM = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const mmX = (relX / rect.width) * ENVELOPE_WIDTH;
    const mmY = (relY / rect.height) * ENVELOPE_HEIGHT;
    return { x: mmX, y: mmY };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== null || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    setIsDragging(true);
    setKeyboardMode(false);

    const mm = pointerToMM(e.clientX, e.clientY);
    if (mm) {
      const previewState = computePreview(mm.x, mm.y);
      setPreview(previewState);
      if (previewState.valid) {
        setStatusMessage("拖动放置家具");
      } else {
        setStatusMessage(REASON_LABELS[previewState.reason || ""] || "无法放置");
      }
    }
  }, [pointerToMM, computePreview]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.preventDefault();

    const mm = pointerToMM(e.clientX, e.clientY);
    if (mm) {
      const previewState = computePreview(mm.x, mm.y);
      setPreview(previewState);
      if (previewState.valid) {
        setStatusMessage("拖动放置家具");
      } else {
        setStatusMessage(REASON_LABELS[previewState.reason || ""] || "无法放置");
      }
    }
  }, [pointerToMM, computePreview]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    activePointerIdRef.current = null;
    setIsDragging(false);

    const mm = pointerToMM(e.clientX, e.clientY);
    if (mm) {
      const candidate: Fixture = {
        x: mm.x,
        y: mm.y,
        width: PALETTE_WIDTH,
        height: PALETTE_HEIGHT,
        rotation: 0,
      };

      const result = validateFixturePlacement(
        candidate,
        { width: ENVELOPE_WIDTH, height: ENVELOPE_HEIGHT },
        placedFixtures,
        OPENING_CLEARANCES
      );

      if (result.valid) {
        setPlacedFixtures(prev => [...prev, candidate]);
        setPreview(null);
        setStatusMessage("家具已放置");
      } else {
        setPreview(null);
        setStatusMessage(REASON_LABELS[result.reason] || "放置失败");
      }
    } else {
      setPreview(null);
      setStatusMessage("");
    }
  }, [pointerToMM, placedFixtures]);

  const clearPreview = useCallback(() => {
    const pointerId = activePointerIdRef.current;
    const palette = paletteRef.current;
    activePointerIdRef.current = null;
    if (pointerId !== null && palette?.hasPointerCapture(pointerId)) {
      palette.releasePointerCapture(pointerId);
    }
    setIsDragging(false);
    setPreview(null);
    setKeyboardMode(false);
    setStatusMessage("");
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    clearPreview();
  }, [clearPreview]);

  const handleLostPointerCapture = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    clearPreview();
  }, [clearPreview]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isDragging || e.repeat) return;

    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!keyboardMode) {
        setKeyboardMode(true);
        setKeyboardPosition({ x: 0, y: 0 });
        const previewState = computePreview(0, 0);
        setPreview(previewState);
        if (previewState.valid) {
          setStatusMessage("使用方向键移动，空格或回车确认，Escape取消");
        } else {
          setStatusMessage(REASON_LABELS[previewState.reason || ""] || "无法放置");
        }
      } else {
        const candidate: Fixture = {
          x: keyboardPosition.x,
          y: keyboardPosition.y,
          width: PALETTE_WIDTH,
          height: PALETTE_HEIGHT,
          rotation: 0,
        };

        const result = validateFixturePlacement(
          candidate,
          { width: ENVELOPE_WIDTH, height: ENVELOPE_HEIGHT },
          placedFixtures,
          OPENING_CLEARANCES
        );

        if (result.valid) {
          setPlacedFixtures(prev => [...prev, candidate]);
          setPreview(null);
          setKeyboardMode(false);
          setStatusMessage("家具已放置");
        } else {
          setPreview(null);
          setKeyboardMode(false);
          setStatusMessage(REASON_LABELS[result.reason] || "放置失败");
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearPreview();
    } else if (keyboardMode) {
      let newX = keyboardPosition.x;
      let newY = keyboardPosition.y;
      let handled = false;

      if (e.key === "ArrowLeft") {
        newX = Math.max(0, keyboardPosition.x - KEYBOARD_STEP);
        handled = true;
      } else if (e.key === "ArrowRight") {
        newX = Math.min(ENVELOPE_WIDTH - PALETTE_WIDTH, keyboardPosition.x + KEYBOARD_STEP);
        handled = true;
      } else if (e.key === "ArrowUp") {
        newY = Math.max(0, keyboardPosition.y - KEYBOARD_STEP);
        handled = true;
      } else if (e.key === "ArrowDown") {
        newY = Math.min(ENVELOPE_HEIGHT - PALETTE_HEIGHT, keyboardPosition.y + KEYBOARD_STEP);
        handled = true;
      }

      if (handled) {
        e.preventDefault();
        setKeyboardPosition({ x: newX, y: newY });
        const previewState = computePreview(newX, newY);
        setPreview(previewState);
        if (previewState.valid) {
          setStatusMessage("使用方向键移动，空格或回车确认，Escape取消");
        } else {
          setStatusMessage(REASON_LABELS[previewState.reason || ""] || "无法放置");
        }
      }
    }
  }, [isDragging, keyboardMode, keyboardPosition, placedFixtures, computePreview, clearPreview]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (isDragging || keyboardMode)) {
        clearPreview();
      }
    };
    window.addEventListener("keydown", handleEscape);
    const handleHidden = () => {
      if (document.hidden) clearPreview();
    };
    window.addEventListener("blur", clearPreview);
    document.addEventListener("visibilitychange", handleHidden);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", clearPreview);
      document.removeEventListener("visibilitychange", handleHidden);
    };
  }, [isDragging, keyboardMode, clearPreview]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>← 返回首页</Link>
        <h1 className={styles.title}>室内布局草图</h1>
      </header>

      <div className={styles.disclaimer}>
        <p>交互示例：尺寸仅用于演示，非实际车辆测量数据</p>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          ref={paletteRef}
          onBlur={() => { if (keyboardMode) clearPreview(); }}
          data-testid="fixture-palette"
          className={styles.palette}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handleLostPointerCapture}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.preventDefault()}
          aria-label="家具选板：拖动或使用键盘放置家具"
        >
          <div className={styles.paletteLabel}>家具选板</div>
          <div className={styles.paletteDimensions}>{PALETTE_WIDTH} × {PALETTE_HEIGHT} mm</div>
        </button>
      </div>

      <div
        data-testid="layout-board"
        className={styles.board}
      >
        <div ref={boardRef} className={styles.envelope}>
          {placedFixtures.map((fixture) => {
            const xPercent = (fixture.x / ENVELOPE_WIDTH) * 100;
            const yPercent = (fixture.y / ENVELOPE_HEIGHT) * 100;
            const widthPercent = (fixture.width / ENVELOPE_WIDTH) * 100;
            const heightPercent = (fixture.height / ENVELOPE_HEIGHT) * 100;
            return (
              <div
                key={`${fixture.x}:${fixture.y}`}
                data-testid="placed-fixture"
                className={styles.fixture}
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: `${widthPercent}%`,
                  height: `${heightPercent}%`,
                }}
                aria-label={`已放置家具 ${fixture.width} × ${fixture.height} 毫米`}
              />
            );
          })}

          {OPENING_CLEARANCES.map((clearance, index) => {
            const xPercent = (clearance.x / ENVELOPE_WIDTH) * 100;
            const yPercent = (clearance.y / ENVELOPE_HEIGHT) * 100;
            const widthPercent = (clearance.width / ENVELOPE_WIDTH) * 100;
            const heightPercent = (clearance.height / ENVELOPE_HEIGHT) * 100;
            return (
              <div
                key={`clearance-${index}`}
                className={styles.clearance}
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: `${widthPercent}%`,
                  height: `${heightPercent}%`,
                }}
                aria-label={`预留开口空间 ${clearance.width} × ${clearance.height} 毫米`}
              />
            );
          })}

          {preview && (
            <div
              data-testid="placement-preview"
              data-valid={preview.valid}
              className={`${styles.preview} ${preview.valid ? styles.previewValid : styles.previewInvalid}`}
              style={{
                left: `${(preview.x / ENVELOPE_WIDTH) * 100}%`,
                top: `${(preview.y / ENVELOPE_HEIGHT) * 100}%`,
                width: `${(PALETTE_WIDTH / ENVELOPE_WIDTH) * 100}%`,
                height: `${(PALETTE_HEIGHT / ENVELOPE_HEIGHT) * 100}%`,
              }}
              aria-hidden="true"
            />
          )}
        </div>

        <div className={styles.dimensions}>
          <div className={styles.dimensionLabel}>宽度: {ENVELOPE_WIDTH} mm</div>
          <div className={styles.dimensionLabel}>高度: {ENVELOPE_HEIGHT} mm</div>
        </div>
      </div>

      <output
        data-testid="placement-status"
        className={styles.status}
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </output>
    </div>
  );
}
