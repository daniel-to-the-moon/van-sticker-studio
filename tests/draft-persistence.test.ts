import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftPersistence } from '../lib/draft-persistence.ts';
import {
  emptyProject,
  addLayer,
  editLayer,
  newLayer,
  parseProject,
} from '../lib/free-wrap.ts';
import { parseDraft } from '../lib/wrap-draft.ts';

function fixture() {
  let record: string | null = null;
  let failing = false;
  let writes = 0;
  const tasks = new Map<number, () => void>();
  let next = 0;
  const storage = {
    getItem: (_key: string) => record,
    setItem: (_key: string, value: string) => {
      if (failing) throw new Error('quota');
      writes++;
      record = value;
    },
  };
  const draft = new DraftPersistence(storage, 'draft', {
    setTimer: (callback) => {
      const id = ++next;
      tasks.set(id, callback);
      return id;
    },
    clearTimer: (id) => {
      tasks.delete(id as number);
    },
  });
  return {
    draft,
    get record() {
      return record;
    },
    set record(value: string | null) {
      record = value;
    },
    get writes() {
      return writes;
    },
    fail: (value: boolean) => {
      failing = value;
    },
    tick: () => {
      const pending = [...tasks.values()];
      tasks.clear();
      pending.forEach((f) => f());
    },
  };
}
const project = () =>
  addLayer(emptyProject(), newLayer('text', 'sign'), 'entry');

void test('quota failure keeps the old draft and explicit retry saves the current draft', () => {
  const f = fixture(),
    first = project();
  f.record = JSON.stringify(first);
  assert.deepEqual(f.draft.restore(), first);
  const latest = editLayer(first, 'sign', 'entry', { text: 'Latest' });
  f.fail(true);
  f.draft.schedule(latest);
  f.tick();
  assert.equal(f.draft.status, 'error');
  assert.deepEqual(parseDraft(f.record!), first);
  f.fail(false);
  assert.equal(f.draft.flush(), true);
  assert.equal(f.draft.status, 'saved');
  assert.deepEqual(parseDraft(f.record!), latest);
});

void test('a subsequent smaller edit retries automatically after quota failure', () => {
  const f = fixture();
  f.draft.restore();
  f.fail(true);
  f.draft.schedule(project());
  f.tick();
  assert.equal(f.draft.status, 'error');
  f.fail(false);
  f.draft.schedule(emptyProject());
  f.tick();
  assert.equal(f.draft.status, 'saved');
  assert.deepEqual(parseDraft(f.record!), emptyProject());
});

void test('unreadable old draft survives automatic edits and retries until valid explicit import', () => {
  const f = fixture();
  f.record = '{broken';
  assert.throws(() => f.draft.restore());
  assert.equal(f.draft.status, 'blocked');
  f.draft.schedule(emptyProject());
  f.tick();
  assert.equal(f.draft.flush(), false);
  assert.equal(f.record, '{broken');
  assert.equal(f.writes, 0);
  f.draft.replace(project());
  f.tick();
  assert.equal(f.draft.status, 'saved');
  assert.deepEqual(parseDraft(f.record!), project());
});

void test('flush before the debounce persists the latest committed edit once', () => {
  const f = fixture(),
    first = project();
  f.draft.restore();
  f.draft.schedule(first);
  const last = editLayer(first, 'sign', 'entry', { text: 'Last change' });
  f.draft.schedule(last);
  assert.equal(f.writes, 0);
  assert.equal(f.draft.flush(), true);
  assert.deepEqual(parseDraft(f.record!), last);
  f.draft.flush();
  f.tick();
  assert.equal(f.writes, 1);
});

void test('dispose flushes the last state and clears the scheduled write', () => {
  const f = fixture();
  f.draft.restore();
  f.draft.schedule(project());
  f.draft.dispose();
  f.tick();
  assert.equal(f.writes, 1);
  assert.deepEqual(parseDraft(f.record!), project());
});

void test('hidden/pagehide lifecycle saves early and listeners are removed on cleanup', () => {
  const f = fixture();
  const windowEvents = new EventTarget(),
    documentEvents = new EventTarget();
  let hidden = false;
  f.draft.restore();
  const detach = f.draft.attachLifecycle(
    windowEvents,
    documentEvents,
    () => hidden,
  );
  f.draft.schedule(project());
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.writes, 0);
  hidden = true;
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.writes, 1);
  const next = editLayer(project(), 'sign', 'entry', { text: 'After resume' });
  f.draft.schedule(next);
  windowEvents.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(parseDraft(f.record!), next);
  detach();
  f.draft.schedule(emptyProject());
  windowEvents.dispatchEvent(new Event('pagehide'));
  assert.equal(f.writes, 2);
});

void test('valid portable import unblocks recovery even when local envelope is too large', () => {
  let large = emptyProject();
  for (let i = 0; i < 4; i++) {
    const image = newLayer('image', 'large-' + i);
    const prefix = 'data:image/png;base64,';
    image.entry!.src =
      prefix +
      'A'.repeat(2_000_000 - prefix.length - 1) +
      String.fromCharCode(66 + i);
    large = addLayer(large, image, 'entry', false);
  }
  const excess = JSON.stringify(large).length - 8_000_000;
  const source = large.layers[3].entry!.src;
  large.layers[3].entry!.src = source.slice(0, source.length - excess);
  assert.equal(JSON.stringify(large).length, 8_000_000);
  assert.doesNotThrow(() => parseProject(JSON.stringify(large)));
  const f = fixture();
  f.record = '{broken';
  assert.throws(() => f.draft.restore());
  assert.doesNotThrow(() => f.draft.replace(large));
  f.tick();
  assert.equal(f.draft.status, 'error');
  assert.equal(f.record, '{broken');
  f.draft.schedule(emptyProject());
  f.tick();
  assert.equal(f.draft.status, 'saved');
  assert.deepEqual(parseDraft(f.record!), emptyProject());
});
