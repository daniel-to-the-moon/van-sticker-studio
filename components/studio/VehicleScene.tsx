'use client';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type {
  SceneEngine,
  Metadata,
  Presentation,
  SceneErrorCode,
} from './scene-engine';
import type { Sticker } from '@/lib/stickers';
/** Must match STICKER_IMAGE_FAILED in scene-engine (kept as a literal so this module stays type-only over the lazy engine). */
const STICKER_IMAGE_FAILED = 'sticker-image-failed';
import { t, type Lang, type StringKey } from '@/lib/i18n';
import {
  Move,
  MoveUpRight,
  Minus,
  Plus,
  RotateCcw,
  LockKeyhole,
  UnlockKeyhole,
} from 'lucide-react';
import type { WrapEditState, WrapHintCode } from '@/lib/vehicle-wrap-editor';
import type { VehiclePalette } from '@/lib/vehicle-palettes';
export interface VehicleHandle {
  applySticker: (s: Sticker | null) => Promise<void>;
  setView: (view: string) => void;
  getState: () => unknown;
  exportDrawing: (viewId: string) => { dataUrl: string; filename: string };
}
interface Props {
  lang: Lang;
  presentation: Presentation;
  palette: VehiclePalette | null;
  generating: boolean;
  onCommit: (sticker: Sticker | null) => void;
  parts: Record<string, boolean>;
  wipers: boolean;
  environment: 'camp' | 'studio';
  onPick: (id: string) => void;
  onReady: (meta: Metadata) => void;
  onWrapEdit?: (state: WrapEditState) => void;
}
const HOVER_KEYS: Record<string, StringKey> = {
  'entry-door': 'hover.entry-door',
  'cab-l': 'hover.cab-l',
  'cab-r': 'hover.cab-r',
  'slide-l': 'hover.slide-l',
  'slide-r': 'hover.slide-r',
  rooflight: 'hover.rooflight',
  awning: 'hover.awning',
};
const HINT_KEYS: Record<WrapHintCode, StringKey> = {
  default: 'wrap.hintDefault',
  move: 'wrap.hintMove',
  scale: 'wrap.hintScale',
};
const ERROR_KEYS: Record<SceneErrorCode, StringKey> = {
  'model-load-failed': 'scene.modelLoadFailed',
  'webgl-paused': 'scene.webglPaused',
};
const VehicleScene = forwardRef<VehicleHandle, Props>(
  function VehicleScene(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const engine = useRef<SceneEngine | null>(null);
    const latest = useRef(props);
    useEffect(() => {
      latest.current = props;
    }, [props]);
    const [progress, setProgress] = useState(0);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const [wrapEdit, setWrapEdit] = useState<WrapEditState | null>(null);
    const menuAction = useRef<HTMLButtonElement>(null);
    useEffect(() => {
      if (wrapEdit?.contextMenu)
        menuAction.current?.focus({ preventScroll: true });
    }, [wrapEdit?.contextMenu]);
    const [hover, setHover] = useState<{
      id: string;
      x: number;
      y: number;
    } | null>(null);
    useImperativeHandle(
      ref,
      () => ({
        async applySticker(s) {
          if (!engine.current)
            throw Error(t(latest.current.lang, 'scene.modelStillLoading'));
          try {
            return await engine.current.applySticker(s);
          } catch (e) {
            // The engine reports failures as codes; localize before the page displays them.
            if (e instanceof Error && e.message === STICKER_IMAGE_FAILED)
              throw Error(
                t(latest.current.lang, 'scene.stickerImageFailed'),
              );
            throw e;
          }
        },
        setView: (view) => engine.current?.setView(view),
        getState: () => engine.current?.getState(),
        exportDrawing(viewId) {
          if (!engine.current)
            throw Error(t(latest.current.lang, 'export.notReady'));
          try {
            return engine.current.exportDrawing(viewId);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'export-while-generating'
            )
              throw Error(t(latest.current.lang, 'export.rejectedGenerating'));
            if (
              error instanceof Error &&
              error.message === 'unknown-drawing-view'
            )
              throw Error(t(latest.current.lang, 'error.unknownView'));
            if (error instanceof Error && error.message === 'model-not-ready')
              throw Error(t(latest.current.lang, 'error.waitVehicle'));
            throw Error(t(latest.current.lang, 'export.failed'));
          }
        },
      }),
      [],
    );
    useEffect(() => {
      let active = true;
      void import('./scene-engine').then(({ SceneEngine }) => {
        if (!active || !host.current) return;
        try {
          engine.current = new SceneEngine(host.current, {
            onCommit: (sticker) => active && latest.current.onCommit(sticker),
            onProgress: (v) => active && setProgress(v),
            onReady: (meta) => {
              if (!active) return;
              setReady(true);
              engine.current?.setParts(latest.current.parts);
              engine.current?.setWipers(latest.current.wipers);
              engine.current?.setEnvironment(latest.current.environment);
              engine.current?.setGenerating(latest.current.generating);
              engine.current?.setPalette(latest.current.palette);
              engine.current?.setPresentation(latest.current.presentation);
              host.current
                ?.querySelector('canvas')
                ?.setAttribute(
                  'aria-label',
                  t(latest.current.lang, 'scene.canvasAria'),
                );
              latest.current.onReady(meta);
            },
            onError: (code) =>
              active && setError(t(latest.current.lang, ERROR_KEYS[code])),
            onPick: (id) => latest.current.onPick(id),
            onHover: (id, x, y) => active && setHover(id ? { id, x, y } : null),
            onWrapEdit: (state) => {
              if (active) {
                setWrapEdit(state);
                latest.current.onWrapEdit?.(state);
                if (state.visible) setHover(null);
              }
            },
          });
          // The lazy engine can be created after the user already chose colors.
          engine.current.setPalette(latest.current.palette);
          engine.current.setPresentation(latest.current.presentation);
        } catch {
          setError(t(latest.current.lang, 'scene.webglUnsupported'));
        }
      });
      return () => {
        active = false;
        engine.current?.dispose();
        engine.current = null;
      };
    }, []);
    // Canvas aria-label follows the active language.
    useEffect(() => {
      host.current
        ?.querySelector('canvas')
        ?.setAttribute('aria-label', t(props.lang, 'scene.canvasAria'));
    }, [props.lang, ready]);
    useEffect(
      () => engine.current?.setGenerating(props.generating),
      [props.generating],
    );
    useEffect(
      () => engine.current?.setPresentation(props.presentation),
      [props.presentation],
    );
    useEffect(() => engine.current?.setPalette(props.palette), [props.palette]);
    useEffect(() => engine.current?.setParts(props.parts), [props.parts]);
    useEffect(() => engine.current?.setWipers(props.wipers), [props.wipers]);
    useEffect(
      () => engine.current?.setEnvironment(props.environment),
      [props.environment],
    );
    const lang = props.lang;
    return (
      <>
        <div ref={host} className="vehicle-canvas" />
        {wrapEdit?.visible && (
          <fieldset
            className={`wrap-gizmo ${wrapEdit.dragging ? 'is-dragging' : ''}`}
            style={{ left: wrapEdit.x, top: wrapEdit.y }}
            onPointerEnter={() => engine.current?.keepWrapVisible()}
            aria-label={t(lang, 'wrap.editAria')}
          >
            <div className="wrap-gizmo-controls">
              <button
                className="wrap-move"
                aria-label={t(lang, 'wrap.drag')}
                title={t(lang, 'wrap.dragTitle')}
                onPointerDown={(e) =>
                  engine.current?.beginWrapEdit('move', e.nativeEvent)
                }
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 0.1 : 0.025;
                  if (
                    [
                      'ArrowLeft',
                      'ArrowRight',
                      'ArrowUp',
                      'ArrowDown',
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                    engine.current?.nudgeWrap(
                      e.key === 'ArrowLeft'
                        ? -step
                        : e.key === 'ArrowRight'
                          ? step
                          : 0,
                      e.key === 'ArrowUp'
                        ? step
                        : e.key === 'ArrowDown'
                          ? -step
                          : 0,
                    );
                  }
                }}
              >
                <Move size={17} />
              </button>
              <span className="gizmo-divider" />
              <button
                aria-label={t(lang, 'wrap.shrink')}
                onClick={() => engine.current?.scaleWrap(1 / 1.1)}
              >
                <Minus size={15} />
              </button>
              <output aria-label={t(lang, 'wrap.scaleAria')}>
                {Math.round(wrapEdit.scale * 100)}%
              </output>
              <button
                aria-label={t(lang, 'wrap.grow')}
                onClick={() => engine.current?.scaleWrap(1.1)}
              >
                <Plus size={15} />
              </button>
              <button
                className="wrap-scale"
                aria-label={t(lang, 'wrap.scaleDrag')}
                title={t(lang, 'wrap.scaleDragTitle')}
                onPointerDown={(e) =>
                  engine.current?.beginWrapEdit('scale', e.nativeEvent)
                }
              >
                <MoveUpRight size={17} />
              </button>
              <button
                className="wrap-lock"
                aria-label={t(lang, 'wrap.lock')}
                title={t(lang, 'wrap.lockTitle')}
                onClick={() => engine.current?.setWrapLocked(true)}
              >
                <LockKeyhole size={16} />
              </button>
            </div>
            <div className="wrap-gizmo-caption">
              <span>{t(lang, HINT_KEYS[wrapEdit.hintCode])}</span>
              <button
                aria-label={t(lang, 'wrap.reset')}
                title={t(lang, 'wrap.resetTitle')}
                onClick={() => engine.current?.resetWrap()}
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </fieldset>
        )}
        {wrapEdit?.contextMenu && (
          <div
            className="wrap-context-menu"
            data-wrap-menu
            role="menu"
            tabIndex={-1}
            aria-label={t(lang, 'wrap.menuAria')}
            style={{
              left: wrapEdit.contextMenu.x,
              top: wrapEdit.contextMenu.y,
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                engine.current?.dismissWrapMenu();
                host.current
                  ?.querySelector('canvas')
                  ?.focus({ preventScroll: true });
              } else if (event.key === 'Tab') engine.current?.dismissWrapMenu();
            }}
          >
            <button
              ref={menuAction}
              role="menuitem"
              onClick={() => engine.current?.setWrapLocked(!wrapEdit.locked)}
            >
              {wrapEdit.locked ? (
                <UnlockKeyhole size={16} />
              ) : (
                <LockKeyhole size={16} />
              )}
              {wrapEdit.locked
                ? t(lang, 'wrap.unlock')
                : t(lang, 'wrap.lock')}
            </button>
          </div>
        )}
        {!ready && !error && (
          <div className="model-loading">
            <span className="loading-orbit" />
            <strong>{t(lang, 'scene.loadingTitle')}</strong>
            <span>
              {progress > 0
                ? t(lang, 'scene.loadingProgress', { progress })
                : t(lang, 'scene.loadingPreparing')}
            </span>
          </div>
        )}
        {error && (
          <div className="model-error" role="alert">
            <strong>{t(lang, 'scene.errorTitle')}</strong>
            <p>{error}</p>
            <button onClick={() => window.location.reload()}>
              {t(lang, 'scene.reload')}
            </button>
          </div>
        )}
        {hover && ready && !error && (
          <div
            className="part-tooltip"
            style={{ left: hover.x + 16, top: hover.y - 38 }}
          >
            {t(
              lang,
              HOVER_KEYS[hover.id] ??
                (hover.id.startsWith('window')
                  ? 'hover.window'
                  : 'hover.wiper'),
            )}
            <span>{t(lang, 'scene.clickToExplore')}</span>
          </div>
        )}
      </>
    );
  },
);
export default VehicleScene;
