import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { STRINGS, type StringKey } from '../lib/i18n.ts';
import * as i18n from '../lib/i18n.ts';
import * as stickers from '../lib/stickers.ts';
import * as stickerStream from '../lib/sticker-stream.ts';
import * as planInsights from '../lib/plan-insights.ts';

/**
 * Renders the real homepage with a scene stub and an intercepted fetch.
 * Button clicks and Ctrl/Cmd+Enter go through app/page.tsx; nothing here
 * reimplements the gate. /api/generate is answered from memory.
 */

const nodeRequire = createRequire(import.meta.url);

const COPY = {
  en: {
    notConfigured: 'AI design is currently unavailable. Try a sample.',
    checking: 'Checking whether generation is available',
    failed: 'Could not read generation status. Try a sample first.',
    ready: 'Design service ready · about 1–3 min',
  },
  zh: {
    notConfigured: 'AI 设计暂不可用，先试试样例',
    checking: '正在确认生成服务是否可用',
    failed: '暂时无法确认生成服务，请先试试样例',
    ready: '设计服务已就绪 · 约 1–3 分钟',
  },
} as const;

const STATUS_KEYS = [
  'page.aiConnected',
  'page.aiSamples',
  'page.aiChecking',
  'page.aiStatusFailed',
] as const;

class MiniNode extends EventTarget {
  nodeType: number;
  nodeName: string;
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  ownerDocument: MiniDocument | null = null;
  attributes = new Map<string, string>();
  nodeValue = '';
  listeners: Array<{
    type: string;
    listener: EventListener;
    capture: boolean;
  }> = [];
  style: { setProperty: (name: string, value: string) => void } &
    Record<string, string>;

  constructor(nodeType: number, nodeName: string) {
    super();
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    const store: Record<string, string> = {};
    this.style = new Proxy(store, {
      get: (target, key) =>
        key === 'setProperty'
          ? (name: string, value: string) => {
              target[name] = value;
            }
          : target[String(key)],
      set: (target, key, value) => {
        target[String(key)] = String(value);
        return true;
      },
    }) as MiniNode['style'];
  }

  get tagName() {
    return this.nodeName;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get textContent() {
    if (this.nodeType === 3) return this.nodeValue;
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes = [];
    if (value) {
      const text = this.ownerDocument?.createTextNode(value);
      if (text) {
        text.parentNode = this;
        this.childNodes.push(text);
      }
    }
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  appendChild<T extends MiniNode>(child: T) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends MiniNode>(child: T, before: MiniNode | null) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild<T extends MiniNode>(child: T) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === 'disabled') this.disabled = true;
    if (name === 'value') this.value = String(value);
  }

  getAttribute(name: string) {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'disabled') this.disabled = false;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  disabled = false;
  value = '';
  defaultValue = '';
  checked = false;
  innerHTML = '';

  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) {
    const capture =
      options === true ||
      (typeof options === 'object' && options.capture === true);
    this.listeners.push({
      type,
      listener,
      capture,
    });
    super.addEventListener(type, listener, options);
  }

  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) {
    this.listeners = this.listeners.filter(
      (entry) => entry.type !== type || entry.listener !== listener,
    );
    super.removeEventListener(type, listener, options);
  }

  dispatchEvent(event: Event) {
    const path: MiniNode[] = [this];
    let parent = this.parentNode;
    while (parent) {
      path.push(parent);
      parent = parent.parentNode;
    }
    Object.defineProperty(event, 'target', { configurable: true, value: this });
    for (const node of path) {
      Object.defineProperty(event, 'currentTarget', {
        configurable: true,
        value: node,
      });
      for (const entry of node.listeners) {
        if (!entry.capture) entry.listener.call(node, event);
      }
    }
    return !event.defaultPrevented;
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  contains(other: MiniNode | null) {
    let current = other;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
}

class MiniDocument extends MiniNode {
  documentElement: MiniNode;
  body: MiniNode;
  activeElement: MiniNode;
  defaultView: MiniNode | null = null;
  visibilityState = 'visible';
  oninput: (() => void) | null = () => {};

  constructor() {
    super(9, '#document');
    this.ownerDocument = this;
    this.documentElement = new MiniNode(1, 'HTML');
    this.body = new MiniNode(1, 'BODY');
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(name: string) {
    const element = new MiniNode(1, name.toUpperCase());
    element.ownerDocument = this;
    return element;
  }

  createElementNS(_namespace: string, name: string) {
    return this.createElement(name);
  }

  createTextNode(value: string) {
    const text = new MiniNode(3, '#text');
    text.nodeValue = String(value);
    text.ownerDocument = this;
    return text;
  }
}

class ClickEvent extends Event {
  button = 0;
  buttons = 0;
  clientX = 0;
  clientY = 0;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey = false;
  shiftKey = false;

  constructor(
    type: string,
    init: EventInit & { metaKey?: boolean; ctrlKey?: boolean } = {},
  ) {
    super(type, init);
    this.metaKey = !!init.metaKey;
    this.ctrlKey = !!init.ctrlKey;
  }
}

class KeyEvent extends Event {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey = false;
  shiftKey = false;
  keyCode = 0;
  which = 0;

  constructor(
    type: string,
    init: EventInit & {
      key?: string;
      code?: string;
      metaKey?: boolean;
      ctrlKey?: boolean;
    } = {},
  ) {
    super(type, init);
    this.key = init.key ?? '';
    this.code = init.code ?? '';
    this.metaKey = !!init.metaKey;
    this.ctrlKey = !!init.ctrlKey;
  }
}

class WindowShim extends MiniNode {
  document: MiniDocument;
  constructor(doc: MiniDocument) {
    super(0, '#window');
    this.document = doc;
  }
}

const documentShim = new MiniDocument();
const windowShim = new WindowShim(documentShim);
documentShim.defaultView = windowShim;
Object.assign(windowShim, {
  document: documentShim,
  HTMLIFrameElement: class HTMLIFrameElement {},
  HTMLElement: MiniNode,
  Element: MiniNode,
  Node: MiniNode,
  getSelection: () => null,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: clearTimeout,
});
Object.assign(globalThis, {
  window: windowShim,
  document: documentShim,
  MouseEvent: ClickEvent,
  KeyboardEvent: KeyEvent,
  HTMLElement: MiniNode,
  Element: MiniNode,
  Node: MiniNode,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const React = nodeRequire('react') as typeof import('react');
const { createRoot } = nodeRequire(
  'react-dom/client',
) as typeof import('react-dom/client');
const { act } = React;

type StatusStep =
  | { type: 'hang' }
  | { type: 'reject' }
  | { type: 'json'; body: unknown }
  | { type: 'http'; status: number; body: string };

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

function generatedResponse() {
  const sticker = {
    id: 'generated-1',
    name: 'Generated',
    subtitle: 'GEN',
    image: '/stickers/generated.png',
    color: '#173cbb',
    source: 'generated',
  };
  const body = [
    JSON.stringify({ type: 'start' }),
    JSON.stringify({ type: 'variant', index: 0, sticker }),
    JSON.stringify({ type: 'complete' }),
    '',
  ].join('\n');
  return new Response(body, { status: 200 });
}

function statusResponse(step: StatusStep) {
  if (step.type === 'hang') return new Promise<Response>(() => {});
  if (step.type === 'reject') return Promise.reject(new Error('status failed'));
  if (step.type === 'http')
    return Promise.resolve(
      new Response(step.body, {
        status: step.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  return Promise.resolve(Response.json(step.body));
}

const applies: { count: number } = { count: 0 };

const VehicleScene = React.forwardRef(function VehicleScene(
  props: { onReady: (meta: { motions: [] }) => void },
  ref: React.Ref<{
    applySticker: (sticker: unknown) => Promise<void>;
    setView: (view: string) => void;
    getState: () => Record<string, never>;
  }>,
) {
  React.useImperativeHandle(ref, () => ({
    applySticker: async () => {
      applies.count += 1;
    },
    setView() {},
    getState: () => ({}),
  }));
  const onReady = React.useRef(props.onReady);
  React.useEffect(() => {
    onReady.current({ motions: [] });
  }, []);
  return React.createElement('div', { 'data-scene': 'stub' });
});

function namespace(mod: object) {
  return { __esModule: true, ...mod };
}

function loadPage() {
  const source = fs.readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const output = ts
    .transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: 'page.tsx',
    })
    .outputText.replace(/\brequire\(/g, 'load(');
  const modules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': nodeRequire('react/jsx-runtime'),
    'react/jsx-dev-runtime': nodeRequire('react/jsx-dev-runtime'),
    'next/link': {
      __esModule: true,
      default: (props: { children?: React.ReactNode; href?: string }) =>
        React.createElement('a', props, props.children),
    },
    'next/image': {
      __esModule: true,
      default: (props: { alt?: string; src?: string }) =>
        React.createElement('img', { alt: props.alt, src: props.src }),
    },
    'lucide-react': new Proxy(
      { __esModule: true },
      { get: (target, key) => (key in target ? target[key as never] : () => null) },
    ),
    '@/components/studio/VehicleScene': {
      __esModule: true,
      default: VehicleScene,
    },
    '@/components/studio/PlanInsights': { __esModule: true, default: () => null },
    '@/components/studio/use-studio-tools': {
      __esModule: true,
      useStudioTools() {},
    },
    '@/lib/i18n': namespace(i18n),
    '@/lib/stickers': namespace(stickers),
    '@/lib/sticker-stream': namespace(stickerStream),
    '@/lib/plan-insights': namespace(planInsights),
  };
  const pageModule: { exports: { default?: React.ComponentType } } = {
    exports: {},
  };
  const run = compileFunction(output, ['load', 'pageModule', 'exports']);
  run(
    (id: string) => {
      if (id in modules) return modules[id];
      throw new Error(`unexpected import ${id}`);
    },
    pageModule,
    pageModule.exports,
  );
  if (!pageModule.exports.default)
    throw new Error('homepage has no default export');
  return pageModule.exports.default;
}

const Home = loadPage();

function walk(node: MiniNode, acc: MiniNode[] = []) {
  acc.push(node);
  for (const child of node.childNodes) walk(child, acc);
  return acc;
}

function hasClass(node: MiniNode, name: string) {
  return node.className.split(/\s+/).includes(name);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(steps: StatusStep[]) {
  const calls: FetchCall[] = [];
  let statusIndex = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      init?.method ?? (typeof input === 'string' ? 'GET' : input instanceof URL ? 'GET' : input.method)
    ).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });
    if (url.includes('/api/generate')) return generatedResponse();
    if (url.includes('/api/status')) {
      const step = steps[Math.min(statusIndex, steps.length - 1)];
      statusIndex += 1;
      return statusResponse(step);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;

  const host = documentShim.createElement('div');
  documentShim.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  await act(async () => {
    root.render(React.createElement(Home));
  });
  await flush();

  const buttons = () =>
    walk(host).filter((node) => node.tagName === 'BUTTON');
  const labeled = (text: string) =>
    buttons().find((node) => node.textContent.includes(text));
  const textarea = () => {
    const node = walk(host).find((item) => item.tagName === 'TEXTAREA');
    if (!node) throw new Error('prompt textarea is missing');
    return node;
  };
  const generateButton = () => {
    const node = walk(host).find((item) => hasClass(item, 'generate-button'));
    if (!node) throw new Error('generate button is missing');
    return node;
  };
  const note = () => {
    const node = walk(host).find((item) => hasClass(item, 'ai-note'));
    if (!node) throw new Error('status note is missing');
    return node.textContent;
  };

  return {
    calls,
    note,
    promptValue: () => textarea().value,
    textareaDisabled: () =>
      textarea().disabled === true || textarea().hasAttribute('disabled'),
    buttonDisabled: () =>
      generateButton().disabled === true ||
      generateButton().hasAttribute('disabled'),
    async openPrompt() {
      const toggle = walk(host).find(
        (node) => node.tagName === 'BUTTON' && hasClass(node, 'fold-toggle'),
      );
      if (!toggle) throw new Error('prompt toggle is missing');
      await act(async () => {
        toggle.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    async fillFromSample() {
      const chip = labeled('Retro Coast') ?? labeled('复古海岸');
      if (!chip) throw new Error('sample inspiration is missing');
      assert.equal(chip.hasAttribute('disabled'), false);
      await act(async () => {
        chip.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
      });
      assert.ok(textarea().value.trim().length > 0);
    },
    async pressShortcut(modifier: 'meta' | 'ctrl') {
      await act(async () => {
        textarea().dispatchEvent(
          new KeyEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            metaKey: modifier === 'meta',
            ctrlKey: modifier === 'ctrl',
          }),
        );
      });
      await flush();
    },
    async clickGenerate() {
      await act(async () => {
        generateButton().dispatchEvent(
          new ClickEvent('click', { bubbles: true, cancelable: true }),
        );
      });
      await flush();
    },
    generateCount() {
      return calls.filter((call) => call.url.includes('/api/generate')).length;
    },
    async focusWindow() {
      await act(async () => {
        windowShim.dispatchEvent(new Event('focus'));
      });
      await flush();
    },
    async openSamples() {
      const toggles = walk(host).filter(
        (node) => node.tagName === 'BUTTON' && hasClass(node, 'fold-toggle'),
      );
      const toggle = toggles[1];
      if (!toggle) throw new Error('sample toggle is missing');
      await act(async () => {
        toggle.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    async clickSample() {
      const card = labeled('Coast Club') ?? labeled('海岸俱乐部');
      if (!card) throw new Error('sample card is missing');
      assert.equal(card.hasAttribute('disabled'), false);
      const before = applies.count;
      await act(async () => {
        card.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
      });
      await flush();
      assert.equal(applies.count, before + 1);
    },
    async switchLanguage(label: string) {
      const button = labeled(label);
      if (!button) throw new Error(`language button ${label} is missing`);
      await act(async () => {
        button.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      host.parentNode?.removeChild(host);
      globalThis.fetch = previous;
    },
  };
}

function dictionary(lang: 'en' | 'zh') {
  return STRINGS[lang] as Record<string, string>;
}

void test('status copy is bilingual and does not name a provider or a server', () => {
  for (const lang of ['en', 'zh'] as const) {
    for (const key of STATUS_KEYS) {
      const value = dictionary(lang)[key];
      assert.equal(typeof value, 'string', `${lang} ${key}`);
      assert.ok(!/openai/i.test(value), `${lang} ${key} names a provider`);
      assert.ok(!/\bserver\b/i.test(value), `${lang} ${key} says server`);
      assert.ok(!value.includes('服务器'), `${lang} ${key} says 服务器`);
      assert.ok(!value.includes('密钥'), `${lang} ${key} mentions a key`);
    }
    assert.equal(dictionary(lang)['page.aiSamples'], COPY[lang].notConfigured);
    assert.equal(dictionary(lang)['page.aiChecking'], COPY[lang].checking);
    assert.equal(dictionary(lang)['page.aiStatusFailed'], COPY[lang].failed);
    assert.equal(dictionary(lang)['page.aiConnected'], COPY[lang].ready);
  }
  const joined = Object.values(STRINGS.en).concat(Object.values(STRINGS.zh)).join('\n');
  assert.equal(joined.includes('即将开放'), false);
  assert.equal(/opens soon/i.test(joined), false);
  assert.equal(joined.includes('正在连接设计工作台'), false);
  assert.equal(joined.includes('Connecting to the design studio'), false);
  assert.equal(joined.includes('awaiting server setup'), false);
  assert.equal('page.aiChecking' in STRINGS.en && 'page.aiChecking' in STRINGS.zh, true);
  assert.equal('page.aiConnecting' in STRINGS.en || 'page.aiConnecting' in STRINGS.zh, false);
});

void test('configured false disables the button and the shortcut together', async () => {
  const view = await mount([{ type: 'json', body: { configured: false } }]);
  try {
    await view.openPrompt();
    await view.fillFromSample();
    const prompt = view.promptValue();
    assert.equal(view.buttonDisabled(), true);
    assert.equal(view.textareaDisabled(), false);
    assert.equal(view.generateCount(), 0);
    await view.pressShortcut('meta');
    await view.clickGenerate();
    await view.pressShortcut('ctrl');
    assert.equal(view.generateCount(), 0);
    assert.equal(view.note(), COPY.en.notConfigured);
    assert.equal(view.promptValue(), prompt);
    await view.switchLanguage('中文');
    assert.equal(view.note(), COPY.zh.notConfigured);
    assert.equal(view.buttonDisabled(), true);
    assert.equal(view.promptValue(), prompt);
    await view.pressShortcut('meta');
    assert.equal(view.generateCount(), 0);
  } finally {
    await view.cleanup();
  }
});

void test('loading disables the button and the shortcut and shows a checking message', async () => {
  const view = await mount([{ type: 'hang' }]);
  try {
    await view.openPrompt();
    await view.fillFromSample();
    assert.equal(view.buttonDisabled(), true);
    assert.equal(view.note(), COPY.en.checking);
    assert.equal(view.note().includes('Connecting to the design studio'), false);
    assert.equal(view.textareaDisabled(), false);
    await view.pressShortcut('meta');
    await view.clickGenerate();
    assert.equal(view.generateCount(), 0);
    await view.switchLanguage('中文');
    assert.equal(view.note(), COPY.zh.checking);
    assert.equal(view.buttonDisabled(), true);
    await view.pressShortcut('ctrl');
    assert.equal(view.generateCount(), 0);
  } finally {
    await view.cleanup();
  }
});

void test('a failed status read disables generation and is distinct from not configured', async () => {
  for (const step of [
    { type: 'reject' } as const,
    { type: 'http', status: 500, body: '{"configured":true}' } as const,
    { type: 'http', status: 200, body: 'not-json' } as const,
    { type: 'json', body: { ready: true } } as const,
  ]) {
    const view = await mount([step]);
    try {
      await view.openPrompt();
      await view.fillFromSample();
      assert.equal(view.buttonDisabled(), true);
      assert.equal(view.note(), COPY.en.failed);
      assert.notEqual(view.note(), COPY.en.notConfigured);
      await view.pressShortcut('meta');
      await view.clickGenerate();
      assert.equal(view.generateCount(), 0);
      assert.equal(view.textareaDisabled(), false);
    } finally {
      await view.cleanup();
    }
  }
});

void test('samples and the typed prompt stay usable while generation is disabled', async () => {
  const view = await mount([{ type: 'json', body: { configured: false } }]);
  try {
    await view.openPrompt();
    await view.fillFromSample();
    const prompt = view.promptValue();
    await view.openSamples();
    await view.clickSample();
    assert.equal(view.generateCount(), 0);
    assert.equal(view.promptValue(), prompt);
    assert.equal(view.buttonDisabled(), true);
  } finally {
    await view.cleanup();
  }
});

void test('configured true keeps generation usable from the button and the shortcut', async () => {
  const view = await mount([{ type: 'json', body: { configured: true } }]);
  try {
    await view.openPrompt();
    await view.fillFromSample();
    const prompt = view.promptValue();
    assert.equal(view.buttonDisabled(), false);
    await view.pressShortcut('ctrl');
    assert.equal(view.generateCount(), 1);
    const call = view.calls.find((item) => item.url.includes('/api/generate'));
    assert.ok(call);
    assert.equal(call.method, 'POST');
    const body = JSON.parse(call.body ?? '{}') as { prompt?: string; lang?: string };
    assert.equal(body.prompt, prompt);
    assert.equal(body.lang, 'en');
    assert.equal(view.promptValue(), prompt);
    assert.equal(view.note(), COPY.en.ready);
  } finally {
    await view.cleanup();
  }
  const clicked = await mount([{ type: 'json', body: { configured: true } }]);
  try {
    await clicked.openPrompt();
    await clicked.fillFromSample();
    assert.equal(clicked.buttonDisabled(), false);
    await clicked.clickGenerate();
    assert.equal(clicked.generateCount(), 1);
    await clicked.switchLanguage('中文');
    assert.equal(clicked.note(), COPY.zh.ready);
  } finally {
    await clicked.cleanup();
  }
});

void test('generation becomes usable again after status recovers to configured true', async () => {
  const view = await mount([
    { type: 'json', body: { configured: false } },
    { type: 'json', body: { configured: true } },
  ]);
  try {
    await view.openPrompt();
    await view.fillFromSample();
    const prompt = view.promptValue();
    assert.equal(view.buttonDisabled(), true);
    await view.pressShortcut('meta');
    assert.equal(view.generateCount(), 0);
    await view.focusWindow();
    assert.equal(view.note(), COPY.en.ready);
    assert.equal(view.buttonDisabled(), false);
    assert.equal(view.promptValue(), prompt);
    assert.equal(view.textareaDisabled(), false);
    await view.pressShortcut('meta');
    assert.equal(view.generateCount(), 1);
    const call = view.calls.find((item) => item.url.includes('/api/generate'));
    assert.equal(JSON.parse(call?.body ?? '{}').prompt, prompt);
  } finally {
    await view.cleanup();
  }
});

void test('a slow failed read cannot disable generation after a newer ready status', async () => {
  let release: ((response: Response) => void) | null = null;
  const calls: FetchCall[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    if (url.includes('/api/generate')) return generatedResponse();
    if (!release) {
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return Response.json({ configured: true });
  }) as typeof fetch;
  const host = documentShim.createElement('div');
  documentShim.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(async () => {
      root.render(React.createElement(Home));
    });
    await flush();
    const toggle = walk(host).find(
      (node) => node.tagName === 'BUTTON' && hasClass(node, 'fold-toggle'),
    );
    assert.ok(toggle);
    await act(async () => {
      toggle.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
    });
    const chip = walk(host).find(
      (node) => node.tagName === 'BUTTON' && node.textContent.includes('Retro Coast'),
    );
    assert.ok(chip);
    await act(async () => {
      chip.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
    });
    const button = walk(host).find((node) => hasClass(node, 'generate-button'));
    const note = walk(host).find((node) => hasClass(node, 'ai-note'));
    assert.ok(button);
    assert.ok(note);
    assert.equal(button.hasAttribute('disabled') || button.disabled, true);
    assert.equal(note.textContent, COPY.en.checking);
    await act(async () => {
      windowShim.dispatchEvent(new Event('focus'));
    });
    await flush();
    assert.equal(note.textContent, COPY.en.ready);
    assert.equal(button.hasAttribute('disabled') || button.disabled, false);
    assert.ok(release);
    await act(async () => {
      release?.(Response.json({ configured: false }));
    });
    await flush();
    assert.equal(note.textContent, COPY.en.ready);
    assert.equal(button.hasAttribute('disabled') || button.disabled, false);
    const textarea = walk(host).find((node) => node.tagName === 'TEXTAREA');
    assert.ok(textarea);
    await act(async () => {
      textarea.dispatchEvent(
        new KeyEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      );
    });
    await flush();
    assert.equal(calls.filter((call) => call.url.includes('/api/generate')).length, 1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.parentNode?.removeChild(host);
    globalThis.fetch = previous;
  }
});

void test('a late ready status cannot re-enable generation after AI_NOT_CONFIGURED', async () => {
  let releaseStatus: ((response: Response) => void) | null = null;
  let statusCount = 0;
  const calls: FetchCall[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    if (url.includes('/api/generate')) {
      return new Response(
        JSON.stringify({ code: 'AI_NOT_CONFIGURED', error: 'unavailable' }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/api/status')) {
      statusCount += 1;
      if (statusCount === 1) return Response.json({ configured: true });
      if (statusCount === 2) {
        return new Promise<Response>((resolve) => {
          releaseStatus = resolve;
        });
      }
      return Response.json({ configured: true });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const host = documentShim.createElement('div');
  documentShim.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const buttonOf = () => {
    const node = walk(host).find((item) => hasClass(item, 'generate-button'));
    if (!node) throw new Error('generate button is missing');
    return node;
  };
  const noteOf = () => walk(host).find((item) => hasClass(item, 'ai-note'));
  const disabled = () =>
    buttonOf().disabled === true || buttonOf().hasAttribute('disabled');
  const generateCount = () =>
    calls.filter((call) => call.url.includes('/api/generate')).length;
  try {
    await act(async () => {
      root.render(React.createElement(Home));
    });
    await flush();
    const toggle = walk(host).find(
      (node) => node.tagName === 'BUTTON' && hasClass(node, 'fold-toggle'),
    );
    assert.ok(toggle);
    await act(async () => {
      toggle.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
    });
    const chip = walk(host).find(
      (node) => node.tagName === 'BUTTON' && node.textContent.includes('Retro Coast'),
    );
    assert.ok(chip);
    await act(async () => {
      chip.dispatchEvent(new ClickEvent('click', { bubbles: true, cancelable: true }));
    });
    assert.equal(disabled(), false);
    assert.equal(noteOf()?.textContent, COPY.en.ready);
    await act(async () => {
      windowShim.dispatchEvent(new Event('focus'));
    });
    assert.equal(statusCount, 2);
    assert.ok(releaseStatus);
    await act(async () => {
      buttonOf().dispatchEvent(
        new ClickEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    let settled = false;
    for (let i = 0; i < 20 && !settled; i += 1) {
      await flush();
      settled =
        noteOf()?.textContent === COPY.en.notConfigured &&
        disabled() &&
        generateCount() === 1;
      if (!settled) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(settled, true);
    assert.equal(generateCount(), 1);
    await act(async () => {
      releaseStatus?.(Response.json({ configured: true }));
    });
    await flush();
    await flush();
    assert.equal(disabled(), true);
    assert.equal(noteOf()?.textContent, COPY.en.notConfigured);
    assert.equal(generateCount(), 1);
    const textarea = walk(host).find((node) => node.tagName === 'TEXTAREA');
    assert.ok(textarea);
    await act(async () => {
      textarea.dispatchEvent(
        new KeyEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      );
    });
    await flush();
    assert.equal(generateCount(), 1);
    assert.equal(disabled(), true);
    await act(async () => {
      windowShim.dispatchEvent(new Event('focus'));
    });
    await flush();
    await flush();
    assert.equal(noteOf()?.textContent, COPY.en.ready);
    assert.equal(disabled(), false);
    assert.equal(generateCount(), 1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.parentNode?.removeChild(host);
    globalThis.fetch = previous;
  }
});

void test('status dictionary keys stay paired across languages', () => {
  for (const key of STATUS_KEYS) {
    assert.equal(typeof STRINGS.en[key as StringKey], 'string');
    assert.equal(typeof STRINGS.zh[key as StringKey], 'string');
  }
});
