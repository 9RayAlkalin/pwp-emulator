import type { Grade, RuntimeNote, Statistics } from '../types';
import { createHitEffect, hitEffectDuration, holdEffectInterval, type HitEffect, type HitGrade } from './hit-effects';
import { chartNoteGeometry } from './chart-note-geometry';

interface Contact { blocked: boolean; x: number; y: number; keyboard: boolean; moved: boolean; movedAt: number; }
interface Result {
  grade: Grade; time: number; holding?: boolean; completed?: boolean;
  safeFrames?: number; missed?: boolean;
  visualMissed?: boolean;
}
export interface BadEffect { note: RuntimeNote; time: number; elapsed: number; startedAt: number; }
export const windows = { perfect: 0.08, good: 0.18, bad: 0.22 };
export function timingGrade(delta: number): Grade {
  const distance = Math.abs(delta);
  return distance < windows.perfect ? 'perfect' : distance < windows.good ? 'good' :
    delta < 0 && distance <= windows.bad ? 'bad' : 'miss';
}
export function scoreFor(perfect: number, good: number, maxCombo: number, total: number): number {
  return total ? Math.round((perfect + good * 0.65) / total * 900000 + maxCombo / total * 100000) : 0;
}

export class Judge {
  notes: RuntimeNote[] = [];
  results = new Map<RuntimeNote, Result>();
  stats: Statistics = this.empty();
  onHit: (note: RuntimeNote) => void = () => {};
  now: (() => number) | undefined;
  isBlocked: (x: number, y: number, time: number, width: number, height: number) => boolean = () => false;
  private contacts = new Map<string, Contact>();
  private effects: (HitEffect & { startedAt: number })[] = [];
  private bad: BadEffect[] = [];
  private holdTimers = new Map<RuntimeNote, number>();
  private armed = new Set<RuntimeNote>();
  private lastFrameTime: number | undefined;
  private width = 1;
  private height = 1;
  private empty(): Statistics {
    return { perfect: 0, good: 0, bad: 0, miss: 0, combo: 0, maxCombo: 0, score: 0, accuracy: 100, total: 0 };
  }
  reset(notes: RuntimeNote[], time = -Infinity): void {
    this.notes = notes.filter(note => !note.isFake).sort((a, b) => a.sect - b.sect);
    this.results.clear();
    this.contacts.clear();
    this.effects = [];
    this.bad = [];
    this.holdTimers.clear();
    this.armed.clear();
    this.lastFrameTime = undefined;
    this.stats = this.empty();
    this.stats.total = this.notes.length;
    // Seeking is practice: skipped notes receive no points and cannot be hit again.
    for (const note of this.notes) {
      note.clicked = false;
      if (note.sect < time) { this.results.set(note, { grade: 'miss', time }); this.stats.miss++; }
    }
    this.recalculate();
  }
  private position(note: RuntimeNote, time: number): [number, number, number] {
    const [rotation, x, y] = note.master.get_state(time);
    const angle = rotation * Math.PI / 180;
    const geometry = note.master.animation ? chartNoteGeometry(note, note.master.animation, time, (note.yOffset ?? 0) * 540, note.is_above) : undefined;
    const distance = (geometry ? geometry.x / 1350 : note.positionX * .05625) * (note.master.get_viewport?.().width ?? this.width);
    return [x * this.width + distance * Math.cos(angle), y * this.height + distance * Math.sin(angle), angle];
  }
  private near(note: RuntimeNote, contact: Contact, time: number): boolean {
    if (contact.blocked) return false;
    if (contact.keyboard) return true;
    const [x, y, angle] = this.position(note, time);
    // Judge along the line; a rotating line uses its local X axis.
    const radius = note.type === 2 || note.type === 4 ? 0.21 : 0.19;
    return Math.abs((contact.x - x) * Math.cos(angle) + (contact.y - y) * Math.sin(angle)) <
      this.height * radius * (note.master.get_viewport?.().gameplayScale ?? 1) * (note.judgeArea ?? 1);
  }
  input(id: string, x: number, y: number, kind: 'tap' | 'move' | 'release', time: number, width: number, height: number, keyboard: boolean): void {
    this.width = width;
    this.height = height;
    this.lastFrameTime ??= time;
    if (kind === 'release') { this.contacts.delete(id); return; }
    const old = this.contacts.get(id);
    const moved = keyboard || !!old && Math.hypot(x - old.x, y - old.y) > Math.min(width, height) * 0.008;
    const blocked = !!old?.blocked || !keyboard && this.isBlocked(x, y, time, width, height);
    const contact = { x, y, keyboard, blocked, moved, movedAt: moved ? time : -Infinity };
    this.contacts.set(id, contact);
    if (kind === 'tap' && !blocked) {
      const candidates = this.notes.filter(note => !this.results.has(note) && (note.type === 1 || note.type === 3) &&
        time >= note.sect - windows.bad && time < note.sect + windows.good && this.near(note, contact, time) &&
        (note.type === 1 || Math.abs(note.sect - time) < windows.good));
      candidates.sort((a, b) => Math.abs(a.sect - time) - Math.abs(b.sect - time));
      if (candidates[0]) this.hit(candidates[0], time, timingGrade(time - candidates[0].sect));
    }
    // Pointer events can arrive many times per rendered frame. They must not
    // consume Hold safe frames or advance Time.deltaTime feedback counters.
    this.update(time, width, height, 0, false);
  }
  update(time: number, width = this.width, height = this.height, deltaSeconds?: number, frame = true): void {
    this.width = width; this.height = height;
    const advances = frame && time !== this.lastFrameTime;
    const delta = advances ? Math.max(0, deltaSeconds ?? (this.lastFrameTime === undefined ? 0 : time - this.lastFrameTime)) : 0;
    if (advances) this.lastFrameTime = time;
    const visualTime = this.now?.() ?? time;
    for (const effect of [...this.effects, ...this.bad]) effect.elapsed = Math.max(0, visualTime - effect.startedAt);
    // Recheck stationary contacts too: an animated block can move onto a held finger.
    for (const contact of this.contacts.values()) {
      if (!contact.keyboard && !contact.blocked && this.isBlocked(contact.x, contact.y, time, width, height)) contact.blocked = true;
    }
    for (const note of this.notes) {
      if (note.sect > time + windows.good) break;
      if (note.is_hold && advances) {
        this.holdTimers.set(note, time <= note.sect ? 0 : Math.fround((this.holdTimers.get(note) ?? 0) + delta));
      }
      const result = this.results.get(note);
      if (result) {
        if (advances) result.visualMissed = result.missed;
        if (result.holding) {
          // NoteMove runs before Judge: at most one pulse this frame, then zero
          // the timer. Score completion does not end particle feedback.
          if (advances && time > note.sect && time < note.hold_end_time &&
              (this.holdTimers.get(note) ?? 0) >= holdEffectInterval(note) - 0.00001) {
            this.addEffect(note, time, result.grade as HitGrade);
            this.holdTimers.set(note, 0);
          }
          if (!result.completed) {
            const contact = [...this.contacts.values()].some(contact => this.near(note, contact, time));
            if (contact) result.safeFrames = 2;
            else if (advances) {
              if ((result.safeFrames ?? 0) < 0) {
                result.grade = 'miss'; result.holding = false; result.missed = true; result.completed = true;
                this.count('miss');
              } else result.safeFrames = (result.safeFrames ?? 0) - 1;
            }
            if (!result.completed && time > note.hold_end_time - 0.22) {
              result.completed = true; this.count(result.grade);
            }
          }
          if (time >= note.hold_end_time) result.holding = false;
        }
        continue;
      }
      if (this.armed.has(note) && time > note.sect - 0.005) {
        this.hit(note, time, 'perfect'); continue;
      }
      const missWindow = note.type === 2 ? 0.1 : note.type === 4 ? windows.perfect * 1.75 : windows.good;
      if (time - note.sect > missWindow) { this.hit(note, time, 'miss'); continue; }
      if (note.type === 2 || note.type === 4) {
        const contact = [...this.contacts.values()].find(value => this.near(note, value, time) &&
          (note.type === 2 || value.moved && time - value.movedAt <= 0.16));
        const armWindow = note.type === 2 ? 0.1 : windows.perfect * 1.75;
        if (contact && Math.abs(time - note.sect) <= armWindow) {
          this.armed.add(note);
          if (note.type === 4) contact.moved = false;
          if (time > note.sect - 0.005) this.hit(note, time, 'perfect');
        }
      }
    }
    this.effects = this.effects.filter(effect => (effect.elapsed ?? 0) < hitEffectDuration);
    this.bad = this.bad.filter(effect => effect.elapsed < 0.8);
  }
  private hit(note: RuntimeNote, time: number, grade: Grade): void {
    this.armed.delete(note);
    const holding = note.is_hold && (grade === 'perfect' || grade === 'good');
    this.results.set(note, { grade, time, holding, safeFrames: holding ? 2 : undefined,
      completed: !holding, missed: grade === 'miss', visualMissed: false });
    note.clicked = grade === 'perfect' || grade === 'good';
    if (note.clicked) {
      this.onHit(note);
      this.addEffect(note, time, grade as HitGrade);
    }
    if (grade === 'bad' && note.type === 1) this.bad.push({ note, time, elapsed: 0, startedAt: this.now?.() ?? time });
    if (!holding) this.count(grade);
  }
  private addEffect(note: RuntimeNote, time: number, grade: HitGrade): void {
    this.effects.push({ ...createHitEffect(note, time, grade), elapsed: 0, startedAt: this.now?.() ?? time });
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
  get blockedTouches(): { id: string; x: number; y: number }[] {
    return [...this.contacts].filter(([, contact]) => contact.blocked).map(([id, { x, y }]) => ({ id, x, y }));
  }
  clearInput(): void { this.contacts.clear(); }
  get hitEffects(): readonly HitEffect[] { return this.effects; }
  get badEffects(): readonly BadEffect[] { return this.bad; }
}
