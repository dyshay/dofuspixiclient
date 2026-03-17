/**
 * Undo/Redo history — stores snapshots of panel definitions.
 * Each snapshot is a full deep-clone of the PanelDef.
 */
import type { PanelDef } from './schema';

const MAX_HISTORY = 100;

export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private current: string = '';
  private dirty = false;

  /** Take initial snapshot */
  init(def: PanelDef): void {
    this.current = JSON.stringify(def);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
  }

  /** Push current state before a change */
  push(def: PanelDef): void {
    const next = JSON.stringify(def);
    if (next === this.current) return; // no change
    this.undoStack.push(this.current);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.current = next;
    this.redoStack = []; // new branch clears redo
    this.dirty = true;
  }

  /** Undo — returns the previous PanelDef or null */
  undo(): PanelDef | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop()!;
    this.dirty = true;
    return JSON.parse(this.current);
  }

  /** Redo — returns the next PanelDef or null */
  redo(): PanelDef | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop()!;
    this.dirty = true;
    return JSON.parse(this.current);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  isDirty(): boolean { return this.dirty; }
  markClean(): void { this.dirty = false; }

  /** Get counts for status display */
  counts(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}
