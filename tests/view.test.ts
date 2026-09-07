import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createEditToolDefinition, initTheme } from '@earendil-works/pi-coding-agent';
import { Text, visibleWidth, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { Turn } from '../src/turns.ts';
import { TurnView, type ViewHost } from '../src/view.ts';

initTheme('dark', false);
const click = (y: number, height: number, width = 80): TuiMouseEvent => ({
  type: 'click', button: 'left', x: 1, y, screenX: 1, screenY: y, width, height,
  shift: false, ctrl: false, alt: false,
});
const ui = { requestRender() {} } as TUI;
const host: ViewHost = { ui, cwd: process.cwd(), showImages: false, imageWidthCells: 60,
  markdownTransformers: [], toolDefinition: () => undefined };

test('closed turns build zero native tool renderers; mouse expands exactly the clicked row', () => {
  const turn = new Turn();
  let calls = 0;
  const view = new TurnView(turn, { ...host, toolDefinition: () => {
    calls++;
    return { renderCall: () => new Text('native details', 0, 0) };
  } });
  for (let i = 0; i < 1000; i++) {
    const tool = turn.tool(String(i), 'bash', { command: 'python3\n' + 'x'.repeat(10000) });
    turn.result(tool, { content: [{ type: 'text', text: 'hidden output' },
      ...(i % 333 === 0 ? [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=' }] : [])], isError: false });
  }
  let lines = view.render(80);
  assert.equal(calls, 0);
  assert.equal(view.rows.size, 0);
  assert.doesNotMatch(lines.join('\n'), /hidden output|python3/);
  const summaryY = lines.findIndex(line => line.includes('1000 tools'));
  assert.ok(view.handleMouse(click(summaryY, lines.length))?.handled);
  lines = view.render(80);
  assert.equal(calls, 0);
  assert.equal(view.rows.size, 1000);
  const toolY = lines.findIndex(line => line.includes('bash python3'));
  assert.ok(view.handleMouse(click(toolY, lines.length))?.handled);
  lines = view.render(80);
  assert.equal(calls, 1);
  assert.match(lines.join('\n'), /native details|hidden output/);
  for (const line of view.render(17)) assert.ok(visibleWidth(line) <= 17);
  view.toggle();
  view.render(80);
  assert.equal(view.rows.size, 0);
  for (let i = 0; i < 50; i++) { view.toggle(); view.render(80); view.toggle(); view.render(80); }
  assert.equal(view.rows.size, 0);
  assert.equal(calls, 1);
});

test('saved edit diff renders without reading today’s file', () => {
  const turn = new Turn();
  const tool = turn.tool('edit-1', 'edit', { path: '/does-not-exist/historical.ts', edits: [{ oldText: 'before', newText: 'after' }] });
  turn.result(tool, { content: [{ type: 'text', text: 'Saved result' }], isError: false,
    details: { diff: '-1 before\n+1 after', firstChangedLine: 1 } });
  const definition = createEditToolDefinition(process.cwd());
  const view = new TurnView(turn, { ...host, toolDefinition: () => definition });
  assert.equal(view.toggleTool(0), true);
  const text = stripVTControlCharacters(view.render(100).join('\n'));
  assert.match(text, /-1 before/);
  assert.match(text, /\+1 after/);
  assert.doesNotMatch(text, /ENOENT|Could not read/);
});
