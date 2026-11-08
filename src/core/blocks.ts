import { ease } from './easing';

const eval_xy_track = (t, evs, getv, dflt, ex, ey) => {
    if (!evs || !evs.length || t < evs[0].time) return { x: dflt[0], y: dflt[1] };
    let i = 0;
    while (i + 1 < evs.length && evs[i + 1].time <= t) i++;
    const a = getv(evs[i]);
    if (i + 1 >= evs.length) return { x: a.x, y: a.y };
    const b = getv(evs[i + 1]);
    const span = evs[i + 1].time - evs[i].time;
    const p = span <= 0 ? 1 : (t - evs[i].time) / span;
    // ease 从 evs[i]（段起点），eased 值 clamp [0,1]
    const pa = Math.max(0, Math.min(1, ease(p, evs[i][ex] ?? 0)));
    const pb = Math.max(0, Math.min(1, ease(p, evs[i][ey] ?? 0)));
    return { x: a.x + (b.x - a.x) * pa, y: a.y + (b.y - a.y) * pb };
};

const eval_num_track = (t, evs, getv, dflt, ek) => {
    if (!evs || !evs.length || t < evs[0].time) return dflt;
    let i = 0;
    while (i + 1 < evs.length && evs[i + 1].time <= t) i++;
    const a = getv(evs[i]);
    if (i + 1 >= evs.length) return a;
    const b = getv(evs[i + 1]);
    const span = evs[i + 1].time - evs[i].time;
    const p = span <= 0 ? 1 : (t - evs[i].time) / span;
    // ease 从 evs[i]，clamp
    return a + (b - a) * Math.max(0, Math.min(1, ease(p, evs[i][ek] ?? 0)));
};

const safe_div = (a, b) => (Math.abs(b) < 1e-9 ? 1.0 : a / b);

// 方块几何变换：复刻游戏 UpdateBlockAnimations 管线（scale链 → rotate链 → move delta）
// 返回 { cx_px, cy_px, size_px: {x,y}, rotation }，坐标为 canvas 像素（y 下、原点左上）
export const block_transform = (b, t, w, h) => {
    const bl = b.bottomLeftPercentage, tr = b.topRightPercentage;
    const base_pct = { x: (bl.x + tr.x) / 2, y: (bl.y + tr.y) / 2 };
    const size_pct = { x: tr.x - bl.x, y: tr.y - bl.y };
    
    // 1) Scale 链：center 按比值链式变换（世界坐标 = pct*屏幕尺寸，y 上），size = base × 当前绝对 scale
    let cx = base_pct.x * w, cy = (1 - base_pct.y) * h;  // canvas y 下翻转
    let cur_sc = { x: 1, y: 1 };
    const ses = b.scaleEvents || [];
    if (ses.length > 0 && t >= ses[0].time) {
        let i = 0;
        while (i + 1 < ses.length && ses[i + 1].time <= t) i++;
        // 已完成段：链式比值 scale_{j+1}/scale_j 绕 anchor_j
        for (let j = 0; j < i; j++) {
            const a = ses[j].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const rx = safe_div(ses[j + 1].scale.x, ses[j].scale.x);
            const ry = safe_div(ses[j + 1].scale.y, ses[j].scale.y);
            cx = ax + rx * (cx - ax);
            cy = ay + ry * (cy - ay);
        }
        // 当前段（若有下一个事件）：插值 scale，比值 = interp/scale_i
        if (i + 1 < ses.length) {
            const sc_interp = eval_xy_track(t, ses, e => e.scale, [1, 1], "easeTypeX", "easeTypeY");
            const a = ses[i].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const rx = safe_div(sc_interp.x, ses[i].scale.x);
            const ry = safe_div(sc_interp.y, ses[i].scale.y);
            cx = ax + rx * (cx - ax);
            cy = ay + ry * (cy - ay);
            cur_sc = sc_interp;
        } else {
            cur_sc = ses[i].scale;
        }
    }

    // 2) Rotate 链：center 按角度增量链式旋转（canvas y 下 → 旋转取反），rotation = 当前绝对值
    let cur_rot = 0;
    const res = b.rotateEvents || [];
    if (res.length > 0 && t >= res[0].time) {
        let i = 0;
        while (i + 1 < res.length && res[i + 1].time <= t) i++;
        for (let j = 0; j < i; j++) {
            const delta = res[j + 1].rotation - res[j].rotation;
            const a = res[j].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const th = -delta * Math.PI / 180;  // canvas y 下取反
            const dx = cx - ax, dy = cy - ay;
            cx = ax + dx * Math.cos(th) - dy * Math.sin(th);
            cy = ay + dx * Math.sin(th) + dy * Math.cos(th);
        }
        if (i + 1 < res.length) {
            const rot_interp = eval_num_track(t, res, e => e.rotation, 0, "easeType");
            const delta = rot_interp - res[i].rotation;
            const a = res[i].anchor || { x: 0.5, y: 0.5 };
            const ax = a.x * w, ay = (1 - a.y) * h;
            const th = -delta * Math.PI / 180;
            const dx = cx - ax, dy = cy - ay;
            cx = ax + dx * Math.cos(th) - dy * Math.sin(th);
            cy = ay + dx * Math.sin(th) + dy * Math.cos(th);
            cur_rot = rot_interp;
        } else {
            cur_rot = res[i].rotation;
        }
    }

    // 3) Move delta：(movePct - basePct) × 屏幕尺寸 叠加到 center（y 翻转）
    const mv = b.moveEvents || [];
    if (mv.length > 0 && t >= mv[0].time) {
        const pos = eval_xy_track(t, mv, e => e.endPosition, [base_pct.x, base_pct.y], "easeTypeX", "easeTypeY");
        cx += (pos.x - base_pct.x) * w;
        cy += (base_pct.y - pos.y) * h;  // y 翻转
    }

    return {
        cx_px: cx,
        cy_px: cy,
        size_px: { x: Math.abs(size_pct.x * cur_sc.x) * w, y: Math.abs(size_pct.y * cur_sc.y) * h },
        rotation: cur_rot
    };
};

export const block_state = (b, t, speed = 1) => {
    if (t < b.appearTime || t >= b.disappearTime) return null;
    if (t < b.enableTime) {
        const duration = (b.disabledBlockShowDuration ?? 0.5) * speed;
        const alpha = duration <= 0 ? 1 : Math.max(0, Math.min(1, (t - b.appearTime) / duration));
        // PreviewBlockControl.UpdateBlockActivation: Disabled first, then Ready
        // only for the final .5 chart seconds before enableTime.
        return { phase: t < b.enableTime - (b.disabledBlockReadyDuration ?? 0.5) ? 2 : 0, alpha };
    }
    if (t < b.disableTime) return { phase: 1, alpha: 1 };
    return { phase: 2, alpha: 1 };
};


// Phigros 4.0.1.2 ARM64 JudgeControl.TryGetBlockingBlock @ RVA 0x1d75cc4.
// Both raw coverage and the inset coverage must be odd after subtract-block XOR.
export function blockingBlockAt(blocks: any[], time: number, x: number, y: number, width: number, height: number): any | null {
  if (!(width > 0 && height > 0)) return null;
  let normal: any = null, subtract: any = null;
  let rawNormal = false, rawSubtract = false, insetSubtract = false;
  const inset = height * 0.05;
  for (const block of blocks) {
    if (!(block.enableTime <= time && time < block.disableTime)) continue;
    const geometry = block_transform(block, time, width, height);
    const { size_px: size, rotation, cx_px: cx, cy_px: cy } = geometry;
    if (size.x < height * 0.00001 || size.y < height * 0.00001) continue;
    const angle = rotation * Math.PI / 180;
    const dx = x - cx, dy = y - cy;
    const localX = Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle));
    const localY = Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle));
    const isSubtract = !!block.isSubtract;
    const raw = localX <= size.x / 2 && localY <= size.y / 2;
    if (raw) {
      if (isSubtract) rawSubtract = !rawSubtract;
      else rawNormal = true;
    }
    const padding = isSubtract ? inset : -inset;
    const inside = localX <= Math.max(0, size.x / 2 + padding) && localY <= Math.max(0, size.y / 2 + padding);
    if (inside) {
      if (isSubtract) { insetSubtract = !insetSubtract; subtract ??= block; }
      else normal ??= block;
    }
  }
  return rawNormal !== rawSubtract && !!normal !== insetSubtract ? (normal ?? subtract) : null;
}

export interface BlockedTouch { id: string; x: number; y: number; }
export interface TouchFeedback extends BlockedTouch { scale: number; active: boolean; }
interface Slot extends TouchFeedback { from: number; target: number; since: number; }

// TouchBlockBehavior.Animation is a 0.1s linear scale, independent of chart speed.
export class BlockTouchFeedback {
  private slots: Slot[] = [];
  update(touches: readonly BlockedTouch[], now: number): void {
    const active = touches.slice(0, 10);
    for (const slot of this.slots) {
      this.advance(slot, now);
      const touch = active.find(touch => touch.id === slot.id);
      if (touch && slot.active) { slot.x = touch.x; slot.y = touch.y; }
      else if (slot.active) { slot.active = false; slot.from = slot.scale; slot.target = 0; slot.since = now; }
    }
    this.slots = this.slots.filter(slot => slot.active || slot.scale > 0);
    for (const touch of active) {
      if (this.slots.some(slot => slot.id === touch.id && slot.active)) continue;
      // Like the native ten-slot pool, a new touch can reuse a fading slot.
      if (this.slots.length >= 10) {
        const available = this.slots.findIndex(slot => !slot.active);
        if (available < 0) continue;
        this.slots.splice(available, 1);
      }
      this.slots.push({ ...touch, scale: 0, active: true, from: 0, target: 1, since: now });
    }
  }
  private advance(slot: Slot, now: number): void {
    const progress = Math.max(0, Math.min(1, (now - slot.since) / 0.1));
    slot.scale = slot.from + (slot.target - slot.from) * progress;
  }
  get visible(): readonly TouchFeedback[] { return this.slots; }
  clear(): void { this.slots = []; }
}
