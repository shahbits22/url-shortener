import { randomInt } from "node:crypto";

export const CODE_LENGTH = 7;
export const CODE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"; // base36, lowercase
export const CODE_PATTERN = /^[0-9a-z]{7}$/;

/**
 * Paths that must always route to their own handlers and are never resolved as
 * short codes. Also checked at generation time (unreachable at fixed length 7 —
 * future-proofing for a variable-length generator, per the spec).
 */
export const RESERVED_CODES = new Set(["links", "health"]);

export class CodeGenerator {
  /** Test-only seed queue, drained before the collision/reserved checks run. */
  private queue: string[] = [];

  seed(codes: string[]): void {
    this.queue.push(...codes);
  }

  clear(): void {
    this.queue = [];
  }

  /** Next candidate: a seeded value if the queue is non-empty, else random. */
  next(): string {
    const seeded = this.queue.shift();
    if (seeded !== undefined) return seeded;
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return out;
  }
}

export function isReserved(code: string): boolean {
  return RESERVED_CODES.has(code.toLowerCase());
}
