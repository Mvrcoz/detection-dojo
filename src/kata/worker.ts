/**
 * Worker-thread entry point for `gradeRuleIsolated`. It grades exactly once and
 * reports the outcome (or the error) back to the parent, which owns the timeout.
 * Importing this file from the main thread does nothing.
 */

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { gradeRule } from './grade.ts';
import { toWireError } from './worker-protocol.ts';
import type { WorkerReply, WorkerRequest } from './worker-protocol.ts';

if (!isMainThread && parentPort !== null) {
  const request = workerData as WorkerRequest;
  let reply: WorkerReply;
  try {
    reply = { ok: true, result: gradeRule(request.kata, request.ruleYaml) };
  } catch (err) {
    reply = { ok: false, error: toWireError(err) };
  }
  parentPort.postMessage(reply);
}
