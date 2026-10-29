import { EngineError } from "./diagnostics";
export const RANDOM_ALGORITHM = "lcg32-fnv1a-utf16le-v1";
export const DEFAULT_RANDOM_STREAM = "$default";
export interface RandomState {
  readonly name: string;
  readonly seed: number;
  readonly state: number;
  readonly calls: number;
}
export interface RandomSnapshot {
  readonly algorithm: typeof RANDOM_ALGORITHM;
  readonly seed: number;
  readonly streams: readonly RandomState[];
}
function uint32(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new EngineError(
      "INVALID_SEED",
      "Seed must be an unsigned 32-bit integer",
    );
  return value;
}
/** Uses the cross-host Crypto capability when present; ES Math.random is the fallback. */
function automaticSeed(): number {
  const capability = (
    globalThis as unknown as {
      crypto?: { getRandomValues(array: Uint32Array): Uint32Array };
    }
  ).crypto;
  if (capability?.getRandomValues) {
    try {
      const buffer = new Uint32Array(1);
      capability.getRandomValues(buffer);
      return buffer[0] ?? 0;
    } catch {
      /* Hosts may expose an unavailable capability; use the portable fallback. */
    }
  }
  return Math.floor(Math.random() * 4294967296);
}
/** FNV-1a over master seed (four LE bytes), then exact UTF-16 code units (two LE bytes each). */
export function deriveStreamSeed(seed: number, name: string): number {
  uint32(seed);
  let hash = 2166136261;
  const byte = (value: number) => {
    hash = Math.imul(hash ^ (value & 255), 16777619) >>> 0;
  };
  for (let shift = 0; shift < 32; shift += 8) byte(seed >>> shift);
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    byte(code);
    byte(code >>> 8);
  }
  return hash;
}
export class RandomStream {
  private current: number;
  private count = 0;
  private dead = false;
  /** @internal Streams are acquired from RandomManager.stream(). */
  constructor(private readonly initial: number) {
    this.current = uint32(initial);
  }
  get seed(): number {
    return this.initial;
  }
  get state(): number {
    return this.current;
  }
  get calls(): number {
    return this.count;
  }
  get disposed(): boolean {
    return this.dead;
  }
  next(): number {
    if (this.dead)
      throw new EngineError(
        "RANDOM_DISPOSED",
        "Random stream has been disposed",
      );
    this.current = (Math.imul(1664525, this.current) + 1013904223) >>> 0;
    this.count++;
    return this.current / 4294967296;
  }
  /** @internal */ dispose(): void {
    this.dead = true;
  }
}
/** Independent deterministic streams. State survives Scene replacement and ends with its owner. */
export class RandomManager {
  private readonly initial: number;
  private readonly streams = new Map<string, RandomStream>();
  private readonly defaultStream: RandomStream;
  private dead = false;
  constructor(seed?: number) {
    this.initial = uint32(seed ?? automaticSeed());
    this.defaultStream = new RandomStream(this.initial);
    this.streams.set(DEFAULT_RANDOM_STREAM, this.defaultStream);
  }
  get seed(): number {
    return this.initial;
  }
  get disposed(): boolean {
    return this.dead;
  }
  private alive(): void {
    if (this.dead)
      throw new EngineError(
        "RANDOM_DISPOSED",
        "Random manager has been disposed",
      );
  }
  next(): number {
    this.alive();
    return this.defaultStream.next();
  }
  stream(name: string): RandomStream {
    this.alive();
    if (typeof name !== "string" || !name.length || name.length > 256)
      throw new EngineError(
        "INVALID_STREAM",
        "Stream name must contain 1 to 256 UTF-16 code units",
      );
    let stream = this.streams.get(name);
    if (!stream) {
      stream = new RandomStream(deriveStreamSeed(this.seed, name));
      this.streams.set(name, stream);
    }
    return stream;
  }
  snapshot(): RandomSnapshot {
    return {
      algorithm: RANDOM_ALGORITHM,
      seed: this.seed,
      streams: [...this.streams]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, s]) => ({
          name,
          seed: s.seed,
          state: s.state,
          calls: s.calls,
        })),
    };
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    for (const stream of this.streams.values()) stream.dispose();
  }
}
