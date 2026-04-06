import { describe, expect, it } from 'bun:test';
import { coerceDates } from '../../../src/plugins/markdown/util';

describe('coerceDates', () => {
  it('converts a Date object to YYYY-MM-DD string', () => {
    const result = coerceDates({ date: new Date('2026-03-31') });
    expect(result.date).toBe('2026-03-31');
  });

  it('leaves string values unchanged', () => {
    const result = coerceDates({ date: '2026-03-31', title: 'hello' });
    expect(result.date).toBe('2026-03-31');
    expect(result.title).toBe('hello');
  });

  it('leaves numbers and booleans unchanged', () => {
    const result = coerceDates({ count: 3, active: true });
    expect(result.count).toBe(3);
    expect(result.active).toBe(true);
  });

  it('recurses into nested objects', () => {
    const result = coerceDates({ meta: { created: new Date('2025-01-01') } });
    expect((result.meta as Record<string, unknown>).created).toBe('2025-01-01');
  });

  it('does not recurse into arrays', () => {
    const dates = [new Date('2025-01-01')];
    const result = coerceDates({ items: dates });
    expect(result.items).toBe(dates);
  });
});
