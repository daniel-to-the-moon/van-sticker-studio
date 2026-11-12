import { parseProject, type Project } from './free-wrap.ts';
import { parseDraft, serializeDraft } from './wrap-draft.ts';

export type DraftStatus = 'loading' | 'saved' | 'pending' | 'error' | 'blocked';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Options = {
  onStatus?: (status: DraftStatus) => void;
  setTimer?: (callback: () => void) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Retains the old record on write failure; unreadable records require explicit replacement. */
export class DraftPersistence {
  private storage: Storage;
  private key: string;
  private options: Options;
  private latest: Project | null = null;
  private lastWritten: string | null = null;
  private blocked = true;
  private dirty = false;
  private timer: unknown = null;
  private state: DraftStatus = 'loading';

  constructor(storage: Storage, key: string, options: Options = {}) {
    this.storage = storage;
    this.key = key;
    this.options = options;
  }
  get status(): DraftStatus {
    return this.state;
  }
  private notify(status: DraftStatus) {
    if (status === this.state) return;
    this.state = status;
    this.options.onStatus?.(status);
  }
  private clearTimer() {
    if (this.timer === null) return;
    if (this.options.clearTimer) this.options.clearTimer(this.timer);
    else clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    this.timer = null;
  }
  restore(): Project | null {
    try {
      const saved = this.storage.getItem(this.key);
      const project = saved === null ? null : parseDraft(saved);
      this.lastWritten = saved;
      this.latest = project;
      this.blocked = false;
      this.notify('saved');
      return project;
    } catch (error) {
      this.blocked = true;
      this.notify('blocked');
      throw error;
    }
  }
  schedule(project: Project) {
    this.latest = project;
    this.dirty = true;
    this.clearTimer();
    if (this.blocked) return;
    this.notify('pending');
    const callback = () => {
      this.timer = null;
      this.flush();
    };
    this.timer = this.options.setTimer
      ? this.options.setTimer(callback)
      : setTimeout(callback, 500);
  }
  replace(project: Project) {
    // Validate the deliberate import before allowing an old unreadable record to be replaced.
    parseProject(JSON.stringify(project));
    this.blocked = false;
    this.schedule(project);
  }
  flush(): boolean {
    this.clearTimer();
    if (this.blocked) return false;
    if (!this.dirty || !this.latest) return true;
    try {
      const encoded = serializeDraft(this.latest);
      if (encoded !== this.lastWritten) this.storage.setItem(this.key, encoded);
      this.lastWritten = encoded;
      this.dirty = false;
      this.notify('saved');
      return true;
    } catch {
      // A later edit or explicit retry can succeed after quota/transient failures.
      this.notify('error');
      return false;
    }
  }
  attachLifecycle(
    windowEvents: EventTarget,
    documentEvents: EventTarget,
    isHidden: () => boolean,
  ) {
    const onPageHide = () => {
      this.flush();
    };
    const onVisibility = () => {
      if (isHidden()) this.flush();
    };
    windowEvents.addEventListener('pagehide', onPageHide);
    documentEvents.addEventListener('visibilitychange', onVisibility);
    return () => {
      windowEvents.removeEventListener('pagehide', onPageHide);
      documentEvents.removeEventListener('visibilitychange', onVisibility);
    };
  }
  dispose() {
    this.flush();
    this.clearTimer();
  }
}
