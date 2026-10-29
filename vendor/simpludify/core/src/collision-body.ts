import { Component, type ComponentType, defineComponent } from "./component";
import { Transform } from "./components";
import { EngineError, positive } from "./diagnostics";
export const BodyType = { Static: "static", Dynamic: "dynamic" } as const;
export type BodyType = (typeof BodyType)[keyof typeof BodyType];
/** Position-correction participation, not velocity integration or a rigid body. */
export class CollisionBody extends Component {
  static readonly type: ComponentType<CollisionBody> =
    defineComponent<CollisionBody>("CollisionBody", [Transform.type]);
  readonly type = CollisionBody.type;
  readonly motion: BodyType;
  readonly mass: number;
  constructor(options: { motion?: BodyType; mass?: number } = {}) {
    super();
    this.motion = options.motion ?? BodyType.Dynamic;
    this.mass = positive(options.mass ?? 1, "mass");
    if (
      !Object.values(BodyType).includes(this.motion) ||
      !Number.isFinite(1 / this.mass)
    )
      throw new EngineError(
        "INVALID_VALUE",
        "Invalid collision body motion or mass",
      );
  }
  get inverseMass(): number {
    return this.motion === BodyType.Dynamic ? 1 / this.mass : 0;
  }
}
