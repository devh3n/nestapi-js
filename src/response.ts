/**
 * Read-only view of a successful API response.
 *
 * `data`, `meta` and `source` are deeply frozen. Read them directly, as in
 * `res.data.bmi`, or follow a dot path with {@link ApiResponse.get}.
 */
export class ApiResponse {
  readonly #data: any;
  readonly #meta: any;
  readonly #source: Readonly<Record<string, any>>;

  private constructor(data: unknown, meta: unknown, source: Record<string, unknown>) {
    this.#data = deepFreeze(data);
    this.#meta = deepFreeze(meta);
    this.#source = deepFreeze(source);
    Object.freeze(this);
  }

  /**
   * Build a response from the decoded JSON of a successful answer. The values
   * of `data`, `meta` and `source` are frozen in place, not copied.
   */
  static fromObject(payload: Record<string, unknown>): ApiResponse {
    const { data, meta, source } = payload;

    return new ApiResponse(data ?? null, meta ?? null, isPlainObject(source) ? source : {});
  }

  /** Object, array, string or null. */
  get data(): any {
    return this.#data;
  }

  /** Service-defined; null when absent. */
  get meta(): any {
    return this.#meta;
  }

  /** Service identity. Unrelated to the version in the URL. */
  get source(): Readonly<Record<string, any>> {
    return this.#source;
  }

  /**
   * Read from `data` by dot path, e.g. `input.age` or `items.0.title`.
   * A key that exists with a null value returns null, not `defaultValue`.
   */
  get(path: string, defaultValue: any = null): any {
    let value = this.#data;

    for (const key of path.split(".")) {
      if (!hasKey(value, key)) {
        return defaultValue;
      }

      value = value[key];
    }

    return value;
  }

  /** Whether `data` has this top-level key, or index if it is an array. */
  has(key: string | number): boolean {
    return hasKey(this.#data, String(key));
  }

  /** The getters live on the prototype, so JSON.stringify would see nothing. */
  toJSON(): { data: any; meta: any; source: Readonly<Record<string, any>> } {
    return { data: this.#data, meta: this.#meta, source: this.#source };
  }
}

/** Also accepts plain objects from another realm, such as an iframe. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return /^\d+$/.test(key) && Object.hasOwn(value, key);
  }

  return isPlainObject(value) && Object.hasOwn(value, key);
}

// Iterative, because JSON can nest deeper than the call stack.
function deepFreeze<T>(root: T): T {
  const pending: unknown[] = [root];

  while (pending.length > 0) {
    const value = pending.pop();

    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
      Object.freeze(value);

      for (const item of Object.values(value)) {
        pending.push(item);
      }
    }
  }

  return root;
}
