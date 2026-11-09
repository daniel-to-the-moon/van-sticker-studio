import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf-8');

void test('prompt section is collapsed by default and keeps its toggle', () => {
  const page = read('app/page.tsx');
  assert.ok(
    page.includes('const [promptOpen, setPromptOpen] = useState(false);'),
  );
  assert.ok(page.includes('aria-expanded={promptOpen}'));
  assert.ok(page.includes('{promptOpen && ('));
  assert.ok(page.includes("t(lang, 'page.promptSectionToggle')"));
  const i18n = read('lib/i18n.ts');
  assert.ok(
    i18n.includes(
      "'page.promptSectionToggle': 'Write a prompt to generate decals'",
    ),
  );
  assert.ok(i18n.includes("'page.promptSectionToggle': '写提示词生成拉花'"));
});

void test('decal picker section is collapsed by default and keeps its meta', () => {
  const page = read('app/page.tsx');
  assert.ok(
    page.includes('const [conceptsOpen, setConceptsOpen] = useState(false);'),
  );
  assert.ok(page.includes('aria-expanded={conceptsOpen}'));
  assert.ok(page.includes('{conceptsOpen && ('));
  assert.ok(page.includes("t(lang, 'page.yourDesigns')"));
  assert.ok(page.includes("t(lang, 'page.designsMeta'"));
});

void test('quick preview entries are gated off by default', () => {
  const page = read('app/page.tsx');
  assert.ok(page.includes('const SHOW_QUICK_ENTRIES = false;'));
  const gates = page.match(/\{SHOW_QUICK_ENTRIES && \(/g) ?? [];
  assert.equal(gates.length, 3);
  for (const marker of [
    'environment-switch',
    'interaction-dock',
    'view-switch',
  ]) {
    assert.ok(page.includes(marker));
  }
  // The gates wrap the three entries; the single reset tool button stays.
  assert.ok(page.includes('className="round-control"'));
});

void test('visible copy carries no vehicle brand words', () => {
  const brandPatterns = [
    /MAXUS/,
    /SAIC/,
    /上汽/,
    /大通/,
    /\bV80\b/,
    /V80_WRAP_BODY/,
  ];
  for (const path of [
    'app/page.tsx',
    'lib/i18n.ts',
    'README.md',
    'components/studio/scene-engine.ts',
  ]) {
    const text = read(path);
    for (const pattern of brandPatterns) {
      assert.ok(!pattern.test(text), `${path} still matches ${pattern}`);
    }
  }
  assert.ok(
    read('app/page.tsx').includes('<h2 className="sr-only">MXGARAGE VAN</h2>'),
  );
  for (const label of [
    'VAN / 001',
    'BODY &amp; GRAPHIC STUDY',
    'DESCRIBE → GENERATE → APPLY',
  ])
    assert.ok(!read('app/page.tsx').includes(label));
  assert.ok(
    read('lib/plan-insights.ts').includes('export const VAN_WRAP_BODY'),
  );
  assert.ok(read('app/page.tsx').includes('VAN_WRAP_BODY'));
});

void test('catalog placeholder rows use generic category names', () => {
  const catalog = read('lib/announcement-db.ts');
  for (const brand of [
    '大通',
    '依维柯',
    '福特',
    '江铃',
    '图雅诺',
    '御风',
    '金杯',
    '庆铃',
    '跃进',
    '长城炮',
    '域虎',
    'D-MAX',
    '纳瓦拉',
    'Ranger',
    '宇通',
    '中通',
    '金龙',
    '考斯特',
    '五菱',
    '长安',
    '坦克',
    'BJ40',
    '牧马人',
    'Maxus',
  ]) {
    assert.ok(!catalog.includes(brand), `catalog still mentions ${brand}`);
  }
  for (const oldId of [
    "id: 'v80'",
    "id: 'v90'",
    "id: 'maxus-t60'",
    "id: 'maxus-t70'",
  ]) {
    assert.ok(!catalog.includes(oldId), `catalog still has ${oldId}`);
  }
  assert.ok(catalog.includes("{ id: 'motorhome-b-01', name: 'B 型房车 01'"));
  assert.ok(catalog.includes("{ id: 'offroad-04', name: '越野房车 04'"));
});

void test('registry display names carry no brand words', () => {
  // Notes keep their audit wording (they are never rendered in the panel
  // dropdown); only the displayed name field is scrubbed.
  const data = JSON.parse(read('lib/announcement-db.json')) as {
    entries: { name: string }[];
  };
  for (const entry of data.entries) {
    for (const brand of ['上汽', '大通', 'Maxus']) {
      assert.ok(
        !entry.name.includes(brand),
        `${entry.name} still mentions ${brand}`,
      );
    }
  }
});

void test('motion metadata is scrubbed but keeps its R9 anchors', () => {
  const text = read('public/model/motion_metadata.json');
  for (const brand of ['V80', 'MAXUS', 'SAIC', '大通', '上汽']) {
    assert.ok(!text.includes(brand), `motion metadata still mentions ${brand}`);
  }
  const data = JSON.parse(text) as {
    glbSha256?: string;
    grilleArcCorrection?: unknown;
  };
  assert.equal(
    data.glbSha256,
    '78bc638b15e2fe69d822790784fef9e84dd453574c78b984957ec4d365b19f13',
  );
  assert.ok(data.grilleArcCorrection !== undefined);
});
