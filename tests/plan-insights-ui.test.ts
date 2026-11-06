import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentProps, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { t, type Lang } from '../lib/i18n.ts';

type Props = ComponentProps<
  typeof import('../components/studio/PlanInsights.tsx').default
>;

// Load real TSX, aliases and CSS modules without the app's hosting configuration.
const server = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': process.cwd() } },
  optimizeDeps: { noDiscovery: true },
});
after(() => server.close());
const insightModule = await server.ssrLoadModule(
  '/components/studio/PlanInsights.tsx',
);
const PlanInsights: ComponentType<Props> = insightModule.default;

const body = { xMin: -2.85, length: 5.8, width: 2.22, height: 3.05 };
const placements = [
  { center: 4, height: 1.28, scale: 1 },
  { center: 12, height: 1.28, scale: 1 },
];
const render = (lang: Lang, changes: Partial<Props> = {}) =>
  renderToStaticMarkup(
    createElement(PlanInsights, {
      lang,
      appliedName: 'Sample',
      placements,
      aspect: 3,
      body,
      ...changes,
    }),
  );
const text = (html: string) =>
  html.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&');
const article = (html: string, label: string) => {
  const found = [
    ...html.matchAll(
      /<article\b[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g,
    ),
  ].find((match) => match[1] === label);
  assert.ok(found, `Missing article: ${label}`);
  return found[2];
};

for (const lang of ['en', 'zh'] as const) {
  void test(`${lang}: advisory details start closed after coverage and reference price`, () => {
    const html = render(lang);
    const details = [
      ...html.matchAll(
        /<details\b([^>]*)>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/g,
      ),
    ];
    assert.equal(details.length, 3);
    assert.deepEqual(
      details.map((match) => text(match[2])),
      [
        t(lang, 'compliance.title'),
        t(lang, 'install.title'),
        t(lang, 'reversibility.title'),
      ],
    );
    for (const detail of details) assert.doesNotMatch(detail[1], /\bopen\b/);
    const summary = html.slice(0, html.indexOf('<details'));
    assert.ok(summary.includes(t(lang, 'coverage.title')));
    assert.ok(summary.includes(t(lang, 'price.title')));
    assert.ok(summary.includes(t(lang, 'compliance.footnote')));
    assert.ok(
      summary.includes(
        lang === 'zh' ? '参考价，非报价' : 'Reference price only, not a quote',
      ),
    );
  });

  void test(`${lang}: one estimate badge per card and reference total precedes breakdown`, () => {
    const html = render(lang);
    const coverage = article(html, t(lang, 'coverage.title'));
    const price = article(html, t(lang, 'price.title'));
    // Repeated row/value badges must not obscure the numbers or their basis.
    assert.equal(
      [...coverage.matchAll(/class="insight-estimate-tag"/g)].length,
      1,
    );
    assert.doesNotMatch(
      coverage.replace(
        /<span class="insight-estimate-tag">[\s\S]*?<\/span>/,
        '',
      ),
      new RegExp(`>${t(lang, 'coverage.estimateTag')}<`),
    );
    assert.equal(
      [...price.matchAll(new RegExp(`>${t(lang, 'price.referenceTag')}<`, 'g'))]
        .length,
      1,
    );
    for (const rowNote of price.matchAll(/<small>([\s\S]*?)<\/small>/g)) {
      assert.ok(!text(rowNote[1]).includes(t(lang, 'price.referenceTag')));
    }
    assert.ok(
      price.indexOf(t(lang, 'price.total')) <
        price.indexOf(t(lang, 'price.film')),
    );
  });

  void test(`${lang}: summary preserves the original sample figures and calculation basis`, () => {
    const html = render(lang);
    const coverage = text(article(html, t(lang, 'coverage.title')));
    const price = text(article(html, t(lang, 'price.title')));
    assert.ok(coverage.includes('23.1%'));
    assert.ok(coverage.includes('8.17 ㎡'));
    assert.ok(coverage.includes('35.4 ㎡'));
    assert.ok(coverage.includes(t(lang, 'coverage.okBadge')));
    assert.ok(coverage.includes(t(lang, 'coverage.footnote')));
    for (const value of ['¥500–¥1,340', '10.21 ㎡', '¥280–¥730', '¥230–¥600']) {
      assert.ok(price.includes(value), `Missing unchanged value ${value}`);
    }
    assert.ok(price.includes('×1.25'));
    assert.ok(price.includes('55%'));
    assert.ok(price.includes('45%'));
  });
}

void test('position-only edits retain figures; scale, aspect and body edits refresh the summary', () => {
  const moved = render('en', {
    placements: placements.map((p) => ({
      ...p,
      center: p.center + 0.2,
      height: 1.4,
    })),
  });
  assert.ok(text(moved).includes('23.1%'));
  assert.ok(text(moved).includes('¥500–¥1,340'));
  const scaled = render('en', {
    placements: placements.map((p) => ({ ...p, scale: 1.2 })),
  });
  assert.ok(text(scaled).includes('33.2%'));
  assert.ok(text(scaled).includes('¥720–¥1,920'));
  assert.ok(text(scaled).includes(t('en', 'coverage.warnBadge')));
  assert.ok(text(render('en', { aspect: 6 })).includes('11.5%'));
  assert.ok(
    text(render('en', { body: { ...body, height: 6.1 } })).includes('11.5%'),
  );
});

void test('empty placements and invalid scale/aspect preserve safe zero or fallback estimates', () => {
  for (const lang of ['en', 'zh'] as const) {
    const empty = text(render(lang, { appliedName: '', placements: [] }));
    assert.ok(empty.includes('0.0%'));
    assert.ok(empty.includes('¥0–¥0'));
    assert.doesNotMatch(empty, /NaN|Infinity|undefined/);
    const invalid = text(
      render(lang, {
        placements: placements.map((p) => ({ ...p, scale: NaN })),
        aspect: NaN,
      }),
    );
    assert.ok(invalid.includes('0.0%'));
    assert.ok(invalid.includes('¥0–¥0'));
    assert.ok(text(render(lang, { aspect: NaN })).includes('23.1%'));
  }
});
