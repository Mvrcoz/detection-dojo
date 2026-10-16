/**
 * Messages exchanged between `gradeRuleIsolated` and its worker thread.
 *
 * Errors cannot cross the thread boundary as class instances (structured clone
 * keeps the message but loses the class and its extra fields), so DojoError
 * subclasses travel as plain data and are rebuilt on the other side. That way a
 * caller can keep using `instanceof RuleParseError` whether grading ran in the
 * worker or in-process.
 */

import {
  DojoError,
  KataFormatError,
  RuleParseError,
  UnsupportedFeatureError,
} from '../errors.ts';
import type { GradeResult, Kata } from './types.ts';

/** `workerData` for the grading worker. */
export interface WorkerRequest {
  kata: Kata;
  ruleYaml: string;
}

export interface WireError {
  name: string;
  message: string;
  stack: string | undefined;
  /** Set for DojoError subclasses. */
  code: string | undefined;
  /** RuleParseError.path */
  path: string | undefined;
  /** UnsupportedFeatureError.feature */
  feature: string | undefined;
}

export type WorkerReply = { ok: true; result: GradeResult } | { ok: false; error: WireError };

export function toWireError(err: unknown): WireError {
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error instanceof DojoError ? error.code : undefined,
    path: error instanceof RuleParseError ? error.path : undefined,
    feature: error instanceof UnsupportedFeatureError ? error.feature : undefined,
  };
}

/**
 * Rebuild the error a worker reported. These are the DojoError subclasses
 * grading can raise; any other DojoError keeps its `code`, and anything that is
 * not a DojoError comes back as a plain Error carrying the worker's stack
 * because it is a bug, not something the learner did.
 */
export function fromWireError(wire: WireError): Error {
  switch (wire.name) {
    case 'RuleParseError':
      return new RuleParseError(wire.message, wire.path);
    case 'UnsupportedFeatureError':
      return new UnsupportedFeatureError(wire.feature ?? 'unknown', wire.message);
    case 'KataFormatError':
      return new KataFormatError(wire.message);
    default: {
      const error = wire.code === undefined ? new Error(wire.message) : new DojoError(wire.code, wire.message);
      if (wire.code === undefined && wire.stack !== undefined) error.stack = wire.stack;
      return error;
    }
  }
}
