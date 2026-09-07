import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { visibleWidth, type TUI } from '@earendil-works/pi-tui';
import { Turn, type Result } from '../src/turns.ts';
import { compact, savedEditStats, toolRow } from '../src/presentation.ts';
import { TurnView, type ViewHost } from '../src/view.ts';

initTheme('dark', false);
const success: Result = { content: [], isError: false };
const host: ViewHost = { ui: { requestRender() {} } as TUI, cwd: process.cwd(), showImages: false,
  imageWidthCells: 60, markdownTransformers: [], toolDefinition: () => undefined };

test('fixed categories count calls, preserve builtin actions and unknown names, never infer shell intent', () => {
  const turn = new Turn();
  const names = ['read', 'read', 'read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls', 'mcp__read'];
  for (const [index, name] of names.entries()) {
    const tool = turn.tool(String(index), name, { path: 'same.ts', command: 'cat same.ts' });
    turn.tool(tool.id, name, tool.args); // streamed snapshot, not a new call
    turn.result(tool, success);
  }
  const group = turn.groupOf.get(turn.tools.get('0')!)!;
  assert.equal(group.summary(false), '已完成 · 读取 3 · 搜索 3 · 执行 2 · 修改 2 · 其他 1');
  assert.equal(group.activity(turn.running), '');
  assert.match(toolRow(turn.tools.get('10')!), /✓ mcp__read same.ts/);
  assert.match(toolRow(turn.tools.get('6')!), /✓ 写入 same.ts/);
  assert.match(toolRow(turn.tools.get('8')!), /✓ 查找 same.ts/);
  assert.match(toolRow(turn.tools.get('9')!), /✓ 列出 same.ts/);
});

test('pending, parallel starts, out-of-order and corrected results maintain current operation and failure maps', () => {
  const turn = new Turn();
  turn.running = true;
  const a = turn.tool('a', 'read', { path: 'a.ts' });
  const b = turn.tool('b', 'bash', { command: 'npm test' });
  const group = turn.groupOf.get(a)!;
  assert.equal(group.pending.size, 2);
  assert.doesNotMatch(group.summary(false), /已完成/);
  turn.startTool(a, a.args);
  turn.startTool(b, b.args);
  assert.equal(group.activity(turn.running), '当前 读取 a.ts');
  turn.result(b, success, true);
  assert.equal(group.activity(turn.running), '当前 读取 a.ts', 'partial updates do not reorder starts');
  turn.result(a, success);
  assert.equal(group.activity(turn.running), '当前 执行 npm test');
  const failure = { content: [{ type: 'text', text: 'very detailed output\nCommand exited with code 1' }], isError: true };
  turn.result(b, failure);
  turn.result(b, failure);
  assert.equal(group.failed, 1);
  assert.equal(group.failures.size, 1);
  assert.equal(group.runningTools.size, 0);
  assert.equal(group.pending.size, 0);
  assert.equal(group.activity(turn.running), '失败 退出码 1 · 执行 npm test');
  assert.match(toolRow(b), /✗ 执行 npm test · 退出码 1/);
  turn.result(b, success);
  assert.equal(group.failures.size, 0);
  assert.equal(group.activity(turn.running), '');
  assert.equal(group.summary(false), '已完成 · 读取 1 · 执行 1');
  turn.startTool(b, b.args);
  assert.equal(group.completed, 1);
  turn.finish();
  assert.doesNotMatch(group.summary(false), /已完成/);
  assert.equal(group.runningTools.size, 1);
  assert.equal(group.activity(turn.running), '未完成 执行 npm test');
  assert.equal(b.status, 'running', 'finish does not invent a result or failure');
  assert.equal(b.result?.isError, false);
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
  assert.ok(activity.startsWith('失败 退出码 1 · 执行 npm test '));
  assert.ok(activity.endsWith(' · 当前 读取 src/auth.ts'));
  assert.ok(activity.length < 230, 'long target is bounded before layout');
  const view = new TurnView(turn, host);
  let lines = view.render(35).map(stripVTControlCharacters);
  assert.equal(lines.length, 3, 'one spacer, one summary and exactly one status line');
  assert.match(lines[2], /^  失败 退出码 1 · 执行 npm test/);
  turn.finish();
  assert.ok(group.activity(turn.running).endsWith(' · 未完成 读取 src/auth.ts'));
  lines = view.render(240).map(stripVTControlCharacters);
  assert.equal(lines.length, 3);
  assert.match(lines[2], /未完成 读取 src\/auth.ts/);
  assert.doesNotMatch(lines.join('\n'), /当前/);
  assert.equal(current.status, 'running');
  assert.equal(group.failed, 1);
  assert.equal(group.completed, 0);
  turn.result(failed, success);
  const unknown = turn.tool('unknown', 'mcp__deploy', { query: 'staging' });
  turn.result(unknown, { content: [], isError: true, details: { error: 'permission denied' } });
  assert.equal(group.activity(turn.running), '失败 permission denied · mcp__deploy staging · 未完成 读取 src/auth.ts');
  view.dispose();
});

test('only successful saved numbered edit diffs yield counts, repeated results reuse stats', () => {
  const turn = new Turn();
  const edit = turn.tool('e', 'edit', { path: 'auth.ts' });
  const saved = { ...success, details: { diff: '  1 context\n- 2 old\n+ 2 new\n+ 3 extra\n    ...' } };
  turn.result(edit, saved);
  assert.deepEqual(edit.diffStats, { added: 2, removed: 1 });
  assert.match(toolRow(edit), /✓ 修改 auth.ts \+2 −1/);
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
  assert.equal(tool.errorSummary, '退出码 2');
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
  for (let i = 0; i < 5; i++) assert.match(view.render(80).join('\n'), /修改 cached.ts \+1 −1/);
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
  const y = lines.findIndex(line => line.includes('当前'));
  const click = (y: number) => ({ type: 'click' as const, button: 'left' as const, x: 1, y, screenX: 1, screenY: y,
    width: 80, height: lines.length, shift: false, ctrl: false, alt: false });
  assert.ok(view.handleMouse(click(y))?.handled, 'second summary line shares disclosure region');
  lines = view.render(80);
  assert.equal(view.rows.size, 2);
  const rowY = lines.findIndex(line => stripVTControlCharacters(line).includes('▸ … 执行 npm test'));
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
  assert.ok(!lines.some(line => line.includes('当前') || line.includes('失败')));
  const newRowY = lines.findIndex(line => stripVTControlCharacters(line).includes('▸ ✓ 执行 npm test'));
  assert.equal(newRowY, rowY - 1);
  assert.ok(view.handleMouse(click(newRowY))?.handled);
  assert.equal(view.rows.get(b)?.open, true);
  view.dispose();
});
