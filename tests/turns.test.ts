import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Turn, toolLabel, type AssistantMessage } from '../src/turns.ts';

export function assistant(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
  return { role: 'assistant', content, stopReason, api: 'anthropic-messages', provider: 'test', model: 'test',
    timestamp: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

test('parallel tools reconcile execution and persisted results without double counting', () => {
  const turn = new Turn();
  const message = assistant([{ type: 'toolCall', id: 'a', name: 'bash', arguments: { command: 'true' } },
    { type: 'toolCall', id: 'b', name: 'read', arguments: { path: 'x' } }], 'toolUse');
  const before = JSON.stringify(message);
  turn.endAssistant(message);
  const a = turn.tools.get('a')!, b = turn.tools.get('b')!;
  turn.result(b, { content: [], isError: true });
  turn.result(a, { content: [], isError: false, details: { truncation: { truncated: true } } });
  turn.result(b, { content: [], isError: true });
  assert.equal(turn.completed, 1);
  assert.equal(turn.failed, 1);
  assert.equal(turn.truncated, 1);
  assert.match(turn.summary(), /1 failed/);
  assert.equal(JSON.stringify(message), before);
});

test('intermediate response becomes process; last answer and terminal failures survive', () => {
  const turn = new Turn();
  turn.endAssistant(assistant([{ type: 'text', text: 'intermediate' }]));
  turn.startAssistant(assistant([], 'pending'));
  assert.equal(turn.final, undefined);
  turn.endAssistant(assistant([{ type: 'toolCall', id: 'a', name: 'bash', arguments: {} }], 'aborted'));
  assert.match(turn.summary(), /alerts/);
  assert.match(turn.warnings.join(), /aborted/);
  turn.endAssistant(assistant([{ type: 'text', text: 'partial answer' }], 'length'));
  turn.finish();
  assert.equal(turn.final, turn.items.at(-1));
  assert.equal(turn.warnings.length, 2);
  assert.equal(turn.items.filter(item => item.kind === 'assistant').length, 3);
});

test('labels bound work and remove terminal control characters', () => {
  const turn = new Turn();
  const tool = turn.tool('a', 'bash', { command: 'python3\n' + 'x'.repeat(1_000_000) });
  assert.equal(toolLabel(tool), 'bash python3');
  tool.args = { command: '\x1b[2Jdanger\rhide' };
  assert.doesNotMatch(toolLabel(tool), /[\x00-\x1f]/);
});
