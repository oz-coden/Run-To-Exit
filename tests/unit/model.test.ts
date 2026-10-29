import { describe, expect, it } from 'vitest';
import { advance, emptyPlan, initialWorld, startRun, stepRun, type Command, type Plan, type Run, type Stage } from '../../src/model';
import { stage, solution } from '../../src/stage';
const move = (direction: 'up' | 'right' | 'down' | 'left', count = 1): Command => ({ kind: 'move', direction, count });
const room = (): Stage => ({ id: 'fixture', title: 'Fixture', rows: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#######'], people: [{ id: 'A', name: 'A', x: 1, y: 2, color: 0 }, { id: 'B', name: 'B', x: 3, y: 2, color: 0 }], switches: [{ id: 's', name: 'S', x: 1, y: 1 }], doors: [{ id: 'd', name: 'D', x: 4, y: 2, switches: ['s'], mode: 'any', delay: 0, duration: 3 }], exits: [{ x: 5, y: 2 }], boxes: [] });
const ticks = (run: Run, n: number) => { for (let i = 0; i < n; i++) run = stepRun(run); return run; };
describe('world transactions', () => {
  it('advances the shared clock with waiting and exhausted programs', () => {
    let r = startRun(room(), { A: [{ kind: 'wait', steps: 3 }], B: [] });
    r = ticks(r, 2); expect(r.state.step).toBe(2); expect(r.state.people[0].pc).toBe(0);
    r = ticks(r, 3); expect(r.state.step).toBe(5); expect(r.state.people[0].pc).toBe(1);
  });
  it('commits independent simultaneous moves', () => {
    const r = stepRun(startRun(room(), { A: [move('up')], B: [move('down')] }));
    expect(r.state.people.map(p => p.y)).toEqual([1, 3]); expect(r.state.step).toBe(1);
  });
  it('rejects same-destination moves and retains the exact previous state', () => {
    const r = startRun(room(), { A: [move('right')], B: [move('left')] });
    const result = advance(r.stage, r.plan, r.state);
    expect(result.ok).toBe(false); if (result.ok) return;
    expect(result.conflict.kind).toBe('same-cell'); expect(result.state).toBe(r.state);
    expect(result.conflict.commands).toHaveLength(2); expect(result.logs.map(l => l.kind)).toEqual(['conflict']);
  });
  it.each(['swap', 'chain', 'stationary'])('rejects occupancy at step start: %s', type => {
    const s = room(); s.people[1].x = 2;
    const r = stepRun(startRun(s, { A: [move('right')], B: type === 'swap' ? [move('left')] : type === 'chain' ? [move('right')] : [] }));
    expect(r.conflict?.kind).toBe('occupied'); expect(r.state.step).toBe(0);
  });
  it.each(['wall', 'outside', 'box'])('rejects blocked direct movement: %s', type => {
    const s = room(); if (type === 'box') s.boxes.push({ id: 'box', x: 2, y: 2 });
    const r = stepRun(startRun(s, { A: [move(type === 'box' ? 'right' : 'left')], B: [] }));
    expect(r.conflict?.kind).toBe('blocked');
  });
  it('rolls back movement, operations, progress, signals, and logs as a whole', () => {
    const s = room(); s.people[1].x = 5;
    const r = startRun(s, { A: [{ kind: 'interact', target: 's' }], B: [move('right')] });
    const result = advance(s, r.plan, r.state);
    expect(result.ok).toBe(false); expect(result.state).toBe(r.initial);
    expect(result.state.pending).toEqual([]); expect(result.state.people[0].pc).toBe(0);
    expect(result.logs).toHaveLength(1);
  });
  it('applies an operation only on the following world step', () => {
    const s = room(); const p: Plan = { A: [{ kind: 'interact', target: 's' }], B: [move('right')] };
    const r = stepRun(startRun(s, p)); expect(r.conflict?.kind).toBe('blocked'); expect(r.state.doors[0].open).toBe(false);
    p.B.unshift({ kind: 'wait', steps: 1 });
    const good = ticks(startRun(s, p), 2); expect(good.conflict).toBeNull(); expect(good.state.people[1].x).toBe(4);
  });
  it('opens steps 6,7,8 after an operation at 5 and closes for 9', () => {
    const s = room(); let r = startRun(s, { A: [{ kind: 'wait', steps: 4 }, { kind: 'interact', target: 's' }], B: [] });
    r = ticks(r, 4); expect(r.state.doors[0].open).toBe(false);
    r = stepRun(r); expect(r.state.step).toBe(5); expect(r.state.doors[0]).toMatchObject({ open: true, until: 8 });
    r = ticks(r, 2); expect(r.state.doors[0].open).toBe(true);
    r = stepRun(r); expect(r.state.step).toBe(8); expect(r.state.doors[0].open).toBe(false);
  });
  it('delays door signals and keeps their complete duration', () => {
    const s = room(); s.doors[0].delay = 2;
    let r = startRun(s, { A: [{ kind: 'interact', target: 's' }], B: [] });
    r = ticks(r, 2); expect(r.state.doors[0].open).toBe(false); expect(r.state.pending).toHaveLength(1);
    r = stepRun(r); expect(r.state.doors[0]).toMatchObject({ open: true, until: 6 });
    r = ticks(r, 3); expect(r.state.doors[0].open).toBe(false);
  });
  it('rejects a closing door occupied by a person and rolls back the entire closing step', () => {
    const s = room(); s.doors[0].duration = 2;
    let r = ticks(startRun(s, { A: [{ kind: 'interact', target: 's' }, move('down')], B: [{ kind: 'wait', steps: 1 }, move('right'), { kind: 'wait', steps: 2 }] }), 2);
    const previous = r.state; r = stepRun(r);
    expect(r.conflict?.kind).toBe('door-closing'); expect(r.state).toBe(previous); expect(r.state.step).toBe(2);
  });
  it('accepts leaving a door on its final open step', () => {
    const s = room(); s.doors[0].duration = 2;
    const r = ticks(startRun(s, { A: [{ kind: 'interact', target: 's' }], B: [{ kind: 'wait', steps: 1 }, move('right', 2)] }), 3);
    expect(r.conflict).toBeNull(); expect(r.state.people[1].escaped).toBe(true); expect(r.state.doors[0].open).toBe(false);
  });
  it('aggregates duplicate and independent simultaneous signals without conflicts', () => {
    const s = room(); s.people[1] = { ...s.people[1], x: 2, y: 1 };
    const r = stepRun(startRun(s, { A: [{ kind: 'interact', target: 's' }], B: [{ kind: 'interact', target: 's' }] }));
    expect(r.conflict).toBeNull(); expect(r.state.doors[0].open).toBe(true);
  });
  it('requires both stage switches in the same step', () => {
    const r = ticks(startRun(stage, { A: [{ kind: 'interact', target: 's1' }], B: [{ kind: 'wait', steps: 1 }, { kind: 'interact', target: 's2' }] }), 2);
    expect(r.state.doors[0].open).toBe(false);
  });
  it('evaluates conditions using start state and uses one step to release', () => {
    let r = startRun(room(), { A: [{ kind: 'interact', target: 's' }], B: [{ kind: 'until', condition: { kind: 'door', door: 'd', open: true } }, move('down')] });
    r = stepRun(r); expect(r.state.people[1].pc).toBe(0);
    r = stepRun(r); expect(r.state.people[1].pc).toBe(1); expect(r.state.people[1].y).toBe(2);
    r = stepRun(r); expect(r.state.people[1].y).toBe(3); expect(r.logs.some(l => l.kind === 'release' && l.step === 2)).toBe(true);
  });
  it('freezes the execution plan and stage independently of edits', () => {
    const s = room(), plan: Plan = { A: [move('up')], B: [] }; const r = startRun(s, plan);
    plan.A[0] = move('down'); s.people[0].y = 4;
    const result = stepRun(r); expect(result.state.people[0].y).toBe(1); expect(r.stage.people[0].y).toBe(2);
    expect(Object.isFrozen(r.plan.A[0])).toBe(true);
  });
  it('reproduces state, logs, and history exactly from the same inputs', () => {
    expect(ticks(startRun(stage, solution, 42), 20)).toEqual(ticks(startRun(stage, solution, 42), 20));
  });
  it('is independent of character processing order', () => {
    const s = room(), reversed = structuredClone(s); reversed.people.reverse();
    const p = { A: [move('up')], B: [move('down')] };
    const a = advance(s, p, initialWorld(s)), b = advance(reversed, p, initialWorld(reversed));
    expect(a.logs).toEqual(b.logs);
    expect([...a.state.people].sort((a,b) => a.id.localeCompare(b.id))).toEqual([...b.state.people].sort((a,b) => a.id.localeCompare(b.id)));
  });
  it('completes the original two-person puzzle in nine shared steps', () => {
    const r = ticks(startRun(stage, solution), 30);
    expect(r.conflict).toBeNull(); expect(r.state.cleared).toBe(true); expect(r.state.step).toBe(9); expect(r.history).toHaveLength(9);
    expect(r.logs.filter(l => l.kind === 'escape').map(l => l.step)).toEqual([7, 9]); expect(r.logs.at(-1)?.kind).toBe('clear');
  });
  it('mixes direct moves and pathfinding; unreachable paths never auto-wait', () => {
    const r = stepRun(startRun(stage, { A: [{ kind: 'go', x: 8, y: 3 }], B: [] }));
    expect(r.conflict?.kind).toBe('unreachable'); expect(r.state.step).toBe(0);
  });
  it('does not route around people', () => {
    const s = room(); s.people[1].x = 2;
    const r = stepRun(startRun(s, { A: [{ kind: 'go', x: 3, y: 2 }], B: [] }));
    expect(r.conflict?.kind).toBe('occupied');
  });
  it('records starts/completions exactly once and conflict attempts separately from history', () => {
    const r = ticks(startRun(room(), { A: [move('up'), move('up')], B: [] }), 3);
    expect(r.history).toHaveLength(1); expect(r.logs.filter(l => l.kind === 'start')).toHaveLength(1);
    expect(r.logs.filter(l => l.kind === 'complete')).toHaveLength(1);
    expect(r.logs.at(-1)?.step).toBe(2); expect(r.logs.at(-1)?.kind).toBe('conflict');
    expect(stepRun(r)).toBe(r);
  });
  it('starts a long move once and completes it once', () => {
    const s = room(); const r = ticks(startRun(s, { A: [move('down', 2)], B: [] }), 2);
    expect(r.logs.filter(l => l.kind === 'start')).toHaveLength(1); expect(r.logs.filter(l => l.kind === 'complete')).toHaveLength(1);
  });
  it('validates command values and interaction ranges', () => {
    expect(stepRun(startRun(room(), { A: [move('up', 0)], B: [] })).conflict?.kind).toBe('invalid-command');
    expect(stepRun(startRun(room(), { A: [], B: [{ kind: 'interact', target: 's' }] })).conflict?.kind).toBe('out-of-range');
  });
  it('supports waiting for another person or position', () => {
    const s = room(); let r = startRun(s, { A: [{ kind: 'until', condition: { kind: 'at', actor: 'B', x: 3, y: 3 } }], B: [move('down')] });
    r = stepRun(r); expect(r.state.people[0].pc).toBe(0); r = stepRun(r); expect(r.state.people[0].pc).toBe(1);
  });
  it('has an empty, independent initial state', () => {
    const r = startRun(stage, emptyPlan(stage)); expect(r.state.step).toBe(0); expect(r.history).toEqual([]); expect(r.state.people.every(p => !p.escaped)).toBe(true);
  });
});
