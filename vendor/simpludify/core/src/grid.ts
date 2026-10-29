import { EngineError } from "./diagnostics";

// A deliberate dense-allocation limit, independent of the host's Array maximum.
const maxCells = 16_777_216;
export type GridVisitor<T> = (value: T, x: number, y: number) => void;

/** Fixed-size, row-major data. Cells retain values/references without owning them. */
export class Grid<T> {
  readonly #width: number;
  readonly #height: number;
  readonly #cells: T[];

  static get maxCells(): number {
    return maxCells;
  }
  /** The same initial value/reference is stored in every cell, including functions. */
  constructor(width: number, height: number, initial: T) {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isSafeInteger(width * height) ||
      width * height > maxCells
    )
      throw new EngineError(
        "GRID_SIZE",
        "Grid dimensions must be positive safe integers within the dense cell limit",
        { width, height, maxCells },
      );
    this.#width = width;
    this.#height = height;
    this.#cells = new Array<T>(width * height).fill(initial);
  }
  /** Calls initialize(x,y) once per cell, left-to-right then top-to-bottom. */
  static generate<T>(
    width: number,
    height: number,
    initialize: (x: number, y: number) => T,
  ): Grid<T> {
    if (typeof initialize !== "function")
      throw new EngineError(
        "INVALID_VALUE",
        "Grid initializer must be a function",
      );
    // The partially initialized Grid is private until every callback succeeds.
    const grid = new Grid<T>(width, height, undefined as T);
    let index = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) grid.#cells[index++] = initialize(x, y);
    return grid;
  }
  get width(): number {
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }
  /** False for noninteger/nonfinite/out-of-range coordinates; never clips. */
  inBounds(x: number, y: number): boolean {
    return this.#contains(x, y);
  }
  #contains(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.#width &&
      y < this.#height
    );
  }
  #index(x: number, y: number, operation: string): number {
    if (!this.#contains(x, y))
      throw new EngineError(
        "GRID_BOUNDS",
        "Grid coordinate is outside its bounds",
        {
          x,
          y,
          width: this.#width,
          height: this.#height,
          operation,
        },
      );
    return y * this.#width + x;
  }
  get(x: number, y: number): T {
    // Every index exists, including cells whose legitimate value is undefined.
    return this.#cells[this.#index(x, y, "get")] as T;
  }
  set(x: number, y: number, value: T): void {
    this.#cells[this.#index(x, y, "set")] = value;
  }
  /** Replaces every cell with the same value/reference; does not dispose old values. */
  fill(value: T): void {
    this.#cells.fill(value);
  }
  /** Live row-major traversal; later cells observe writes made by earlier visits. */
  forEach(visit: GridVisitor<T>): void {
    this.forEachRect(0, 0, this.#width, this.#height, visit);
  }
  /** Fully contained rectangle, with nonnegative integer extents; empty is valid. */
  forEachRect(
    x: number,
    y: number,
    width: number,
    height: number,
    visit: GridVisitor<T>,
  ): void {
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      x < 0 ||
      y < 0 ||
      width < 0 ||
      height < 0 ||
      x > this.#width ||
      y > this.#height ||
      width > this.#width - x ||
      height > this.#height - y
    )
      throw new EngineError(
        "GRID_BOUNDS",
        "Grid rectangle is outside its bounds",
        {
          x,
          y,
          rectWidth: width,
          rectHeight: height,
          width: this.#width,
          height: this.#height,
          operation: "forEachRect",
        },
      );
    if (typeof visit !== "function")
      throw new EngineError("INVALID_VALUE", "Grid visitor must be a function");
    if (width === 0 || height === 0) return;
    const endX = x + width,
      endY = y + height;
    for (let cy = y; cy < endY; cy++) {
      let index = cy * this.#width + x;
      for (let cx = x; cx < endX; cx++)
        visit(this.#cells[index++] as T, cx, cy);
    }
  }
}
