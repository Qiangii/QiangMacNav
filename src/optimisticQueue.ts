export interface OptimisticChange<T> {
  apply: (snapshot: T) => T;
  save: (before: T, after: T, isCurrent: () => boolean) => Promise<unknown>;
  onSuccess: () => void;
  onError: (error: unknown) => void;
  onRefreshError: () => void;
}

// One writer, with an immediately visible projection of all accepted changes.
// The confirmed snapshot supplies CAS preconditions, never an unsaved projection.
export class OptimisticQueue<T> {
  value: T | null = null;
  busy = false;
  private confirmed: T | null = null;
  private changes: OptimisticChange<T>[] = [];
  private epoch = 0;
  private revision = 0;
  private localRevision = 0;
  private waiters = new Set<() => void>();

  constructor(private publish: (value: T | null) => void, private pending: (busy: boolean) => void, private read: () => Promise<T>) {}

  set = (update: T | null | ((current: T | null) => T | null)) => {
    const next = typeof update === 'function' ? (update as (value: T | null) => T | null)(this.value) : update;
    // Even an already-empty session can have an initial read in flight.
    if (next === this.value && next !== null) return;
    if (next === null) {
      this.epoch++;
      this.changes = [];
      this.setBusy(false);
      this.confirmed = null;
    } else {
      // Local preference/media updates must also survive a later queue response.
      this.confirmed = typeof update === 'function' && this.busy
        ? (update as (value: T | null) => T | null)(this.confirmed) : next;
    }
    this.revision++;
    this.localRevision++;
    this.project();
  };

  enqueue(change: OptimisticChange<T>) {
    if (!this.value) return;
    try { change.apply(this.value); }
    catch (error) { change.onError(error); return; }
    this.changes.push(change);
    this.revision++;
    this.project();
    if (!this.busy) {
      this.setBusy(true);
      void this.drain(this.epoch);
    }
  }

  // Foreground refreshes wait for writes and discard reads overtaken by a drop.
  async refresh() {
    const epoch = this.epoch;
    while (epoch === this.epoch) {
      if (this.busy) await new Promise<void>(resolve => this.waiters.add(resolve));
      if (epoch !== this.epoch) return this.value;
      const revision = this.revision;
      const value = await this.read();
      if (epoch !== this.epoch) return this.value;
      if (this.busy || revision !== this.revision) continue;
      this.set(value);
      return value;
    }
    return this.value;
  }

  private setBusy(value: boolean) {
    this.busy = value;
    this.pending(value);
    if (!value) { for (const resolve of this.waiters) resolve(); this.waiters.clear(); }
  }

  private project() {
    let value = this.confirmed;
    this.changes = this.changes.filter(change => {
      if (!value) return false;
      try { value = change.apply(value); return true; }
      catch (error) { change.onError(error); return false; }
    });
    this.value = value;
    this.publish(value);
  }

  private async drain(epoch: number) {
    const isCurrent = () => epoch === this.epoch;
    while (isCurrent()) {
      let last: OptimisticChange<T> | undefined;
      let failed = false;
      while (this.changes.length && isCurrent()) {
        const change = this.changes[0];
        last = change;
        try {
          const before = this.confirmed!;
          const after = change.apply(before);
          await change.save(before, after, isCurrent);
          if (!isCurrent()) return;
          // Keep local preference changes made while the write was in flight.
          this.confirmed = change.apply(this.confirmed!);
          this.changes.shift();
          this.project();
          change.onSuccess();
        } catch (error) {
          if (!isCurrent()) return;
          // Later drops depend on this projection. Discard the dependent batch
          // rather than silently writing it over a conflict or ambiguous failure.
          this.changes = [];
          this.project();
          change.onError(error);
          failed = true;
          break;
        }
      }
      if (!isCurrent()) return;
      const localRevision = this.localRevision;
      try {
        const saved = await this.read();
        if (!isCurrent()) return;
        // A local edit can occur during the read; preserve it and let the next
        // regular sync reconcile it. New drops are replayed on the read result.
        if (localRevision === this.localRevision) this.confirmed = saved;
        this.project();
      } catch {
        if (!isCurrent()) return;
        if (!failed) last?.onRefreshError();
      }
      if (!this.changes.length) { this.setBusy(false); return; }
    }
  }
}
