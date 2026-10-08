import { describe, expect, it } from 'vitest';
import source from './worker-js.js?raw';

type Msg = { type: string; level?: string; text?: string; message?: string; status?: string };

/** Loads the worker source against a fake worker scope and runs one script to completion. */
async function run(code: string): Promise<Msg[]> {
  const msgs: Msg[] = [];
  const scope = { postMessage: (m: Msg) => msgs.push(m), addEventListener: () => {}, onmessage: null as null | ((e: unknown) => unknown) };
  new Function('self', source)(scope);
  await scope.onmessage!({ data: { code } });
  const start = Date.now();
  while (!msgs.some((m) => m.type === 'done')) {
    if (Date.now() - start > 3000) throw new Error('worker never finished');
    await new Promise((r) => setTimeout(r, 5));
  }
  return msgs;
}
const logs = (m: Msg[]) => m.filter((x) => x.type === 'log').map((x) => x.text);
const done = (m: Msg[]) => m.find((x) => x.type === 'done')!.status;

describe('JavaScript worker runtime', () => {
  it('captures console output and finishes ok', async () => {
    const m = await run(`console.log('hi', 1, true); console.warn('careful');`);
    expect(logs(m)).toEqual(['hi 1 true', 'careful']);
    expect(m.find((x) => x.level === 'warn')?.text).toBe('careful');
    expect(done(m)).toBe('ok');
  });

  it('formats values like a console would', async () => {
    const m = await run(`
      const o = { a: 1, b: [1, 2, { c: 3 }], s: 'x' }; o.self = o;
      console.log(o);
      console.log(new Map([[1, 'a']]), new Set([1, 2]), undefined, null, 10n, Symbol('s'), -0);
      console.log([1, , 3].length, function foo() {}, class Bar {}, new Date(0));
    `);
    expect(logs(m)).toEqual([
      `{ a: 1, b: [ 1, 2, { c: 3 } ], s: "x", self: [Circular] }`,
      `Map(1) { 1 => "a" } Set(2) { 1, 2 } undefined null 10n Symbol(s) -0`,
      `3 [Function: foo] [class Bar] 1970-01-01T00:00:00.000Z`,
    ]);
  });

  it('supports top-level await and waits for timers', async () => {
    const m = await run(`
      await new Promise((r) => setTimeout(r, 10));
      console.log('after await');
      setTimeout(() => console.log('later'), 20);
    `);
    expect(logs(m)).toEqual(['after await', 'later']);
    expect(done(m)).toBe('ok');
  });

  it('reports thrown errors with the error name and ends with an error status', async () => {
    const m = await run(`console.log('before'); null.x;`);
    expect(logs(m)).toEqual(['before']);
    const err = m.find((x) => x.type === 'error')!;
    expect(err.message).toMatch(/^TypeError:/);
    expect(done(m)).toBe('error');
  });

  it('reports non-Error throws', async () => {
    const m = await run(`throw 'plain string'`);
    expect(m.find((x) => x.type === 'error')!.message).toContain('plain string');
  });

  it('reports errors thrown inside timers without hanging', async () => {
    const m = await run(`setTimeout(() => { throw new RangeError('boom'); }, 5);`);
    expect(m.find((x) => x.type === 'error')!.message).toContain('RangeError: boom');
    expect(done(m)).toBe('ok');
  });

  it('truncates very large arrays instead of flooding output', async () => {
    const m = await run(`console.log(Array.from({ length: 5000 }, (_, i) => i));`);
    expect(logs(m)[0]).toContain('4900 more items');
    expect(logs(m)[0]!.length).toBeLessThan(1000);
  });

  it('survives hostile getters', async () => {
    const m = await run(`console.log({ get bad() { throw new Error('nope'); }, ok: 1 });`);
    expect(logs(m)[0]).toBe('{ bad: [Getter threw], ok: 1 }');
  });
});
