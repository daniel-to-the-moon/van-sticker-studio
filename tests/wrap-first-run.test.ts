import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { parseProject } from '../lib/free-wrap.ts';

type StudioProps = {
  initialAdvanced?: boolean;
  initialChassis?: string;
  initialProject?: unknown;
};

type FirstRunModule = typeof import('../components/studio/FirstRunShell.tsx');

const server = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': process.cwd() } },
  optimizeDeps: { noDiscovery: true },
  plugins: [
    {
      name: 'next-link-stub',
      resolveId(id) {
        if (id === 'next/link') return '\0next-link';
      },
      load(id) {
        if (id !== '\0next-link') return;
        return `
          import { createElement } from 'react';
          export default function Link({ href, children, ...rest }) {
            return createElement('a', { href, ...rest }, children);
          }
        `;
      },
    },
  ],
});
after(() => server.close());

const firstRun = (await server.ssrLoadModule(
  '/components/studio/FirstRunShell.tsx',
)) as FirstRunModule;
const studioModule = await server.ssrLoadModule(
  '/components/studio/WrapDesignStudio.tsx',
);
const WrapDesignStudio = studioModule.default as ComponentType<StudioProps>;

const renderStudio = (props: StudioProps = {}) =>
  renderToStaticMarkup(createElement(WrapDesignStudio, props));

void test('first open applies a finished template with mirror on and advanced tools hidden', () => {
  const state = firstRun.createFirstRunState();
  assert.equal(state.advanced, false);
  assert.equal(state.mirror, true);
  assert.equal(state.chassisId, 'current-glb');
  assert.equal(state.project.layers.length, 3);
  assert.ok(
    state.project.layers.every(
      (layer) =>
        layer.linked &&
        layer.entry &&
        layer.driver &&
        JSON.stringify(layer.entry) === JSON.stringify(layer.driver),
    ),
  );
  assert.equal(firstRun.shopNameOf(state.project), 'MXGARAGE');
  assert.deepEqual(parseProject(JSON.stringify(state.project)), state.project);
  const html = renderStudio();
  assert.match(html, /data-first-run="simple"/);
  assert.match(html, /data-mirror="on"/);
  assert.match(html, /data-layers="3"/);
  assert.match(html, /aria-label="店名"/);
  assert.match(html, /value="MXGARAGE"/);
  assert.match(html, /另一侧已自动同步，文字正向可读/);
  assert.match(html, /data-theme-slot="s2-pending"/);
  assert.match(html, /换一套主题/);
  assert.doesNotMatch(html, />范围</);
  assert.doesNotMatch(html, />涂鸦</);
  assert.doesNotMatch(html, />图层</);
  assert.doesNotMatch(html, /双侧关联/);
  assert.doesNotMatch(html, /线太短/);
  assert.doesNotMatch(html, /侧面贴画展开图/);
  assert.doesNotMatch(html, /添加图案/);
});

void test('toggling Advanced reveals path, doodle, and layer tools', () => {
  const opened = firstRun.toggleAdvanced(firstRun.createFirstRunState());
  assert.equal(opened.advanced, true);
  assert.equal(opened.mirror, true);
  const html = renderStudio({ initialAdvanced: true });
  assert.match(html, /data-first-run="advanced"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />范围</);
  assert.match(html, />涂鸦</);
  assert.match(html, />图层</);
  assert.match(html, /添加图案/);
  assert.match(html, /aria-label="店名"/);
});

void test('shop-name input updates both mirrored sides of the design', () => {
  const named = firstRun.setShopName(firstRun.createFirstRunState(), '山野咖啡');
  assert.equal(firstRun.shopNameOf(named.project), '山野咖啡');
  assert.equal(named.mirror, true);
  const text = named.project.layers.find((layer) => layer.entry?.kind === 'text');
  assert.ok(text?.entry && text.driver);
  assert.equal(text.entry.text, '山野咖啡');
  assert.equal(text.driver.text, '山野咖啡');
  assert.equal(text.linked, true);
  const html = renderStudio({ initialProject: named.project });
  assert.match(html, /value="山野咖啡"/);
  assert.match(html, /data-mirror="on"/);
  assert.doesNotMatch(html, />范围</);
});

void test('shop name, mirror, template, and advanced mode survive a chassis switch', () => {
  const named = firstRun.setShopName(firstRun.createFirstRunState(), '山野咖啡');
  const switched = firstRun.switchChassis(named, 'step-slide');
  assert.equal(switched.chassisId, 'step-slide');
  assert.equal(switched.advanced, false);
  assert.equal(switched.mirror, true);
  assert.equal(firstRun.shopNameOf(switched.project), '山野咖啡');
  assert.deepEqual(switched.project, named.project);
  const html = renderStudio({
    initialAdvanced: switched.advanced,
    initialChassis: switched.chassisId,
    initialProject: switched.project,
  });
  assert.match(html, /data-chassis="step-slide"/);
  assert.match(html, /data-first-run="simple"/);
  assert.match(html, /data-mirror="on"/);
  assert.match(html, /data-layers="3"/);
  assert.match(html, /value="山野咖啡"/);
  assert.match(html, /验证车体/);
  assert.doesNotMatch(html, />范围</);
  assert.doesNotMatch(html, />涂鸦</);
  assert.doesNotMatch(html, />图层</);
  assert.doesNotMatch(html, /线太短/);
});
