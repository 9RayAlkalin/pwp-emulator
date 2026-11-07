import type { Grade, RuntimeNote, Statistics } from '../types';

interface Contact { x: number; y: number; keyboard: boolean; moved: boolean; movedAt: number; }
interface Result { grade: Grade; time: number; holding?: boolean; }
export const windows = { perfect: 0.08, good: 0.16, bad: 0.2 };
export function timingGrade(delta: number): Grade {
  const distance = Math.abs(delta);
  return distance <= windows.perfect ? 'perfect' : distance <= windows.good ? 'good' : distance <= windows.bad ? 'bad' : 'miss';
}
export function scoreFor(perfect: number, good: number, maxCombo: number, total: number): number {
  return total ? Math.round((perfect + good * 0.65) / total * 900000 + maxCombo / total * 100000) : 0;
}

export class Judge {
  notes: RuntimeNote[] = [];
  results = new Map<RuntimeNote, Result>();
  stats: Statistics = this.empty();
  onHit: (note: RuntimeNote) => void = () => {};
  private contacts = new Map<string, Contact>();
  private effects: { note: RuntimeNote; time: number; grade: Grade }[] = [];
  private width = 1;
  private height = 1;
  private empty(): Statistics {
    return { perfect: 0, good: 0, bad: 0, miss: 0, combo: 0, maxCombo: 0, score: 0, accuracy: 100, total: 0 };
  }
  reset(notes: RuntimeNote[], time = -Infinity): void {
    this.notes = [...notes].sort((a, b) => a.sect - b.sect);
    this.results.clear();
    this.contacts.clear();
    this.effects = [];
    this.stats = this.empty();
    this.stats.total = notes.length;
    // Seeking is practice: skipped notes receive no points and cannot be hit again.
    for (const note of notes) {
      note.clicked = false;
      if (note.sect < time) { this.results.set(note, { grade: 'miss', time }); this.stats.miss++; }
    }
    this.recalculate();
  }
  private position(note: RuntimeNote, time: number): [number, number, number] {
    const [rotation, x, y] = note.master.get_state(time);
    const angle = rotation * Math.PI / 180;
    const distance = note.positionX * 0.05625 * this.width;
    return [x * this.width + distance * Math.cos(angle), y * this.height + distance * Math.sin(angle), angle];
  }
  private near(note: RuntimeNote, contact: Contact, time: number): boolean {
    if (contact.keyboard) return true;
    const [x, y, angle] = this.position(note, time);
    // Judge along the line; a rotating line uses its local X axis.
    return Math.abs((contact.x - x) * Math.cos(angle) + (contact.y - y) * Math.sin(angle)) <= this.width * 0.09 &&
      Math.abs(-(contact.x - x) * Math.sin(angle) + (contact.y - y) * Math.cos(angle)) <= this.height * 0.22;
  }
  input(id: string, x: number, y: number, kind: 'tap' | 'move' | 'release', time: number, width: number, height: number, keyboard: boolean): void {
    this.width = width;
    this.height = height;
    if (kind === 'release') { this.contacts.delete(id); return; }
    const old = this.contacts.get(id);
    const moved = keyboard || !!old && Math.hypot(x - old.x, y - old.y) > Math.min(width, height) * 0.008;
    const contact = { x, y, keyboard, moved, movedAt: moved ? time : -Infinity };
    this.contacts.set(id, contact);
    if (kind === 'tap') {
      const candidates = this.notes.filter(note => !this.results.has(note) && (note.type === 1 || note.type === 3) &&
        Math.abs(note.sect - time) <= windows.bad && this.near(note, contact, time));
      candidates.sort((a, b) => Math.abs(a.sect - time) - Math.abs(b.sect - time));
      if (candidates[0]) this.hit(candidates[0], time, timingGrade(time - candidates[0].sect));
    }
    this.update(time);
  }
  update(time: number): void {
    for (const note of this.notes) {
      if (note.sect > time + windows.good) break;
      const result = this.results.get(note);
      if (result) {
        if (result.holding) {
          if (time >= note.hold_end_time - 0.12) {
            result.holding = false;
            this.count(result.grade);
          } else if (![...this.contacts.values()].some(contact => this.near(note, contact, time))) {
            result.grade = 'miss'; result.holding = false; note.clicked = false;
            this.count('miss');
          } else if (!this.effects.some(effect => effect.note === note && time - effect.time < 0.16)) {
            this.effects.push({ note, time, grade: result.grade });
          }
        }
        continue;
      }
      if (time - note.sect > windows.bad) { this.hit(note, time, 'miss'); continue; }
      if (note.type === 2 || note.type === 4) {
        const contact = [...this.contacts.values()].find(value => this.near(note, value, time) &&
          (note.type === 2 || value.moved && time - value.movedAt <= 0.16));
        if (contact && time >= note.sect && time - note.sect <= windows.good) {
          this.hit(note, time, 'perfect');
          if (note.type === 4) contact.moved = false;
        }
      }
    }
    this.effects = this.effects.filter(effect => time - effect.time < 0.5);
  }
  private hit(note: RuntimeNote, time: number, grade: Grade): void {
    const holding = note.is_hold && (grade === 'perfect' || grade === 'good');
    this.results.set(note, { grade, time, holding });
    note.clicked = grade === 'perfect' || grade === 'good';
    if (note.clicked) {
      this.onHit(note);
      this.effects.push({ note, time, grade });
    }
    if (!holding) this.count(grade);
  }
  private count(grade: Grade): void {
    this.stats[grade]++;
    if (grade === 'perfect' || grade === 'good') this.stats.combo++;
    else this.stats.combo = 0;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.stats.combo);
    this.recalculate();
  }
  private recalculate(): void {
    const s = this.stats;
    s.score = scoreFor(s.perfect, s.good, s.maxCombo, s.total);
    const judged = s.perfect + s.good + s.bad + s.miss;
    s.accuracy = judged ? (s.perfect + s.good * 0.65) / judged * 100 : 100;
  }
  clearInput(): void { this.contacts.clear(); }
  draw(ctx: CanvasRenderingContext2D, time: number, width: number, height: number): void {
    this.width = width; this.height = height;
    for (const effect of this.effects) {
      const p = (time - effect.time) / 0.5;
      if (p < 0 || p > 1) continue;
      const [x, y] = this.position(effect.note, time);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = effect.grade === 'perfect' ? '#ffec9f' : '#9bdcff';
      ctx.lineWidth = Math.max(2, height * 0.004);
      ctx.translate(x, y); ctx.rotate(p * Math.PI);
      const size = width * 0.025 * (0.5 + p);
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.restore();
    }
  }
}
