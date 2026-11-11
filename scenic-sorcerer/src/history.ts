// Unlimited undo/redo over immutable snapshots. States are never mutated, only replaced.

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private current: T) {}

  get present(): T {
    return this.current;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record a new state. Anything that had been undone is dropped. */
  push(next: T): void {
    if (next === this.current) return;
    this.past.push(this.current);
    this.current = next;
    this.future = [];
  }

  undo(): T {
    const previous = this.past.pop();
    if (previous === undefined) return this.current;
    this.future.push(this.current);
    this.current = previous;
    return this.current;
  }

  redo(): T {
    const next = this.future.pop();
    if (next === undefined) return this.current;
    this.past.push(this.current);
    this.current = next;
    return this.current;
  }
}
