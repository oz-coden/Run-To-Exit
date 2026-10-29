export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "EngineError";
  }
  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}
export function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new EngineError(
      "INVALID_VALUE",
      `${name} must be finite and positive`,
      { field: name },
    );
  return value;
}
