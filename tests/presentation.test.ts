import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { visibleWidth, type TUI } from '@earendil-works/pi-tui';
import { isRoutineMcpRefreshNotice } from '../src/notices.ts';
import { Turn, type Result } from '../src/turns.ts';
import { categories, compact, savedEditStats, toolAction, toolCategory, toolRow, toolTarget } from '../src/presentation.ts';
import { TurnView, type ViewHost } from '../src/view.ts';

initTheme('dark', false);
const success: Result = { content: [], isError: false };
const host: ViewHost = { ui: { requestRender() {} } as TUI, cwd: process.cwd(), showImages: false,
  imageWidthCells: 60, markdownTransformers: [], toolDefinition: () => undefined };

test('only routine MCP direct-tool refresh info notices are suppressible', () => {
  assert.equal(isRoutineMcpRefreshNotice('MCP: direct tools refreshed (+9, ~0, -0)', 'info'), true);
  assert.equal(isRoutineMcpRefreshNotice('MCP: direct tools refreshed (+0, ~0, -9)', 'warning'), false);
  assert.equal(isRoutineMcpRefreshNotice('MCP initialization failed: unavailable', 'error'), false);
});

test('fixed categories count calls, preserve builtin actions and unknown names, never infer shell intent', () => {
  const turn = new Turn();
  const names = ['read', 'read', 'read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls', 'mcp__read', 'Agent'];
  for (const [index, name] of names.entries()) {
    const tool = turn.tool(String(index), name, { path: 'same.ts', command: 'cat same.ts' });
    turn.tool(tool.id, name, tool.args); // streamed snapshot, not a new call
    turn.result(tool, success);
  }
  const group = turn.groupOf.get(turn.tools.get('0')!)!;
  assert.deepEqual(categories, ['Read', 'Search', 'Run', 'Edit', 'Subagent', 'Other']);
  assert.equal(group.summary(false), 'Process · Read 3 · Search 3 · Run 2 · Edit 2 · Subagent 1 · Other 1');
  assert.equal(group.activity(turn.running), '');
  assert.match(toolRow(turn.tools.get('10')!), /✓ mcp__read same.ts/);
  assert.match(toolRow(turn.tools.get('6')!), /✓ write same.ts/);
  assert.match(toolRow(turn.tools.get('8')!), /✓ find same.ts/);
  assert.match(toolRow(turn.tools.get('9')!), /✓ ls same.ts/);
});

test('custom and MCP activity stays in the folded header while saved details remain available', () => {
  const turn = new Turn();
  turn.running = true;
  const tool = turn.tool('mcp', 'litellm_tavily_search-tavily_search', { query: 'private query' });
  turn.startTool(tool, tool.args);
  const group = turn.groupOf.get(tool)!;
  assert.equal(group.summary(true), 'Working · Other 1 · 1 unfinished');
  assert.equal(group.activity(true), '');
  assert.match(toolRow(tool), /litellm_tavily_search-tavily_search private query/);
});

test('exact subagent tools share one category while actions and bounded targets omit payloads', () => {
  const turn = new Turn();
  const hugePrompt = 'PROMPT-MARKER-' + 'x'.repeat(1_000_000);
  const hugeMessage = 'MESSAGE-MARKER-' + 'y'.repeat(1_000_000);
  const cases = [
    ['Agent', { description: 'inspect auth', prompt: hugePrompt }, 'agent', 'inspect auth'],
    ['Agent', { name: 'worker', schedule: 'later', prompt: hugePrompt }, 'agent', 'worker'],
    ['Agent', { resume: 'agent-123', prompt: hugePrompt }, 'resume', 'agent-123'],
    ['SubagentWorkflow', { title: 'release checks', scriptPath: '/tmp/ignored.ts', script: hugePrompt }, 'workflow', 'release checks'],
    ['get_subagent_result', { agent_id: 'agent-123' }, 'result', 'agent-123'],
    ['steer_subagent', { agent_id: 'agent-123', message: hugeMessage }, 'steer', 'agent-123'],
    ['subagent', { agent: 'scout', task: hugePrompt }, 'agent', 'scout'],
    ['subagent', { workflowScript: hugePrompt }, 'workflow', ''],
    ['subagent', { workflowScriptPath: '/tmp/review.js' }, 'workflow', '/tmp/review.js'],
    ['subagent', { action: 'steer', id: 'run-456', message: hugeMessage }, 'steer', 'run-456'],
    ['subagent_supervisor', { action: 'pending' }, 'pending', ''],
    ['subagent_supervisor', { action: 'reply', replyTo: 'request-789', message: hugeMessage }, 'reply', 'request-789'],
  ] as const;
  for (const [index, [name, args, action, target]] of cases.entries()) {
    const tool = turn.tool(String(index), name, args);
    turn.result(tool, success);
    assert.equal(toolCategory(tool), 'Subagent');
    assert.equal(toolAction(tool), action);
    assert.equal(toolTarget(tool), target);
    assert.doesNotMatch(toolRow(tool), /PROMPT-MARKER|MESSAGE-MARKER/);
    assert.equal(tool.args, args);
    assert.equal(tool.result, success);
  }
  for (const name of ['agent', 'AgentResume', 'SubagentWorkflowExtra', 'get_subagent_results', 'steer-subagent', 'subagent-extra']) {
    const tool = turn.tool(`other-${name}`, name, { query: 'visible' });
    assert.equal(toolCategory(tool), 'Other');
  }
  const group = turn.groupOf.get(turn.tools.get('0')!)!;
  assert.equal(group.summary(false), 'Unfinished · Subagent 12 · Other 6 · 6 unfinished');
});

test('failed groups keep only the diagnostic line red', () => {
  const turn = new Turn();
  const tool = turn.tool('failed', 'read', { path: 'broken.ts' });
  turn.result(tool, { content: [], isError: true, details: { error: 'permission denied' } });
  const view = new TurnView(turn, { ...host, color: (name, value) => `<${name}>${value}</${name}>` });
  const rendered = view.render(100).join('\n');
  assert.match(rendered, /<warning>▸ Failed · Read 1 · 1 failed<\/warning>/);
  assert.match(rendered, /<error>  Failed: permission denied · read broken.ts<\/error>/);
});

test('pending, parallel starts, out-of-order and corrected results maintain current operation and failure maps', () => {
  const turn = new Turn();
  turn.running = true;
  const a = turn.tool('a', 'read', { path: 'a.ts' });
  const b = turn.tool('b', 'bash', { command: 'npm test' });
  const group = turn.groupOf.get(a)!;
  assert.equal(group.pending.size, 2);
  assert.equal(group.summary(false), 'Unfinished · Read 1 · Run 1 · 2 unfinished');
  turn.startTool(b, b.args);
  turn.startTool(a, a.args);
  assert.equal(group.summary(true), 'Working · Read 1 · Run 1 · 2 unfinished');
  assert.equal(group.activity(turn.running), 'Running: read a.ts', 'shell activity is skipped for the next non-shell call');
  turn.result(b, success, true);
  assert.equal(group.activity(turn.running), 'Running: read a.ts', 'partial updates do not reorder starts');
  turn.result(a, success);
  assert.equal(group.activity(turn.running), '', 'builtin shell activity stays inside the one-line summary');
  const failure = { content: [{ type: 'text', text: 'very detailed output\nCommand exited with code 1' }], isError: true };
  turn.result(b, failure);
  turn.result(b, failure);
  assert.equal(group.failed, 1);
  assert.equal(group.failures.size, 1);
  assert.equal(group.runningTools.size, 0);
  assert.equal(group.pending.size, 0);
  assert.equal(group.activity(turn.running), 'Failed: exit code 1 · bash npm test');
  assert.match(toolRow(b), /✗ bash npm test · exit code 1/);
  turn.result(b, success);
  assert.equal(group.failures.size, 0);
  assert.equal(group.activity(turn.running), '');
  assert.equal(group.summary(false), 'Process · Read 1 · Run 1');
  turn.startTool(b, b.args);
  assert.equal(group.completed, 1);
  turn.finish();
  assert.equal(group.summary(false), 'Unfinished · Read 1 · Run 1 · 1 unfinished');
  assert.equal(group.runningTools.size, 1);
  assert.equal(group.activity(turn.running), '');
  assert.equal(b.status, 'running', 'finish does not invent a result or failure');
  assert.equal(b.result?.isError, false);
});

for (const name of ['bash', 'powershell']) test(`${name} stays one-line while expanded details retain megabyte commands`, () => {
  const turn = new Turn();
  turn.running = true;
  const tool = turn.tool('shell', name, {});
  const group = turn.groupOf.get(tool)!;
  const view = new TurnView(turn, host);
  const command = 'COMMAND-MARKER first line\n' + 'x'.repeat(1_000_000) + '\nCOMMAND-TAIL';
  const output: Result = { content: [{ type: 'text', text: 'OUTPUT-MARKER' }], isError: false };
  const frame = () => view.render(120).map(stripVTControlCharacters).join('\n');
  const closed = () => assert.doesNotMatch(frame(), /COMMAND-MARKER|COMMAND-TAIL|OUTPUT-MARKER/);
  try {
    closed();
    for (const end of [14, 30, command.length]) {
      turn.tool(tool.id, name, { command: command.slice(0, end) });
      closed(); // Partial arguments before execution starts.
    }
    turn.startTool(tool, tool.args);
    for (const end of [14, 30, command.length]) {
      turn.tool(tool.id, name, { command: command.slice(0, end) });
      turn.result(tool, output, true);
      assert.equal(group.activity(true), '');
      assert.doesNotMatch(frame(), /Running:|Unfinished:/);
      assert.match(frame(), /Working · Run 1 · 1 unfinished/);
      closed();
    }
    turn.finish();
    assert.equal(group.activity(false), '');
    assert.doesNotMatch(frame(), /Running:|Unfinished:/);
    assert.match(frame(), /Unfinished · Run 1 · 1 unfinished/);
    closed();
    view.toggle();
    assert.match(frame(), new RegExp(`${name} COMMAND-MARKER first line`));
    assert.doesNotMatch(frame(), /COMMAND-TAIL|OUTPUT-MARKER/);
    view.toggleTool(0);
    const expanded = frame();
    assert.match(expanded, /COMMAND-MARKER/);
    assert.match(expanded, /COMMAND-TAIL/);
    assert.match(expanded, /OUTPUT-MARKER/);
    assert.equal(tool.args.command, command);
    assert.equal(tool.result, output);
    view.toggle();
    closed();
    turn.result(tool, { content: [], isError: true, details: { exitCode: 2 } });
    assert.equal(group.activity(false), `Failed: exit code 2 · ${name} COMMAND-MARKER first line`);
  } finally { view.dispose(); }
});

test('failure identity follows its bounded reason, with parallel and stopped activity on one line', () => {
  const turn = new Turn();
  turn.running = true;
  const failed = turn.tool('failed', 'bash', { command: 'npm test ' + 'x'.repeat(1_000_000) });
  const current = turn.tool('current', 'read', { path: 'src/auth.ts' });
  turn.startTool(current, current.args);
  turn.result(failed, { content: [], isError: true, details: { exitCode: 1 } });
  const group = turn.groupOf.get(failed)!;
  const activity = group.activity(turn.running);
  assert.ok(activity.startsWith('Failed: exit code 1 · bash npm test '));
  assert.ok(activity.endsWith(' · Running: read src/auth.ts'));
  assert.ok(activity.length < 230, 'long target is bounded before layout');
  const view = new TurnView(turn, host);
  let lines = view.render(35).map(stripVTControlCharacters);
  assert.equal(lines.length, 3, 'one spacer, one summary and exactly one status line');
  assert.equal(lines[2], '  Failed: exit code 1 · bash npm...');
  turn.finish();
  assert.ok(group.activity(turn.running).endsWith(' · Unfinished: read src/auth.ts'));
  lines = view.render(240).map(stripVTControlCharacters);
  assert.equal(lines.length, 3);
  assert.match(lines[2], /Unfinished: read src\/auth.ts/);
  assert.doesNotMatch(lines.join('\n'), /Running:/);
  assert.equal(current.status, 'running');
  assert.equal(group.failed, 1);
  assert.equal(group.completed, 0);
  turn.result(failed, success);
  const unknown = turn.tool('unknown', 'mcp__deploy', { query: 'staging' });
  turn.result(unknown, { content: [], isError: true, details: { error: 'permission denied' } });
  assert.equal(group.activity(turn.running), 'Failed: permission denied · mcp__deploy staging · Unfinished: read src/auth.ts');
  view.dispose();
});

test('generated failure and truncation hints are English while saved excerpts and custom names stay intact', () => {
  const turn = new Turn();
  const tool = turn.tool('shell', 'powershell', { command: 'npm test' });
  for (const [text, reason] of [
    ['Command timed out after 2.5 seconds', 'timed out after 2.5 seconds'],
    ['Command aborted', 'cancelled'],
    ['', 'tool execution failed'],
    ['失败原因', '失败原因'],
  ]) {
    const result = { content: [{ type: 'text', text }], isError: true, details: { truncated: true } };
    const saved = structuredClone(result);
    turn.result(tool, result);
    assert.equal(toolRow(tool), `✗ powershell npm test · ${reason} · output truncated`);
    assert.equal(turn.groupOf.get(tool)!.activity(false), `Failed: ${reason} · powershell npm test`);
    assert.equal(turn.groupOf.get(tool)!.summary(false), 'Failed · Run 1 · 1 failed · 1 truncated');
    assert.deepEqual(result, saved);
  }
  const custom = turn.tool('custom', '自定义工具', { query: '原始输入' });
  assert.equal(toolRow(custom), '○ 自定义工具 原始输入');
});

test('only successful saved numbered edit diffs yield counts, repeated results reuse stats', () => {
  const turn = new Turn();
  const edit = turn.tool('e', 'edit', { path: 'auth.ts' });
  const saved = { ...success, details: { diff: '  1 context\n- 2 old\n+ 2 new\n+ 3 extra\n    ...' } };
  turn.result(edit, saved);
  assert.deepEqual(edit.diffStats, { added: 2, removed: 1 });
  assert.match(toolRow(edit), /✓ edit auth.ts \+2 −1/);
  const stats = edit.diffStats;
  turn.result(edit, structuredClone(saved));
  assert.equal(edit.diffStats, stats);
  const write = turn.tool('w', 'write', { path: 'auth.ts', content: 'new' });
  turn.result(write, saved);
  assert.equal(write.diffStats, undefined);
  turn.result(edit, { ...saved, isError: true });
  assert.equal(edit.diffStats, undefined);
  turn.result(edit, saved, true);
  assert.equal(edit.diffStats, undefined);
  turn.result(edit, { ...success, details: { diff: '--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-old\n+new' } });
  assert.equal(edit.diffStats, undefined);
  assert.equal(savedEditStats('+no line number'), undefined);
  assert.equal(savedEditStats(''), undefined);
  assert.equal(savedEditStats('   ...'), undefined);
});

test('failure extraction bounds both text and block work and strips untrusted ANSI', t => {
  const trim = t.mock.method(String.prototype, 'trim');
  const turn = new Turn();
  const tool = turn.tool('e', 'bash', {});
  const inaccessible = { type: 'text', get text(): string { throw new Error('scanned old block'); } };
  turn.result(tool, { content: [inaccessible, ...Array.from({ length: 7 }, () => ({ type: 'text', text: ' '.repeat(1_000_000) })),
    { type: 'text', text: 'x'.repeat(1_000_000) + '\n\x1b[31mCommand exited with code 2\x1b[0m' }], isError: true });
  assert.equal(tool.errorSummary, 'exit code 2');
  assert.ok(trim.mock.calls.every(call => String(call.this).length <= 1024));
  turn.result(tool, { content: [], isError: true, details: { error: '\x1b[2J失败原因\n' + 'x'.repeat(1_000_000) } });
  assert.equal(tool.errorSummary, '失败原因');
  assert.equal(compact('\x1b[31m中文\x1b[0m\nnot shown'), '中文');
});

test('summary and unopened rows never scan saved outputs or diffs during render', () => {
  const turn = new Turn();
  const tool = turn.tool('e', 'edit', { path: 'cached.ts' });
  const result = { content: [], isError: false, details: { diff: '-1 before\n+1 after' } };
  turn.result(tool, result);
  Object.defineProperty(result, 'content', { get() { throw new Error('render read full output'); } });
  Object.defineProperty(result, 'details', { get() { throw new Error('render read saved diff'); } });
  const view = new TurnView(turn, host);
  view.render(80);
  view.toggle();
  for (let i = 0; i < 5; i++) assert.match(view.render(80).join('\n'), /edit cached.ts \+1 −1/);
});

test('trusted theme survives sanitizing, ANSI/CJK rows clip at narrow cell widths, activity clicks keep offsets', () => {
  const turn = new Turn();
  turn.running = true;
  const a = turn.tool('a', 'read', { path: '\x1b[2J认证/文件.ts' });
  const b = turn.tool('b', 'bash', { command: 'npm test' });
  turn.startTool(a, a.args);
  turn.startTool(b, b.args);
  const colors: string[] = [];
  const view = new TurnView(turn, { ...host, color: (name, text) => {
    colors.push(name);
    assert.doesNotMatch(text, /\x1b/);
    return `\x1b[33m${text}\x1b[0m`;
  } });
  let lines = view.render(80);
  assert.match(lines.join('\n'), /\x1b\[33m/);
  const y = lines.findIndex(line => line.includes('Running:'));
  const click = (y: number) => ({ type: 'click' as const, button: 'left' as const, x: 1, y, screenX: 1, screenY: y,
    width: 80, height: lines.length, shift: false, ctrl: false, alt: false });
  assert.ok(view.handleMouse(click(y))?.handled, 'second summary line shares disclosure region');
  lines = view.render(80);
  assert.equal(view.rows.size, 2);
  const rowY = lines.findIndex(line => stripVTControlCharacters(line).includes('▸ … bash npm test'));
  assert.equal(rowY, y + 2);
  assert.ok(view.handleMouse(click(rowY))?.handled);
  assert.equal(view.rows.get(b)?.open, true);
  view.rows.get(b)!.toggle();
  for (const width of [1, 2, 3, 7, 17]) {
    for (const line of view.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
  turn.result(a, success);
  turn.result(b, { content: [], isError: true, details: { exitCode: 1 } });
  view.render(80);
  assert.ok(colors.includes('warning') && colors.includes('success') && colors.includes('error'));
  turn.result(b, success);
  lines = view.render(80);
  assert.ok(!lines.some(line => line.includes('Running:') || line.includes('Failed')));
  const newRowY = lines.findIndex(line => stripVTControlCharacters(line).includes('▸ ✓ bash npm test'));
  assert.equal(newRowY, rowY - 1);
  assert.ok(view.handleMouse(click(newRowY))?.handled);
  assert.equal(view.rows.get(b)?.open, true);
  view.dispose();
});
