'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Sparkles,
  MoveUpRight,
  MousePointer2,
  RotateCcw,
  Check,
  ChevronDown,
  X,
  LoaderCircle,
  Sun,
  Trees,
  DoorOpen,
  PanelTopOpen,
  Wind,
  ScanLine,
  CornerDownLeft,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import VehicleScene, {
  type VehicleHandle,
} from '@/components/studio/VehicleScene';
import PlanInsights from '@/components/studio/PlanInsights';
import PalettePicker from '@/components/studio/PalettePicker';
import paletteStyles from '@/components/studio/PalettePicker.module.css';
import type { VehiclePalette } from '@/lib/vehicle-palettes';
import type { WrapEditState } from '@/lib/vehicle-wrap-editor';
import { DEFAULT_DECAL_ASPECT, VAN_WRAP_BODY } from '@/lib/plan-insights';
import {
  SAMPLES,
  INSPIRATIONS,
  inspirationLabel,
  inspirationText,
  stickerName,
  type Sticker,
} from '@/lib/stickers';
import { t, type Lang, type SlotStatus, type StringKey } from '@/lib/i18n';
import type { Metadata, Presentation } from '@/components/studio/scene-engine';
import {
  DRAWING_EXPORT_VIEWS,
  drawingExportView,
  requestDrawingExport,
  type DrawingExportViewId,
} from '@/lib/drawing-views';
import { readStickerBatch } from '@/lib/sticker-stream';
import { useStudioTools } from '@/components/studio/use-studio-tools';
const PART_KEYS: Record<string, StringKey> = {
  'entry-door': 'part.entry-door',
  'cab-l': 'part.cab-l',
  'cab-r': 'part.cab-r',
  'slide-l': 'part.slide-l',
  'slide-r': 'part.slide-r',
  rooflight: 'part.rooflight',
  awning: 'part.awning',
};
const VIEW_KEYS: Record<string, StringKey> = {
  hero: 'view.hero',
  entry: 'view.entry',
  driver: 'view.driver',
  front: 'view.front',
  rear: 'view.rear',
};
// Quick preview entries (camera presets, environment switch, camp shortcut,
// part dock) are hidden by default on the simplified homepage. Direct 3D
// interaction — clicking the model to open doors and windows — is unaffected.
const SHOW_QUICK_ENTRIES = false;
const partName = (id: string, lang: Lang) =>
  t(
    lang,
    PART_KEYS[id] ?? (id.startsWith('window') ? 'part.window' : 'part.wiper'),
  );
export default function Home() {
  const [lang, setLang] = useState<Lang>('en');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<Sticker[]>(SAMPLES);
  const [selected, setSelected] = useState<string | null>(null);
  const [applied, setApplied] = useState<Sticker | null>(null);
  const [presentation, setPresentation] = useState<Presentation>('drawing');
  const [palette, setPalette] = useState<VehiclePalette | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [slots, setSlots] = useState<Record<number, SlotStatus>>({});
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [parts, setParts] = useState<Record<string, boolean>>({});
  const [environment, setEnvironment] = useState<'camp' | 'studio'>('studio');
  const [wipers, setWipers] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [conceptsOpen, setConceptsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [sequence, setSequence] = useState(false);
  const [view, setView] = useState('hero');
  const [exportView, setExportView] = useState<DrawingExportViewId>('entry');
  // Same default-off switch as the other quick entries. The query only
  // reveals the exporter for review; it does not change SHOW_QUICK_ENTRIES.
  const drawingExportPreview = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get('drawing-export') === '1',
    () => false,
  );
  const [elapsed, setElapsed] = useState(0);
  const [wrapState, setWrapState] = useState<WrapEditState | null>(null);
  const applyVersion = useRef(0);
  const vehicle = useRef<VehicleHandle>(null);
  const generation = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = useRef(options);
  const langRef = useRef(lang);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const showDrawingExport = SHOW_QUICK_ENTRIES || drawingExportPreview;
  const nameOf = (id: string) => partName(id, lang);
  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);
  const stopSequence = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSequence(false);
  }, []);
  useEffect(() => {
    void fetch('/api/status')
      .then((r) => r.json())
      .then((d: unknown) =>
        setConfigured(Boolean((d as { configured?: boolean }).configured)),
      )
      .catch(() => setConfigured(false));
    return () => {
      generation.current?.abort();
      timers.current.forEach(clearTimeout);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);
  const applyDesign = async (sticker: Sticker) => {
    if (!ready || !vehicle.current)
      throw Error(t(langRef.current, 'error.waitVehicle'));
    const version = ++applyVersion.current;
    setApplying(true);
    setSelected(sticker.id);
    setError('');
    try {
      await vehicle.current.applySticker(sticker);
      if (version !== applyVersion.current)
        throw new DOMException('Superseded by a newer action', 'AbortError');
      return { id: sticker.id, name: sticker.name, applied: true };
    } finally {
      if (version === applyVersion.current) setApplying(false);
    }
  };
  const apply = async (id: string) => {
    if (generation.current)
      throw Error(t(langRef.current, 'error.generatingBusy'));
    const sticker = optionsRef.current.find((s) => s.id === id);
    if (!sticker) throw Error(t(langRef.current, 'error.designNotFound'));
    return applyDesign(sticker);
  };
  const chooseDesign = (sticker: Sticker) => {
    if (busy || !ready) return;
    if (applied?.id === sticker.id && !applying) {
      setSelected(sticker.id);
      return;
    }
    void applyDesign(sticker).catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
  };
  const generate = async (
    description = prompt,
    externalSignal?: AbortSignal,
  ) => {
    if (generation.current || applying)
      throw Error(t(langRef.current, 'error.busyWait'));
    if (!ready) throw Error(t(langRef.current, 'error.waitVehicle'));
    const trimmed = description.trim();
    if (!trimmed) throw Error(t(langRef.current, 'error.writePrompt'));
    stopSequence();
    setToast('');
    setPrompt(description);
    setElapsed(0);
    setBusy(true);
    setError('');
    setSlots({ 0: 'waiting', 1: 'waiting', 2: 'waiting', 3: 'waiting' });
    const abort = new AbortController();
    generation.current = abort;
    let received: Sticker[] = [];
    let lastFailure = '';
    let complete = false;
    const externalAbort = () => abort.abort();
    externalSignal?.addEventListener('abort', externalAbort, { once: true });
    if (externalSignal?.aborted) abort.abort();
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed, lang: langRef.current }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const d = (await response.json()) as { code?: string; error?: string };
        if (d.code === 'AI_NOT_CONFIGURED') setConfigured(false);
        throw Error(d.error || t(langRef.current, 'error.generateFailedRetry'));
      }
      if (!response.body) throw Error(t(langRef.current, 'error.noStreamData'));
      received = await readStickerBatch(
        response.body,
        (event, ordered) => {
          if (event.type === 'progress')
            setSlots((s) => ({ ...s, [event.index]: 'drawing' }));
          if (event.type === 'error') {
            lastFailure = event.message;
            setSlots((s) => ({ ...s, [event.index]: 'failed' }));
            setError(event.message);
          }
          if (event.type === 'variant') {
            received = ordered;
            setOptions(ordered);
            setSlots((s) => ({ ...s, [event.index]: 'done' }));
          }
        },
        abort.signal,
        langRef.current,
      );
      abort.signal.throwIfAborted();
      if (!received.length)
        throw Error(lastFailure || t(langRef.current, 'error.noDesigns'));
      complete = true;
      setBusy(false);
      try {
        await applyDesign(received[0]);
      } catch (e) {
        if ((e as Error).name !== 'AbortError')
          setError(t(langRef.current, 'error.applyAfterGenerate'));
      }
      return received.map(({ id, name }) => ({ id, name }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        announce(t(langRef.current, 'toast.stopped'));
        return received.map(({ id, name }) => ({ id, name }));
      }
      const message =
        e instanceof Error
          ? e.message
          : t(langRef.current, 'error.generationFailed');
      setError(message);
      throw Error(message);
    } finally {
      externalSignal?.removeEventListener('abort', externalAbort);
      setBusy(false);
      generation.current = null;
      if (!complete && received.length)
        announce(t(langRef.current, 'toast.kept'));
    }
  };
  const setPart = useCallback(
    (id: string, on: boolean) => {
      stopSequence();
      setParts((p) => ({ ...p, [id]: on }));
      announce(
        `${t(langRef.current, on ? 'toast.partOpened' : 'toast.partClosed', { name: partName(id, langRef.current) })}${id === 'entry-door' && on ? ' · 180°' : ''}`,
      );
    },
    [announce, stopSequence],
  );
  const pick = useCallback(
    (id: string) => {
      if (id.startsWith('wiper')) {
        setWipers((v) => !v);
        announce(t(langRef.current, 'toast.wipers'));
        return;
      }
      setPart(id, !parts[id]);
    },
    [parts, setPart, announce],
  );
  const changeView = useCallback((value: string) => {
    if (!['hero', 'entry', 'driver', 'front', 'rear'].includes(value))
      throw Error(t(langRef.current, 'error.unknownView'));
    setView(value);
    vehicle.current?.setView(value);
  }, []);
  const exportThroughGate = useCallback((viewId: string) => {
    try {
      return requestDrawingExport(viewId, {
        generationActive: generation.current !== null,
        exportDrawing: (id) => vehicle.current?.exportDrawing(id),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'export-while-generating'
      )
        throw Error(t(langRef.current, 'export.rejectedGenerating'));
      if (error instanceof Error && error.message === 'model-not-ready')
        throw Error(t(langRef.current, 'export.notReady'));
      throw error;
    }
  }, []);
  const downloadDrawing = useCallback(() => {
    try {
      const file = exportThroughGate(exportView);
      const link = document.createElement('a');
      link.href = file.dataUrl;
      link.download = file.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      announce(
        error instanceof Error
          ? error.message
          : t(langRef.current, 'export.failed'),
      );
    }
  }, [announce, exportThroughGate, exportView]);
  useEffect(() => {
    if (!drawingExportPreview) return;
    const host = window as Window & {
      __drawingExport?: {
        exportDrawing: (viewId: string) => {
          dataUrl: string;
          filename: string;
        };
        getState: () => unknown;
      };
    };
    host.__drawingExport = {
      exportDrawing: (viewId) => exportThroughGate(viewId),
      getState: () => vehicle.current?.getState() ?? null,
    };
    return () => {
      delete host.__drawingExport;
    };
  }, [drawingExportPreview, exportThroughGate]);
  const camp = () => {
    stopSequence();
    setSequence(true);
    setEnvironment('camp');
    setParts((p) => ({ ...p, 'entry-door': true }));
    (meta?.motions.filter((m) => m.id.startsWith('window')) || []).forEach(
      (m, i) => {
        timers.current.push(
          window.setTimeout(
            () => setParts((p) => ({ ...p, [m.id]: true })),
            220 + i * 100,
          ),
        );
      },
    );
    timers.current.push(
      window.setTimeout(
        () => setParts((p) => ({ ...p, rooflight: true })),
        680,
      ),
    );
    timers.current.push(
      window.setTimeout(() => setParts((p) => ({ ...p, awning: true })), 1050),
    );
    timers.current.push(
      window.setTimeout(() => {
        setSequence(false);
        announce(t(lang, 'toast.campReady'));
      }, 2600),
    );
  };
  const closeAll = () => {
    stopSequence();
    setParts((p) => ({ ...p, awning: false }));
    timers.current.push(window.setTimeout(() => setParts({}), 260));
    announce(t(lang, 'toast.closedAll'));
  };
  const clearSticker = async () => {
    applyVersion.current++;
    setApplying(false);
    await vehicle.current?.applySticker(null);
    setApplied(null);
    setPresentation(palette ? 'render' : 'drawing');
    setSelected(null);
    announce(t(lang, 'toast.cleared'));
  };
  const toggleWindows = () => {
    stopSequence();
    const windows =
      meta?.motions.filter((m) => m.id.startsWith('window')) || [];
    const on = !windows.every((m) => parts[m.id]);
    windows.forEach((m, i) =>
      timers.current.push(
        window.setTimeout(
          () => setParts((p) => ({ ...p, [m.id]: on })),
          i * 75,
        ),
      ),
    );
    announce(t(lang, on ? 'toast.windowsOpened' : 'toast.windowsClosed'));
  };
  const setPartsFromTool = useCallback(
    async (next: Record<string, boolean>) => {
      stopSequence();
      const allowed = new Set(
        meta?.motions.filter((m) => !m.id.startsWith('wiper')).map((m) => m.id),
      );
      for (const [id, value] of Object.entries(next))
        if (!allowed.has(id) || typeof value !== 'boolean')
          throw Error(t(langRef.current, 'error.invalidPart'));
      setParts((p) => ({ ...p, ...next }));
      await new Promise((r) => setTimeout(r, 1550));
      return { parts: vehicle.current?.getState() };
    },
    [meta, stopSequence],
  );
  useStudioTools(
    {
      read: () => ({
        options: options.map(({ id, name, source }) => ({ id, name, source })),
        applied: applied ? { id: applied.id, name: applied.name } : null,
        selected,
        parts,
        availableParts: meta?.motions
          .filter((m) => !m.id.startsWith('wiper'))
          .map((m) => ({ id: m.id, label: m.label })),
        ready,
        busy,
        applying,
        configured,
        view,
        environment,
        presentation,
        revealing: false,
        scene: vehicle.current?.getState(),
      }),
      generate,
      apply,
      setParts: setPartsFromTool,
      setView: changeView,
    },
    lang,
  );
  const selectedOption = options.find((s) => s.id === selected);
  const isSample = options.every((s) => s.source === 'sample');
  return (
    <main className="studio-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="MXGARAGE Wrap Studio">
          MX<span>G</span>ARAGE
          <span className="brand-dot" />
        </Link>
        <span className="studio-name">
          WRAP STUDIO <span className="beta">01</span>
        </span>
        <span className="top-caption">YOUR VAN. YOUR CANVAS.</span>
        <fieldset className="lang-switch" aria-label="Language / 语言">
          <button
            aria-pressed={lang === 'en'}
            className={lang === 'en' ? 'active' : ''}
            onClick={() => setLang('en')}
          >
            EN
          </button>
          <button
            aria-pressed={lang === 'zh'}
            className={lang === 'zh' ? 'active' : ''}
            onClick={() => setLang('zh')}
          >
            中文
          </button>
        </fieldset>
        <button
          aria-label={t(lang, 'header.resetAll')}
          className="reset-all"
          onClick={closeAll}
          disabled={!ready}
        >
          <RotateCcw size={14} />
          <span>{t(lang, 'header.resetAll')}</span>
        </button>
      </header>
      <div className="workspace">
        <aside className="design-panel">
          <div className="panel-heading">
            <span className="eyebrow">01 / MAKE IT YOURS</span>
            <h1>{t(lang, 'page.heroTitle')}</h1>
            <p>{t(lang, 'page.heroSub')}</p>
          </div>
          <div className="fold-section">
            <button
              type="button"
              className="fold-toggle"
              aria-expanded={promptOpen}
              onClick={() => setPromptOpen((v) => !v)}
            >
              <span className="fold-title">
                {t(lang, 'page.promptSectionToggle')}
              </span>
              <ChevronDown size={15} />
            </button>
            {promptOpen && (
              <>
                <label className="prompt-label" htmlFor="prompt">
                  {t(lang, 'page.promptLabel')} <Sparkles size={15} />
                </label>
                <div className="prompt-box">
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        (e.metaKey || e.ctrlKey) &&
                        e.key === 'Enter' &&
                        !busy &&
                        prompt.trim()
                      ) {
                        e.preventDefault();
                        void generate().catch(() => {});
                      }
                    }}
                    placeholder={t(lang, 'page.promptPlaceholder')}
                    maxLength={1000}
                    disabled={busy}
                  />
                  <span className="char-count">
                    {prompt.length} / 1000 <CornerDownLeft size={11} />
                  </span>
                </div>
                <div className="prompt-chips">
                  {INSPIRATIONS.map((item) => (
                    <button
                      key={item.id}
                      disabled={busy}
                      onClick={() => {
                        setPrompt(inspirationText(item, lang));
                        setError('');
                      }}
                    >
                      {inspirationLabel(item, lang)}
                      <MoveUpRight size={12} />
                    </button>
                  ))}
                </div>
                <button
                  className="generate-button"
                  disabled={busy || applying || !ready || !prompt.trim()}
                  onClick={() => void generate().catch(() => {})}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Sparkles size={18} />
                  )}
                  <span>
                    {busy
                      ? t(lang, 'page.generating')
                      : t(lang, 'page.generate')}
                  </span>
                  {busy ? (
                    <span className="generation-clock">{elapsed}s</span>
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
                {busy ? (
                  <output className="generation-progress">
                    <div className="progress-dots">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={
                            slots[i] === 'done'
                              ? 'done'
                              : slots[i] === 'drawing'
                                ? 'working'
                                : ''
                          }
                          title={t(lang, 'page.slotTitle', {
                            index: i + 1,
                            status: t(
                              lang,
                              `slot.${slots[i] ?? 'waiting'}` as StringKey,
                            ),
                          })}
                        >
                          {slots[i] === 'done' ? <Check size={11} /> : i + 1}
                        </span>
                      ))}
                    </div>
                    <button onClick={() => generation.current?.abort()}>
                      {t(lang, 'page.stop')}
                    </button>
                  </output>
                ) : (
                  <p className="ai-note">
                    <span
                      className={`status-dot ${configured ? 'connected' : ''}`}
                    />
                    {configured
                      ? t(lang, 'page.aiConnected')
                      : configured === false
                        ? t(lang, 'page.aiSamples')
                        : t(lang, 'page.aiConnecting')}
                  </p>
                )}
                {error && (
                  <div className="inline-error" role="alert">
                    <span>{error}</span>
                    <button
                      aria-label={t(lang, 'page.closeError')}
                      onClick={() => setError('')}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <section
            className="concept-section"
            aria-label={t(lang, 'page.conceptsAria')}
          >
            <button
              type="button"
              className="fold-toggle"
              aria-expanded={conceptsOpen}
              onClick={() => setConceptsOpen((v) => !v)}
            >
              <span className="fold-title">
                {isSample
                  ? t(lang, 'page.trySamples')
                  : t(lang, 'page.yourDesigns')}
              </span>
              <span className="fold-meta">
                {isSample
                  ? t(lang, 'page.samplesMeta')
                  : t(lang, 'page.designsMeta', { count: options.length })}
              </span>
              <ChevronDown size={15} />
            </button>
            {conceptsOpen && (
              <div className="concept-grid">
                {options.map((option, i) => (
                  <button
                    className={`concept-card ${selected === option.id ? 'selected' : ''}`}
                    key={option.id}
                    onClick={() => chooseDesign(option)}
                    disabled={busy || !ready}
                    aria-pressed={selected === option.id}
                    style={
                      {
                        '--concept-color': option.color,
                        '--card-index': i,
                      } as React.CSSProperties
                    }
                  >
                    <span className="concept-art">
                      <Image
                        unoptimized
                        width={640}
                        height={240}
                        src={option.image}
                        alt={t(lang, 'page.conceptAlt', {
                          name: stickerName(option, lang),
                        })}
                        loading="eager"
                      />
                    </span>
                    <span className="concept-info">
                      <span>{stickerName(option, lang)}</span>
                      <span className="selection-dot">
                        {selected === option.id && <Check size={10} />}
                      </span>
                    </span>
                    <span className="concept-subtitle">
                      {option.subtitle}
                      {applied?.id === option.id
                        ? t(lang, 'page.appliedSuffix')
                        : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <button
            className={`apply-button ${applied?.id === selected && selected ? 'is-applied' : ''}`}
            disabled={
              !selectedOption ||
              !ready ||
              busy ||
              applying ||
              applied?.id === selected
            }
            onClick={() =>
              selected && void apply(selected).catch((e) => setError(e.message))
            }
          >
            {applying ? (
              <LoaderCircle size={16} className="spin" />
            ) : applied?.id === selected && selected ? (
              <Check size={16} />
            ) : (
              <MoveUpRight size={16} />
            )}
            <span>
              {applying
                ? t(lang, 'page.applying')
                : applied?.id === selected && selected
                  ? t(lang, 'page.appliedToBody')
                  : selectedOption
                    ? t(lang, 'page.applyThis')
                    : t(lang, 'page.pickOne')}
            </span>
          </button>
          {applied && (
            <div className="direct-edit-note">
              <MousePointer2 size={15} />
              <div>
                <strong>{t(lang, 'page.directEditTitle')}</strong>
                <p>{t(lang, 'page.directEditHint')}</p>
              </div>
              <button
                className="clear-sticker"
                onClick={() => void clearSticker()}
              >
                {t(lang, 'page.clearSticker')}
              </button>
            </div>
          )}
          {applied && (
            <PlanInsights
              lang={lang}
              appliedName={stickerName(applied, lang)}
              placements={
                wrapState?.placements ?? [
                  { center: 0, height: 1.28, scale: 1 },
                  { center: 0, height: 1.28, scale: 1 },
                ]
              }
              aspect={wrapState?.aspect ?? DEFAULT_DECAL_ASPECT}
              body={wrapState?.body ?? VAN_WRAP_BODY}
            />
          )}
          <div className="panel-footer">
            <span className="tiny-line" />
            DESIGNED TO GO PLACES
            <ArrowUpRight size={15} />
            <Link className="body-lab-link" href="/body-lab">
              {t(lang, 'page.bodyLabLink')}
            </Link>
          </div>
        </aside>
        <div className={paletteStyles.sceneColumn}>
        <section
          className={`scene-panel ${presentation === 'drawing' ? 'is-drawing' : 'is-rendered'} ${busy ? 'is-generating' : ''}`}
          aria-label={t(lang, 'page.sceneAria')}
        >
          <VehicleScene
            ref={vehicle}
            lang={lang}
            generating={busy}
            presentation={presentation}
            palette={palette}
            onCommit={(sticker) => {
              setApplied(sticker);
              setPresentation(sticker || palette ? 'render' : 'drawing');
            }}
            parts={parts}
            wipers={wipers}
            environment={environment}
            onWrapEdit={setWrapState}
            onPick={pick}
            onReady={(m) => {
              setMeta(m);
              setReady(true);
            }}
          />
          <div className="scene-title">
            <span className="eyebrow">01 / SURFACE STUDY</span>
            <h2>MXGARAGE VAN</h2>
            <span>
              {applied ? applied.subtitle : t(lang, 'page.startBlank')}
            </span>
          </div>
          <div className="scene-toolbar">
            {showDrawingExport ? (
              <fieldset
                className="drawing-export"
                aria-label={t(lang, 'export.aria')}
              >
                <label>
                  {t(lang, 'export.label')}
                  <select
                    value={exportView}
                    aria-label={t(lang, 'export.label')}
                    onChange={(event) => {
                      const next = drawingExportView(event.target.value);
                      if (next) setExportView(next.id);
                    }}
                  >
                    {DRAWING_EXPORT_VIEWS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t(lang, item.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!ready || busy}
                  onClick={downloadDrawing}
                >
                  {t(lang, 'export.action')}
                </button>
              </fieldset>
            ) : null}
            {SHOW_QUICK_ENTRIES && (
              <div
                className="environment-switch"
                aria-label={t(lang, 'page.styleAria')}
              >
                <button
                  aria-label={t(lang, 'page.drawingMode')}
                  title={t(lang, 'page.drawingMode')}
                  disabled={applying}
                  className={presentation === 'drawing' ? 'active' : ''}
                  onClick={() => {
                    setPresentation('drawing');
                    setEnvironment('studio');
                  }}
                >
                  <ScanLine size={17} />
                </button>
                <button
                  aria-label={t(lang, 'page.materialPreview')}
                  title={t(lang, 'page.materialPreview')}
                  disabled={applying}
                  className={
                    environment === 'studio' && presentation === 'render'
                      ? 'active'
                      : ''
                  }
                  onClick={() => {
                    setEnvironment('studio');
                    setPresentation('render');
                  }}
                >
                  <Sun size={17} />
                </button>
                <button
                  aria-label={t(lang, 'page.campsite')}
                  title={t(lang, 'page.campsite')}
                  disabled={applying}
                  className={environment === 'camp' ? 'active' : ''}
                  onClick={() => {
                    setEnvironment('camp');
                    setPresentation('render');
                  }}
                >
                  <Trees size={17} />
                </button>
              </div>
            )}
            <button
              className="round-control"
              title={t(lang, 'page.resetView')}
              aria-label={t(lang, 'page.resetView')}
              onClick={() => changeView('hero')}
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="drawing-furniture" aria-hidden="true">
            <span className="sheet-index">VAN / 001</span>
            <span className="sheet-rule">BODY &amp; GRAPHIC STUDY</span>
            <span className="sheet-caption">DESCRIBE → GENERATE → APPLY</span>
            <i className="sheet-cross cross-a" />
            <i className="sheet-cross cross-b" />
          </div>
          {busy && (
            <output className="drawing-wait">
              <span className="wait-rhythm" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <strong>{t(lang, 'page.waitTitle')}</strong>
              <span>
                {t(lang, 'page.waitProgress', {
                  done: Object.values(slots).filter((v) => v === 'done').length,
                  elapsed,
                })}
              </span>
              <p>{t(lang, 'page.waitHint')}</p>
            </output>
          )}
          {toast && (
            <output className="scene-toast">
              <Check size={15} />
              {toast}
            </output>
          )}
          {SHOW_QUICK_ENTRIES && (
            <div className="interaction-dock">
              <div className="dock-heading">
                <span>{t(lang, 'page.dockHint')}</span>
                <button
                  disabled={!ready || sequence}
                  className="camp-button"
                  onClick={camp}
                >
                  {sequence ? (
                    <LoaderCircle size={13} className="spin" />
                  ) : (
                    <Trees size={13} />
                  )}
                  {t(lang, 'page.campButton')}
                </button>
              </div>
              <div className="part-buttons">
                <button
                  onClick={() => setPart('entry-door', !parts['entry-door'])}
                  disabled={!ready}
                  aria-pressed={!!parts['entry-door']}
                >
                  <DoorOpen size={16} />
                  {t(lang, 'page.entryDoor')}
                  <span>{parts['entry-door'] ? '180°' : '0°'}</span>
                </button>
                <button
                  onClick={toggleWindows}
                  disabled={!ready}
                  aria-pressed={
                    !!Object.entries(parts).find(
                      ([id, on]) => id.startsWith('window') && on,
                    )
                  }
                >
                  <PanelTopOpen size={16} />
                  {t(lang, 'page.windows')}
                </button>
                <button
                  onClick={() => setPart('rooflight', !parts.rooflight)}
                  disabled={!ready}
                  aria-pressed={!!parts.rooflight}
                >
                  <ScanLine size={16} />
                  {t(lang, 'page.rooflight')}
                </button>
                <button
                  onClick={() => setPart('awning', !parts.awning)}
                  disabled={!ready}
                  aria-pressed={!!parts.awning}
                >
                  <Wind size={16} />
                  {t(lang, 'page.awning')}
                </button>
                <button
                  className="more-parts"
                  aria-expanded={showMore}
                  aria-label={t(lang, 'page.moreParts')}
                  onClick={() => setShowMore((v) => !v)}
                >
                  <ChevronDown size={15} />
                </button>
              </div>
              {showMore && (
                <div className="more-part-panel">
                  {['cab-l', 'cab-r', 'slide-l', 'slide-r'].map((id) => (
                    <button
                      key={id}
                      disabled={!ready}
                      aria-pressed={!!parts[id]}
                      onClick={() => setPart(id, !parts[id])}
                    >
                      <span>{nameOf(id)}</span>
                      <span className={`toggle-track ${parts[id] ? 'on' : ''}`}>
                        <span />
                      </span>
                    </button>
                  ))}
                  <button
                    aria-pressed={wipers}
                    onClick={() => setWipers((v) => !v)}
                  >
                    <span>{t(lang, 'page.wiperNote')}</span>
                    <span className={`toggle-track ${wipers ? 'on' : ''}`}>
                      <span />
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="scene-bottom">
            <span>
              <MousePointer2 size={14} />
              {t(lang, 'page.orbitHint')}
            </span>
            {SHOW_QUICK_ENTRIES && (
              <div
                className="view-switch"
                aria-label={t(lang, 'page.viewsAria')}
              >
                {['hero', 'entry', 'driver', 'front', 'rear'].map((id) => (
                  <button
                    key={id}
                    onClick={() => changeView(id)}
                    aria-pressed={view === id}
                  >
                    {t(lang, VIEW_KEYS[id])}
                  </button>
                ))}
              </div>
            )}
            <span className="live-caption">
              <span />
              360° LIVE
            </span>
          </div>
        </section>
          <PalettePicker
            lang={lang}
            selected={palette}
            onSelect={(next) => {
              setPalette(next);
              setPresentation('render');
            }}
          />
        </div>
      </div>
    </main>
  );
}
