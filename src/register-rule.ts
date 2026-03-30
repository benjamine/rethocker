/**
 * Translates high-level RethockerRule objects into low-level rule-engine calls.
 *
 * This is the "compiler" layer: it parses key strings, resolves rule variants,
 * and dispatches to addRule / addSequence / intercept accordingly.
 */

import type { TypedEmitter } from "./daemon.ts";
import { parseKey } from "./parse-key.ts";
import { addRule, addSequence, genID, intercept } from "./rule-engine.ts";
import type {
  HandlerRule,
  RemapRule,
  RethockerRule,
  ShellRule,
} from "./rule-types.ts";
import type {
  AppCondition,
  KeyEvent,
  RuleConditions,
  RuleHandle,
  SequenceHandle,
} from "./types.ts";

// ─── Condition builder ────────────────────────────────────────────────────────
// Merges the ergonomic `app` shorthand field into a RuleConditions object,
// combined with any explicitly passed `conditions`.
//
// Prefix a value with "!" to negate (invert) the match:
//   app: "!VSCode"  → fire when VSCode is NOT frontmost
//   app: ["!Chrome", "!Safari"]  → fire in any app except Chrome and Safari

function toAppCondition(value: string): AppCondition {
  const invert = value.startsWith("!");
  const name = invert ? value.slice(1) : value;
  // Bundle IDs contain dots (e.g. "com.apple.Terminal"); display names don't
  return name.includes(".") ? { bundleID: name, invert } : { name, invert };
}

function buildConditions(rule: {
  app?: string | string[];
  conditions?: RuleConditions;
}): RuleConditions | undefined {
  const base = rule.conditions ?? {};

  // app → activeApp conditions (supports "!" prefix for negation)
  const activeApp =
    rule.app !== undefined
      ? [...(base.activeApp ?? []), ...[rule.app].flat().map(toAppCondition)]
      : base.activeApp;

  const merged: RuleConditions = { ...base, activeApp };

  const hasAny =
    merged.activeApp !== undefined || merged.runningApps !== undefined;

  return hasAny ? merged : undefined;
}

// ─── Rule registration ────────────────────────────────────────────────────────

function registerRemap(
  send: (obj: Record<string, unknown>) => void,
  rule: RemapRule,
): RuleHandle {
  const parsed = parseKey(rule.key);
  const target = parseKey(rule.remap);
  const action =
    target.kind === "sequence"
      ? ({ type: "remap_sequence", steps: target.steps } as const)
      : ({
          type: "remap",
          keyCode: target.combo.keyCode,
          modifiers: target.combo.modifiers,
        } as const);

  if (parsed.kind === "single") {
    return addRule(send, parsed.combo, action, {
      id: rule.id,
      conditions: buildConditions(rule),
      disabled: rule.disabled,
    });
  }

  // Sequence trigger: intercept the full sequence then post the remap target
  return addSequence(send, parsed.steps, action, {
    id: rule.id,
    conditions: rule.conditions,
    disabled: rule.disabled,
    consume: true, // always consume — we're replacing the sequence
  });
}

function resolveExecute(execute: string | string[]): string {
  return Array.isArray(execute) ? execute.join(" && ") : execute;
}

function registerShell(
  send: (obj: Record<string, unknown>) => void,
  rule: ShellRule,
): RuleHandle | SequenceHandle {
  const parsed = parseKey(rule.key);
  const conditions = buildConditions(rule);
  const command = resolveExecute(rule.execute);
  if (parsed.kind === "single") {
    return addRule(
      send,
      parsed.combo,
      { type: "run", command },
      { id: rule.id, conditions, disabled: rule.disabled },
    );
  }
  return addSequence(
    send,
    parsed.steps,
    { type: "run", command },
    {
      id: rule.id,
      conditions,
      disabled: rule.disabled,
      consume: rule.consume,
      timeoutMs: rule.sequenceTimeoutMs,
    },
  );
}

function registerHandler(
  send: (obj: Record<string, unknown>) => void,
  emitter: TypedEmitter,
  rule: HandlerRule,
): RuleHandle | SequenceHandle {
  const parsed = parseKey(rule.key);
  const conditions = buildConditions(rule);

  if (parsed.kind === "single") {
    return intercept(send, emitter, parsed.combo, rule.handler, {
      id: rule.id,
      conditions,
      disabled: rule.disabled,
    });
  }

  // Sequence + handler: register as emit, wire up listener internally
  const ruleID = rule.id ?? genID("seq");
  const eventID = `${ruleID}_event`;
  const lastStep = parsed.steps.at(-1);

  const handle = addSequence(
    send,
    parsed.steps,
    { type: "emit", eventID },
    {
      id: ruleID,
      conditions,
      disabled: rule.disabled,
      consume: rule.consume,
      timeoutMs: rule.sequenceTimeoutMs,
    },
  );

  emitter.on("sequence", (seqRuleID, eid) => {
    if (eid === eventID) {
      const event: KeyEvent = {
        type: "keydown",
        keyCode: lastStep?.keyCode ?? 0,
        modifiers: lastStep?.modifiers ?? [],
        ruleID: seqRuleID,
        eventID,
        suppressed: true,
      };
      rule.handler(event);
    }
  });

  return handle;
}

export function registerRule(
  send: (obj: Record<string, unknown>) => void,
  emitter: TypedEmitter,
  rule: RethockerRule,
): RuleHandle | SequenceHandle {
  if (rule.remap !== undefined) return registerRemap(send, rule);
  if (rule.execute !== undefined) return registerShell(send, rule);
  return registerHandler(send, emitter, rule);
}
