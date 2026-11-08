import { expect, it } from 'vitest';
import { find_event, get_event_val, get_fp, init_speed_events, linear, rotate_point } from '../../src/core/timeline';

it('handles gaps, out-of-order seeks, and integrated negative speeds', () => {
  const events = [{ startTime: 0, endTime: 10, value: 2 }, { startTime: 12, endTime: 20, value: -1 }];
  init_speed_events(events);
  expect(find_event(11, events)).toBe(1);
  expect(get_fp(15, events)).toBe(17);
  expect(get_fp(5, events)).toBe(10);
  expect(get_fp(11, events)).toBe(21);
  expect(get_fp(0, [])).toBe(0);
});
it('handles zero-duration transitions and rotated local coordinates', () => {
  expect(linear(1, 1, 1, 0, 2)).toBe(2);
  expect(get_event_val(5, [{ startTime: 0, endTime: 10, start: 0, end: 1 }], 'start', 'end')).toBe(0.5);
  const [x, y] = rotate_point(10, 20, 100, 90);
  expect(x).toBeCloseTo(10); expect(y).toBeCloseTo(120);
});
