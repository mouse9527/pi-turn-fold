import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createEditToolDefinition, initTheme } from '@earendil-works/pi-coding-agent';
import { Text, visibleWidth, type Component, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
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
  const summaryY = lines.findIndex(line => line.includes('Run 1000'));
  assert.ok(view.handleMouse(click(summaryY, lines.length))?.handled);
  lines = view.render(80);
  assert.equal(calls, 0);
  assert.equal(view.rows.size, 1000);
  const toolY = lines.findIndex(line => line.includes('✓ bash python3'));
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

test('inline dispatch reaches saved edit and nested native details without losing open state or executing tools', () => {
  let executions = 0;
  let nested: (Component & { open: boolean; saved: string }) | undefined;
  const editDefinition = createEditToolDefinition(process.cwd());
  const turn = new Turn();
  turn.running = true;
  const edit = turn.tool('edit', 'edit', { path: '/not-on-disk/auth.ts', edits: [{ oldText: 'before', newText: 'after' }] });
  turn.result(edit, { content: [{ type: 'text', text: 'saved edit result' }], isError: false,
    details: { diff: '-1 before\n+1 after', firstChangedLine: 1 } });
  const custom = turn.tool('nested', 'custom-agent', { query: 'saved parent input' });
  turn.startTool(custom, custom.args);
  turn.result(custom, { content: [{ type: 'text', text: 'saved nested output' }], isError: false }, true);
  const view = new TurnView(turn, { ...host, toolDefinition: name => name === 'edit' ? editDefinition : {
    name: 'custom-agent', label: 'Custom', description: 'Synthetic saved nested renderer', parameters: {} as any,
    execute: async () => { executions++; return { content: [] }; },
    renderCall: () => new Text('registered parent renderer', 0, 0),
    renderResult: (...[result, _options, _theme, context]: Parameters<NonNullable<typeof editDefinition.renderResult>>) => {
      const child = context.lastComponent as typeof nested ?? {
        open: false, saved: '',
        render() { return [`${this.open ? '▾' : '▸'} saved child invocation`,
          ...(this.open ? ['saved child parameter: value', this.saved] : [])]; },
        invalidate() {},
        handleMouse(event: TuiMouseEvent) {
          if (event.y !== 0 || event.type !== 'click' || event.button !== 'left') return;
          this.open = !this.open;
          return { handled: true };
        },
      };
      child.saved = result.content[0].type === 'text' ? result.content[0].text! : '';
      nested = child;
      return child;
    },
  } });
  const lines = (width = 100) => view.render(width).map(stripVTControlCharacters);
  const dispatch = (label: string, width = 100, type: TuiMouseEvent['type'] = 'click') => {
    const rendered = lines(width);
    const y = rendered.findIndex(line => line.includes(label));
    assert.ok(y >= 0, `missing ${label}: ${rendered.join('\n')}`);
    return view.handleMouse({ ...click(y, rendered.length, width), x: 10, screenX: 10, type });
  };
  assert.ok(dispatch('Running: custom-agent')?.handled, 'whole activity line opens the group');
  assert.ok(dispatch('✓ edit')?.handled);
  assert.match(lines().join('\n'), /Arguments[\s\S]*oldText[\s\S]*-1 before[\s\S]*\+1 after/);
  assert.equal(view.rows.get(edit)?.open, true);
  assert.ok(dispatch('… custom-agent')?.handled);
  assert.ok(dispatch('▸ saved child invocation')?.handled);
  assert.match(lines().join('\n'), /saved child parameter: value[\s\S]*saved nested output/);
  const instance = nested;
  for (const width of [100, 40, 100]) {
    turn.result(custom, { content: [{ type: 'text', text: 'new saved nested output' }], isError: false }, true);
    assert.match(lines(width).join('\n'), /new saved nested output/);
    assert.equal(nested, instance, 'native lastComponent is retained on new results');
    assert.equal(nested?.open, true);
    assert.equal((view.rows.get(custom) as any).native.expanded, true, 'child clicks do not toggle the native parent region');
    assert.equal(view.rows.get(custom)?.open, true);
    assert.equal(view.rows.get(edit)?.open, true);
    assert.equal(view.open, true);
    assert.equal(dispatch('saved child invocation', width, 'wheel'), undefined);
    assert.equal(dispatch('saved child invocation', width, 'drag'), undefined);
    assert.equal(dispatch('Running: custom-agent', width, 'wheel'), undefined);
    assert.ok(dispatch('▾ saved child invocation', width)?.handled);
    assert.equal(nested?.open, false);
    assert.ok(dispatch('▸ saved child invocation', width)?.handled);
  }
  turn.result(custom, { content: [{ type: 'text', text: 'final nested result' }], isError: false });
  assert.match(lines().join('\n'), /final nested result/);
  assert.equal(nested, instance);
  assert.equal(nested?.open, true);
  assert.doesNotMatch(lines().join('\n'), /Running:/);
  assert.ok(dispatch('✓ custom-agent')?.handled, 'item collapses after the activity line disappears');
  assert.equal(view.rows.get(custom)?.open, false);
  for (let i = 0; i < 3; i++) {
    assert.ok(dispatch('▾ Process')?.handled);
    assert.equal(view.open, false);
    assert.ok(dispatch('▸ Process')?.handled);
    assert.equal(view.open, true);
    assert.ok(dispatch('✓ edit')?.handled);
    assert.match(lines().join('\n'), /-1 before[\s\S]*\+1 after/);
  }
  assert.equal(executions, 0);
  view.dispose();
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
