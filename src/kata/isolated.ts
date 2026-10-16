/**
 * Grade a rule in a worker thread so a hostile or careless regular expression
 * cannot freeze the CLI: the parent keeps the clock and terminates the worker
 * when time runs out (docs/ARCHITECTURE.md section 7, rule 2).
 */

import { Worker } from 'node:worker_threads';
import { GradeTimeoutError } from '../errors.ts';
import { fromWireError } from './worker-protocol.ts';
import type { WorkerReply, WorkerRequest } from './worker-protocol.ts';
import type { GradeResult, Kata } from './types.ts';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * A rule that allocates without bound should end the worker, not the learner's
 * machine. This is far above what grading a few hundred events needs.
 */
const WORKER_HEAP_LIMIT_MB = 512;

/** The worker next to this file: `worker.ts` when running from src/, `worker.js` from dist/. */
function workerUrl(): URL {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`./worker${extension}`, import.meta.url);
}

/**
 * `gradeRule` in a worker thread. Rejects with `GradeTimeoutError` when grading
 * takes longer than `timeoutMs` (default 5000, and worker start-up counts), and
 * with the same DojoError subclass `gradeRule` would have thrown for a bad rule.
 */
export function gradeRuleIsolated(
  kata: Kata,
  ruleYaml: string,
  opts: { timeoutMs?: number } = {},
): Promise<GradeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError(`timeoutMs must be a positive number (got ${timeoutMs})`));
  }

  return new Promise<GradeResult>((resolve, reject) => {
    const request: WorkerRequest = { kata, ruleYaml };
    const worker = new Worker(workerUrl(), {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_LIMIT_MB },
    });

    // Whichever of result, error, exit or timeout comes first wins; later ones are ignored.
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };

    const timer = setTimeout(() => finish(() => reject(new GradeTimeoutError(timeoutMs))), timeoutMs);

    worker.once('message', (reply: WorkerReply) =>
      finish(() => (reply.ok ? resolve(reply.result) : reject(fromWireError(reply.error)))),
    );
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`The grading worker stopped without an answer (exit code ${code}).`))),
    );
  });
}
