import { Grid } from '@simpludify/core';

export interface Point { x: number; y: number }
export type Direction = 'up' | 'right' | 'down' | 'left';
export type Condition =
  | { kind: 'door'; door: string; open: boolean }
  | { kind: 'escaped'; actor: string }
  | { kind: 'at'; actor: string; x: number; y: number };
export type Command =
  | { kind: 'move'; direction: Direction; count: number }
  | { kind: 'go'; x: number; y: number }
  | { kind: 'interact'; target: string }
  | { kind: 'wait'; steps: number }
  | { kind: 'until'; condition: Condition };
export type Plan = Record<string, Command[]>;
export interface Person extends Point { id: string; name: string; color: number }
export interface Switch extends Point { id: string; name: string }
export interface Door extends Point {
  id: string; name: string; switches: string[]; mode: 'all' | 'any';
  delay: number; duration: number;
}
export interface Stage {
  id: string; title: string; rows: string[]; people: Person[];
  switches: Switch[]; doors: Door[]; exits: Point[]; boxes: (Point & { id: string })[];
}
export interface PersonState extends Point {
  id: string; escaped: boolean; pc: number; progress: number;
  path: Point[] | null;
}
export interface DoorState { id: string; open: boolean; until: number }
export interface Signal { at: number; door: string; duration: number }
export interface World {
  step: number; people: PersonState[]; doors: DoorState[]; pending: Signal[]; cleared: boolean;
}
export type LogKind = 'start' | 'complete' | 'move' | 'operate' | 'door' | 'wait' | 'release' | 'escape' | 'clear' | 'conflict';
export interface LogEntry {
  step: number; kind: LogKind; text: string; actors: string[]; cells: Point[];
  command?: number; effectiveStep?: number;
}
export interface Conflict {
  step: number;
  kind: 'blocked' | 'occupied' | 'same-cell' | 'unreachable' | 'out-of-range' | 'door-closing' | 'invalid-command';
  message: string; actors: string[]; cells: Point[];
  commands: { actor: string; index: number; command: Command | null }[];
}
export type StepResult =
  | { ok: true; state: World; logs: LogEntry[] }
  | { ok: false; state: World; logs: LogEntry[]; conflict: Conflict };
export interface Run {
  version: 1; seed: number; stage: Stage; plan: Plan; initial: World; state: World;
  history: World[]; logs: LogEntry[]; conflict: Conflict | null;
}

export const directions: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 },
};
export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const key = (p: Point) => `${p.x},${p.y}`;
const copy = <T>(value: T): T => structuredClone(value);
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function terrain(stage: Stage): Grid<string> {
  return Grid.generate(stage.rows[0].length, stage.rows.length, (x, y) => stage.rows[y][x]);
}
export function initialWorld(stage: Stage): World {
  if (!stage.rows.length || !stage.rows[0].length || stage.rows.some(r => r.length !== stage.rows[0].length)) throw new Error('Stage must be rectangular');
  const grid = terrain(stage);
  const ids = stage.people.map(p => p.id);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Person IDs must be unique');
  const occupied = [...stage.people, ...stage.boxes];
  if (new Set(occupied.map(key)).size !== occupied.length) throw new Error('Initial occupants overlap');
  for (const p of [...occupied, ...stage.exits, ...stage.switches, ...stage.doors]) {
    if (!grid.inBounds(p.x, p.y) || grid.get(p.x, p.y) === '#') throw new Error('Stage object outside floor');
  }
  for (const door of stage.doors) {
    if (!Number.isSafeInteger(door.delay) || door.delay < 0 || !Number.isSafeInteger(door.duration) || door.duration < 1) throw new Error('Invalid door timing');
    if (!door.switches.length || door.switches.some(id => !stage.switches.some(s => s.id === id))) throw new Error('Invalid door wiring');
    if (occupied.some(p => same(p, door))) throw new Error('Initial closed door is occupied');
  }
  return freeze({ step: 0, people: stage.people.map(p => ({ id: p.id, x: p.x, y: p.y, escaped: false, pc: 0, progress: 0, path: null })), doors: stage.doors.map(d => ({ id: d.id, open: false, until: 0 })), pending: [], cleared: false });
}
export function emptyPlan(stage: Stage): Plan { return Object.fromEntries(stage.people.map(p => [p.id, []])); }
export function startRun(stage: Stage, plan: Plan, seed = 0): Run {
  const snapshot = freeze(copy(stage));
  const initial = initialWorld(snapshot);
  return { version: 1, seed, stage: snapshot, plan: freeze(copy(plan)), initial, state: initial, history: [], logs: [], conflict: null };
}
function walkable(stage: Stage, world: World, grid: Grid<string>, p: Point): boolean {
  return grid.inBounds(p.x, p.y) && grid.get(p.x, p.y) !== '#' && !stage.boxes.some(b => same(b, p)) && !stage.doors.some(d => same(d, p) && !world.doors.find(s => s.id === d.id)?.open);
}
/** Terrain-only BFS. People are deliberately not avoided; conflicts remain visible. */
export function findPath(stage: Stage, world: World, from: Point, to: Point): Point[] | null {
  const grid = terrain(stage);
  if (!walkable(stage, world, grid, to)) return null;
  const queue = [{ x: from.x, y: from.y }];
  const previous = new Map<string, Point | null>([[key(from), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (same(p, to)) {
      const path: Point[] = [];
      let current = p;
      while (!same(current, from)) { path.unshift(current); current = previous.get(key(current))!; }
      return path;
    }
    for (const direction of ['up', 'right', 'down', 'left'] as const) {
      const delta = directions[direction], next = { x: p.x + delta.x, y: p.y + delta.y };
      if (!previous.has(key(next)) && walkable(stage, world, grid, next)) { previous.set(key(next), p); queue.push(next); }
    }
  }
  return null;
}
export function conditionMet(world: World, condition: Condition): boolean {
  if (condition.kind === 'door') return world.doors.some(d => d.id === condition.door && d.open === condition.open);
  const actor = world.people.find(p => p.id === condition.actor);
  return !!actor && (condition.kind === 'escaped' ? actor.escaped : !actor.escaped && same(actor, condition));
}
function valid(command: Command, stage: Stage): boolean {
  switch (command.kind) {
    case 'move': return !!directions[command.direction] && Number.isSafeInteger(command.count) && command.count > 0;
    case 'go': return Number.isSafeInteger(command.x) && Number.isSafeInteger(command.y);
    case 'wait': return Number.isSafeInteger(command.steps) && command.steps > 0;
    case 'interact': return stage.switches.some(s => s.id === command.target);
    case 'until': {
      const c = command.condition;
      if (c.kind === 'door') return stage.doors.some(d => d.id === c.door) && typeof c.open === 'boolean';
      if (c.kind === 'at') return stage.people.some(p => p.id === c.actor) && Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y);
      return c.kind === 'escaped' && stage.people.some(p => p.id === c.actor);
    }
  }
}

/** A transaction: only a successful result publishes the candidate or its events. */
export function advance(stage: Stage, plan: Plan, state: World): StepResult {
  if (state.cleared) return { ok: true, state, logs: [] };
  const step = state.step + 1, candidate = copy(state), logs: LogEntry[] = [], grid = terrain(stage);
  const intents: { person: PersonState; target: Point; command: Command; complete: boolean; operating?: string }[] = [];
  const log = (kind: LogKind, text: string, actors: string[] = [], cells: Point[] = [], command?: number, effectiveStep?: number) => logs.push({ step, kind, text, actors, cells: cells.map(p => ({ x: p.x, y: p.y })), ...(command === undefined ? {} : { command }), ...(effectiveStep === undefined ? {} : { effectiveStep }) });
  const fail = (kind: Conflict['kind'], message: string, actors: string[], cells: Point[]): StepResult => {
    const conflict: Conflict = { step, kind, message, actors, cells: cells.map(p => ({ x: p.x, y: p.y })), commands: actors.map(actor => { const p = state.people.find(p => p.id === actor)!; return { actor, index: p.pc, command: plan[actor]?.[p.pc] ?? null }; }) };
    return { ok: false, state, conflict, logs: [{ step, kind: 'conflict', text: message, actors, cells: cells.map(p => ({ x: p.x, y: p.y })) }] };
  };
  // Sorting IDs makes outcome and log ordering independent of the stage's person roster.
  for (const person of [...candidate.people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (person.escaped) continue;
    const command = plan[person.id]?.[person.pc];
    if (!command) continue; // The clock advances even if every program is exhausted.
    if (!valid(command, stage)) return fail('invalid-command', '命令の値または対象が正しくありません。', [person.id], [person]);
    if (!person.progress) log('start', `命令 ${person.pc + 1} を開始`, [person.id], [person], person.pc);
    let target = { x: person.x, y: person.y }, complete = false, operating: string | undefined;
    switch (command.kind) {
      case 'move': {
        const d = directions[command.direction];
        target = { x: person.x + d.x, y: person.y + d.y }; complete = person.progress + 1 >= command.count; break;
      }
      case 'go': {
        if (!person.path) person.path = findPath(stage, state, person, command);
        if (!person.path) return fail('unreachable', `目的地 (${command.x}, ${command.y}) への道がありません。閉じた扉も経路を遮ります。`, [person.id], [command]);
        target = person.path.shift() ?? target; complete = !person.path.length; break;
      }
      case 'wait': complete = person.progress + 1 >= command.steps; log('wait', `待機 ${person.progress + 1}/${command.steps}`, [person.id], [person], person.pc); break;
      case 'until':
        complete = conditionMet(state, command.condition);
        log(complete ? 'release' : 'wait', complete ? '条件が成立。待機を解除' : '条件待機中', [person.id], [person], person.pc); break;
      case 'interact': {
        const device = stage.switches.find(s => s.id === command.target)!;
        if (Math.abs(device.x - person.x) + Math.abs(device.y - person.y) > 1) return fail('out-of-range', `${device.name} は操作範囲外です。同じマスか上下左右の隣まで移動してください。`, [person.id], [device]);
        complete = true; operating = device.id; break;
      }
    }
    if (!same(target, person) && !walkable(stage, state, grid, target)) return fail('blocked', '移動先は壁・閉じた扉・箱・マップの外です。', [person.id], [target]);
    intents.push({ person, target, command, complete, operating });
  }
  const moving = intents.filter(i => !same(i.person, i.target));
  for (let i = 0; i < moving.length; i++) {
    const a = moving[i];
    const shared = moving.filter(b => same(b.target, a.target));
    if (shared.length > 1) return fail('same-cell', '同じマスへの同時進入です。待機や経路でタイミングを調整してください。', shared.map(i => i.person.id), [a.target]);
    const occupant = state.people.find(p => !p.escaped && p.id !== a.person.id && same(p, a.target));
    if (occupant) return fail('occupied', 'ステップ開始時に人物がいるマスには進めません。位置交換・追従する連鎖移動も禁止です。', [a.person.id, occupant.id], [a.target]);
  }
  const signals = new Set<string>();
  for (const intent of intents) {
    const { person, target, complete, operating } = intent;
    if (!same(person, target)) { person.x = target.x; person.y = target.y; log('move', `(${target.x}, ${target.y}) へ移動`, [person.id], [target], person.pc); }
    if (operating) { signals.add(operating); log('operate', `${stage.switches.find(s => s.id === operating)!.name} に信号を送信`, [person.id], [target], person.pc); }
    person.progress++;
    if (complete) { log('complete', `命令 ${person.pc + 1} を完了`, [person.id], [target], person.pc); person.pc++; person.progress = 0; person.path = null; }
  }
  for (const person of [...candidate.people].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (!person.escaped && stage.exits.some(exit => same(exit, person))) { person.escaped = true; log('escape', '出口に到達。脱出しました', [person.id], [person]); }
  }
  for (const door of stage.doors) {
    const activated = door.mode === 'all' ? door.switches.every(s => signals.has(s)) : door.switches.some(s => signals.has(s));
    if (activated) candidate.pending.push({ at: step + 1 + door.delay, door: door.id, duration: door.duration });
  }
  // Candidate door values describe passability at the *next* step's start.
  const nextStep = step + 1;
  for (const door of candidate.doors) {
    const config = stage.doors.find(d => d.id === door.id)!;
    for (const signal of candidate.pending.filter(s => s.at === nextStep && s.door === door.id)) door.until = Math.max(door.until, signal.at + signal.duration - 1);
    const open = door.until >= nextStep;
    if (door.open && !open) {
      const people = candidate.people.filter(p => !p.escaped && same(p, config));
      if (people.length || stage.boxes.some(b => same(b, config))) return fail('door-closing', `${config.name} が次ステップに閉じますが、マスが占有されています。`, people.map(p => p.id), [config]);
    }
    if (open !== door.open) log('door', `${config.name} は Step ${nextStep} から${open ? `開放（Step ${door.until} まで）` : '閉鎖'}`, [], [config], undefined, nextStep);
    door.open = open;
  }
  candidate.pending = candidate.pending.filter(s => s.at > nextStep);
  candidate.step = step;
  candidate.cleared = candidate.people.every(p => p.escaped);
  if (candidate.cleared) log('clear', '全員脱出！ 計画成功');
  return { ok: true, state: freeze(candidate), logs: freeze(logs) };
}
export function stepRun(run: Run): Run {
  if (run.conflict || run.state.cleared) return run;
  const result = advance(run.stage, run.plan, run.state);
  return { ...run, state: result.state, conflict: result.ok ? null : result.conflict, logs: [...run.logs, ...result.logs], history: result.ok ? [...run.history, result.state] : run.history };
}
export function commandText(command: Command): string {
  const arrows: Record<Direction, string> = { up: '↑ 上', right: '→ 右', down: '↓ 下', left: '← 左' };
  switch (command.kind) {
    case 'move': return `${arrows[command.direction]}へ ${command.count} マス`;
    case 'go': return `(${command.x}, ${command.y}) まで自動移動`;
    case 'interact': return `スイッチ ${command.target.toUpperCase()} を操作`;
    case 'wait': return `${command.steps} ステップ待機`;
    case 'until': {
      const c = command.condition;
      return c.kind === 'door' ? `扉が${c.open ? '開く' : '閉じる'}まで待機` : c.kind === 'escaped' ? `${c.actor} の脱出を待機` : `${c.actor} が (${c.x}, ${c.y}) に来るまで待機`;
    }
  }
}
