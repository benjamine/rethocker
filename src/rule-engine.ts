/**
 * Rule engine — low-level rule/sequence registration and handle creation.
 *
 * Knows how to translate typed rule objects into IPC commands (via `send`),
 * and wires up emitter listeners for intercept/handler patterns.
 * Has no knowledge of the high-level string-based rule syntax.
 */

import type { TypedEmitter } from "./daemon.ts";
import type {
  KeyCombo,
  KeyEvent,
  RuleAction,
  RuleHandle,
  RuleOptions,
  SequenceHandle,
  SequenceOptions,
} from "./types.ts";
import { DEFAULT_SEQUENCE_TIMEOUT_MS } from "./types.ts";

let _seq = 0;
export function genID(prefix: string) {
  return `${prefix}_${Date.now()}_${++_seq}`;
}

function makeHandle(
  id: string,
  send: (obj: Record<string, unknown>) => void,
  removeCmd: string,
  toggleCmd: string,
): RuleHandle {
  return {
    id,
    remove: () => send({ cmd: removeCmd, id }),
    enable: () => send({ cmd: toggleCmd, id, enabled: true }),
    disable: () => send({ cmd: toggleCmd, id, enabled: false }),
  };
}

export function addRule(
  send: (obj: Record<string, unknown>) => void,
  trigger: KeyCombo,
  action: RuleAction,
  opts: RuleOptions = {},
): RuleHandle {
  const id = opts.id ?? genID("rule");
  send({
    cmd: "add_rule",
    id,
    trigger,
    action,
    conditions: opts.conditions ?? {},
    onKeyUp: opts.onKeyUp ?? false,
    enabled: !(opts.disabled ?? false),
  });
  return makeHandle(id, send, "remove_rule", "set_rule_enabled");
}

export function addSequence(
  send: (obj: Record<string, unknown>) => void,
  steps: KeyCombo[],
  action: RuleAction,
  opts: SequenceOptions = {},
): SequenceHandle {
  const id = opts.id ?? genID("seq");
  send({
    cmd: "add_sequence",
    id,
    steps,
    action,
    timeoutMs: opts.timeoutMs ?? DEFAULT_SEQUENCE_TIMEOUT_MS,
    consume: opts.consume ?? false,
    conditions: opts.conditions ?? {},
    enabled: !(opts.disabled ?? false),
  });
  return makeHandle(id, send, "remove_sequence", "set_sequence_enabled");
}

export function intercept(
  send: (obj: Record<string, unknown>) => void,
  emitter: TypedEmitter,
  trigger: KeyCombo,
  handler: (e: KeyEvent) => void,
  opts: RuleOptions = {},
): RuleHandle {
  const eventID = genID("intercept");
  const handle = addRule(send, trigger, { type: "emit", eventID }, opts);
  emitter.on("event", (eid, ruleID) => {
    if (eid === eventID) {
      handler({
        type: "keydown",
        keyCode: trigger.keyCode,
        modifiers: trigger.modifiers ?? [],
        ruleID,
        eventID,
        suppressed: true,
      });
    }
  });
  return handle;
}
