import type { ActionReader } from "./actions";
import { Actor } from "./actor";
import {
  ActionMovement,
  Motion,
  Renderable,
  Shape,
  Transform,
  type VisualSource,
} from "./components";
export interface CharacterOptions {
  id?: string;
  x?: number;
  y?: number;
  speed?: number;
  size?: number;
  color?: number;
  movement?: ActionReader<"axis2d">;
  source?: VisualSource;
}
export class CharacterActor extends Actor {
  get x(): number {
    return this.require(Transform.type).x;
  }
  set x(value: number) {
    this.require(Transform.type).x = value;
  }
  get y(): number {
    return this.require(Transform.type).y;
  }
  set y(value: number) {
    this.require(Transform.type).y = value;
  }
}
/** Composition preset; the simulation has no knowledge of characters. */
export function Character(options: CharacterOptions = {}): CharacterActor {
  const actor = new CharacterActor(
    options.id === undefined ? {} : { id: options.id },
  );
  try {
    actor.add(new Transform({ x: options.x ?? 400, y: options.y ?? 225 }));
    actor.add(
      new Renderable({
        width: options.size ?? 32,
        height: options.size ?? 32,
        ...(options.color === undefined ? {} : { color: options.color }),
        source: options.source ?? { kind: "shape", shape: Shape.Character },
      }),
    );
    actor.add(new Motion({ speed: options.speed ?? 180 }));
    if (options.movement) actor.add(new ActionMovement(options.movement));
    return actor;
  } catch (error) {
    actor.dispose();
    throw error;
  }
}
