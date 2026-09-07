import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { AssistantMessageComponent, ToolExecutionComponent, initTheme } from '@earendil-works/pi-coding-agent';
import { Container, Spacer, Text, type Component, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { Turn, type AssistantMessage, type Result } from '../src/turns.ts';
import { TurnView, type ViewHost } from '../src/view.ts';

initTheme('dark', false);
const assistant = (content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage => ({
  role: 'assistant', content, stopReason, api: 'anthropic-messages', provider: 'test', model: 'test', timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const text = (text: string) => ({ type: 'text' as const, text });
const call = (id: string) => ({ type: 'toolCall' as const, id, name: 'probe', arguments: { query: id } });
const host: ViewHost = { ui: { requestRender() {} } as TUI, cwd: process.cwd(), showImages: false,
  imageWidthCells: 60, markdownTransformers: [], toolDefinition: () => undefined };
const render = (view: TurnView) => stripVTControlCharacters(view.render(100).join('\n'));
const groups = (turn: Turn) => turn.segments.filter(segment => segment.kind === 'process');
const sequence = (turn: Turn) => turn.segments.map(segment => segment.kind === 'text' ? segment.text :
  segment.items.map(item => item.kind === 'tool' ? item.id : 'thinking'));
function twoGroups() {
  const turn = new Turn();
  turn.endAssistant(assistant([call('abc')], 'toolUse'));
  turn.endAssistant(assistant([text('middle paragraph\n\nsecond paragraph')]));
  turn.endAssistant(assistant([call('def')], 'toolUse'));
  return turn;
}
const descendants = (component: Component): Component[] => [component,
  ...(component instanceof Container ? component.children.flatMap(descendants) : [])];

// Native read output and historical edit diff details remain covered in the existing view/adapter tests.
test('live tool/text/tool/answer keeps all text visible before and after agent completion', () => {
  const turn = new Turn();
  turn.running = true;
  const view = new TurnView(turn, host);
  turn.endAssistant(assistant(['a', 'b', 'c'].map(call), 'toolUse'));
  const firstGroup = turn.segments[0];
  turn.startAssistant(assistant([]));
  turn.updateAssistant(assistant([text('streaming middle')]));
  assert.match(render(view), /streaming middle/);
  turn.updateAssistant(assistant([text('streaming middle complete')]));
  const middle = turn.segments[1];
  turn.endAssistant(assistant([text('streaming middle complete')]));
  turn.startAssistant(assistant(['d', 'e', 'f'].map(call), 'toolUse'));
  assert.match(render(view), /streaming middle complete/);
  turn.endAssistant(assistant(['d', 'e', 'f'].map(call), 'toolUse'));
  turn.startAssistant(assistant([text('final answer')]));
  assert.equal(turn.running, true);
  assert.match(render(view), /streaming middle complete[\s\S]*final answer/);
  turn.endAssistant(assistant([text('final answer')]));
  turn.finish();
  assert.deepEqual(sequence(turn), [['a', 'b', 'c'], 'streaming middle complete', ['d', 'e', 'f'], 'final answer']);
  assert.equal(turn.segments[0], firstGroup);
  assert.equal(turn.segments[1], middle);
  assert.deepEqual(groups(turn).map(group => group.count), [3, 3]);
  assert.match(render(view), /streaming middle complete[\s\S]*final answer/);
});

test('successive snapshots of one mixed message append once in saved block order', () => {
  const turn = new Turn();
  const view = new TurnView(turn, host);
  const content = [call('a'), text('between'), call('b'), text('ending')];
  const saved = structuredClone(content);
  turn.startAssistant(assistant([]));
  for (let length = 1; length <= content.length; length++) {
    const message = assistant(content.slice(0, length), 'toolUse');
    const prefix = [...turn.segments];
    turn.updateAssistant(message);
    turn.updateAssistant(structuredClone(message));
    prefix.forEach((segment, index) => assert.equal(turn.segments[index], segment));
    assert.equal(turn.segments.length, length);
    if (length >= 2) assert.match(render(view), /between/);
  }
  turn.updateAssistant(assistant([call('a'), text('between expanded'), call('b'), text('ending expanded')], 'toolUse'));
  turn.endAssistant(assistant([call('a'), text('between expanded'), call('b'), text('ending expanded')], 'toolUse'));
  assert.deepEqual(sequence(turn), [['a'], 'between expanded', ['b'], 'ending expanded']);
  assert.equal(turn.tools.size, 2);
  assert.deepEqual(content, saved);
  const visible = render(view);
  assert.equal(visible.split('between expanded').length - 1, 1);
  assert.equal(visible.split('ending expanded').length - 1, 1);
});

test('thinking and textless tool messages share a group; text-only answers create none', () => {
  const turn = new Turn();
  turn.endAssistant(assistant([{ type: 'thinking', thinking: 'private reasoning' }]));
  turn.endAssistant(assistant([call('a')], 'toolUse'));
  turn.endAssistant(assistant([text('  '), { type: 'thinking', thinking: 'more reasoning' }, call('b')], 'toolUse'));
  turn.endAssistant(assistant([text('visible answer')]));
  assert.equal(groups(turn).length, 1);
  assert.equal(groups(turn)[0].count, 2);
  assert.deepEqual(sequence(turn), [['thinking', 'a', 'thinking', 'b'], 'visible answer']);
  assert.doesNotMatch(render(new TurnView(turn, host)), /private reasoning|more reasoning/);
  const plain = new Turn();
  plain.startAssistant(assistant([text('plain answer')]));
  const view = new TurnView(plain, host);
  assert.match(render(view), /plain answer/);
  assert.equal(view.toggleGroup(0), false);
  assert.equal(view.groups.size, 0);
  assert.deepEqual(sequence(plain), ['plain answer']);
  assert.doesNotMatch(render(view), /Process|Working|0 tools/);
});

test('late, partial and repeated results update only their owning group statistics', () => {
  const turn = twoGroups();
  const [first, second] = groups(turn);
  const a = turn.tools.get('abc')!, b = turn.tools.get('def')!;
  const stats = () => groups(turn).map(group => [group.count, group.completed, group.failed, group.truncated]);
  const failed: Result = { content: [text('late error')], isError: true, details: { truncation: { truncated: true } } };
  turn.result(b, failed);
  turn.result(a, { content: [], isError: false }, true);
  assert.deepEqual(stats(), [[1, 0, 0, 0], [1, 0, 1, 1]]);
  turn.result(a, { content: [], isError: false, details: { truncated: true } });
  turn.result(b, failed); // persisted result after execution_end
  assert.deepEqual(stats(), [[1, 1, 0, 1], [1, 0, 1, 1]]);
  turn.result(b, { content: [], isError: false });
  assert.deepEqual(stats(), [[1, 1, 0, 1], [1, 1, 0, 0]]);
  assert.deepEqual([turn.completed, turn.failed, turn.truncated], [2, 0, 1]);
  assert.equal(turn.groupOf.get(a), first);
  assert.equal(turn.groupOf.get(b), second);
});

test('mouse headers track text offsets, group toggles are independent, fold toggles all', () => {
  const view = new TurnView(twoGroups(), host);
  const clickHeader = (index: number) => {
    const lines = view.render(100).map(stripVTControlCharacters);
    const headers = lines.flatMap((line, y) => /^[▸▾] 未完成/.test(line) ? [y] : []);
    assert.equal(headers.length, 2);
    const middleY = lines.findIndex(line => line.includes('middle paragraph'));
    assert.ok(headers[0] < middleY && middleY < headers[1]);
    const y = headers[index];
    const event: TuiMouseEvent = { type: 'click', button: 'left', x: 1, y, screenX: 1, screenY: y,
      width: 100, height: lines.length, shift: false, ctrl: false, alt: false };
    assert.ok(view.handleMouse(event)?.handled);
    render(view);
  };
  const state = () => [...view.groups.values()].map(group => group.open);
  render(view);
  clickHeader(1);
  assert.deepEqual(state(), [false, true]);
  clickHeader(0);
  assert.deepEqual(state(), [true, true]);
  clickHeader(1); // first group's rows changed the second header's y
  assert.deepEqual(state(), [true, false]);
  view.toggleGroup(0);
  assert.deepEqual(state(), [false, false]);
  assert.equal(view.toggleTool(1), true);
  assert.match(render(view), /Arguments/);
  assert.deepEqual(state(), [false, true]);
  assert.equal(view.rows.get(view.turn.tools.get('def')!)?.open, true);
  assert.equal(view.rows.has(view.turn.tools.get('abc')!), false);
  view.toggle();
  assert.deepEqual(state(), [false, false]);
  view.toggle();
  assert.deepEqual(state(), [true, true]);
});

test('later tool updates neither rebuild nor re-transform previously rendered native text', t => {
  const transformed: string[] = [];
  const update = t.mock.method(AssistantMessageComponent.prototype, 'updateContent');
  const turn = twoGroups();
  const view = new TurnView(turn, { ...host, markdownTransformers: [value => {
    transformed.push(value); return value;
  }] });
  render(view);
  const native = descendants(view).filter(component => component instanceof AssistantMessageComponent);
  assert.equal(native.length, 1);
  const children = descendants(native[0]);
  const before = [...transformed];
  assert.ok(before.some(value => value.includes('middle paragraph')));
  const calls = update.mock.callCount();
  for (let i = 0; i < 5; i++) {
    turn.result(turn.tools.get('def')!, { content: [text(`chunk ${i}`)], isError: false }, i < 4);
    render(view);
  }
  assert.deepEqual(transformed, before);
  assert.equal(update.mock.callCount(), calls);
  const after = descendants(view).filter(component => component instanceof AssistantMessageComponent);
  assert.equal(after[0], native[0]);
  descendants(after[0]).forEach((component, index) => assert.equal(component, children[index]));
  assert.equal(descendants(after[0]).length, children.length);
});

test('historical completed messages and live snapshots produce the same segment sequence', () => {
  const messages = [assistant([{ type: 'thinking', thinking: 'plan' }, call('a')], 'toolUse'),
    assistant([text('middle'), call('b'), text('after b')], 'toolUse'),
    assistant([call('c')], 'toolUse'), assistant([text('final')])];
  const saved = structuredClone(messages);
  const history = new Turn(), live = new Turn();
  const historyView = new TurnView(history, host), liveView = new TurnView(live, host);
  live.running = true;
  for (const message of messages) {
    history.endAssistant(message);
    live.startAssistant(assistant([]));
    for (let i = 1; i <= message.content.length; i++) {
      live.updateAssistant(assistant(message.content.slice(0, i), message.stopReason));
      render(liveView);
    }
    live.endAssistant(message);
  }
  live.finish();
  assert.deepEqual(sequence(history), [['thinking', 'a'], 'middle', ['b'], 'after b', ['c'], 'final']);
  assert.deepEqual(sequence(live), sequence(history));
  assert.equal(render(liveView), render(historyView));
  assert.deepEqual(messages, saved);
});

test('process outer spacing matches native message spacers, not native detail-box internal padding', () => {
  assert.deepEqual(new Text('', 0, 0).render(80), [], 'empty Text was not a spacer');
  const nativeAssistant = new AssistantMessageComponent(assistant([text('native text')]));
  const nativeTool = new ToolExecutionComponent('probe', 'native', {}, {}, undefined, host.ui, host.cwd);
  assert.equal(nativeTool.children[0].constructor.name, 'Spacer');
  assert.deepEqual(nativeTool.children[0].render(80), new Spacer(1).render(80), 'native tool owns one outer separator');
  for (const width of [100, 12, 7]) {
    const nativeTextLines = nativeAssistant.render(width).map(stripVTControlCharacters);
    assert.equal(nativeTextLines[0].trim(), '', 'native assistant owns a leading separator');
    assert.notEqual(nativeTextLines.at(-1)!.trim(), '', 'native assistant has no trailing separator');
    const turn = new Turn();
    const tool = turn.tool('first', 'probe', {});
    turn.result(tool, { content: [], isError: false });
    const view = new TurnView(turn, host);
    for (let repeat = 0; repeat < 5; repeat++) {
      const lines = view.render(width).map(stripVTControlCharacters);
      assert.deepEqual(lines.slice(0, 1), nativeTool.children[0].render(width));
      assert.match(lines[1], /^[▸▾]/, 'first process gets native outer spacing, no detail-box padding');
      view.toggle();
    }
    view.dispose();
  }
});

test('native spacer leaves exactly one blank line from assistant text to process, with stable mouse offsets', () => {
  for (const mixed of [false, true]) for (const historical of [false, true]) {
    const turn = new Turn();
    turn.running = !historical;
    const view = new TurnView(turn, host);
    const content = [text('说明 段末'), call('spacing')];
    const messages = mixed ? [assistant(content, 'toolUse')] : [assistant([content[0]]), assistant([content[1]], 'toolUse')];
    const gap = (width: number) => {
      const lines = view.render(width).map(stripVTControlCharacters);
      const headerY = lines.findIndex(line => /^[▸▾]/.test(line));
      assert.ok(headerY >= 2);
      assert.equal(lines[headerY - 1].trim(), '', `missing spacer: ${JSON.stringify(lines)}`);
      assert.notEqual(lines[headerY - 2].trim(), '', 'exactly one separator, not accumulated blank lines');
      return { lines, headerY };
    };
    for (const message of messages) {
      if (!historical) {
        turn.startAssistant(assistant([]));
        for (const block of message.content.map((_, i) => message.content.slice(0, i + 1))) {
          for (let repeat = 0; repeat < 3; repeat++) {
            turn.updateAssistant(assistant(block, 'pending'));
            view.render(100);
            if (turn.tools.size) for (const width of [100, 12, 7]) gap(width);
          }
        }
      }
      turn.endAssistant(message);
    }
    const tool = turn.tools.get('spacing')!;
    for (const width of [100, 12, 7]) gap(width);
    turn.running = true;
    turn.startTool(tool, tool.args);
    for (let repeat = 0; repeat < 10; repeat++) {
      const { lines, headerY } = gap(100);
      assert.match(lines[headerY + 1], /当前 probe spacing/);
      const y = headerY + 1;
      const event: TuiMouseEvent = { type: 'click', button: 'left', x: 1, y, screenX: 1, screenY: y,
        width: 100, height: lines.length, shift: false, ctrl: false, alt: false };
      assert.ok(view.handleMouse(event)?.handled, 'activity line stays aligned after the spacer');
      const opened = gap(100);
      assert.equal(opened.headerY, headerY);
      assert.match(opened.lines[headerY + 2], /▸ … probe spacing/);
      assert.ok(view.handleMouse({ ...event, y: headerY + 2, screenY: headerY + 2, height: opened.lines.length })?.handled);
      assert.equal(view.rows.get(tool)?.open, true);
      view.render(100);
      view.toggle();
      turn.result(tool, { content: [text('partial')], isError: false }, true);
      gap(7);
    }
    turn.result(tool, { content: [], isError: false });
    turn.finish();
    const done = gap(100);
    assert.doesNotMatch(done.lines.join('\n'), /当前/);
    assert.equal(done.lines.length, done.headerY + 1);
    view.dispose();
  }
});

test('visible text transformers receive live and finalized streaming flags', () => {
  const flags: boolean[] = [];
  const turn = new Turn();
  const view = new TurnView(turn, { ...host, markdownTransformers: [(value, context) => {
    if (context.messageType === 'assistant') flags.push(context.isStreaming);
    return value;
  }] });
  turn.startAssistant(assistant([text('live text')], 'pending'));
  render(view);
  assert.equal(flags.at(-1), true);
  turn.updateAssistant(assistant([text('live text continues')], 'pending'));
  render(view);
  assert.equal(flags.at(-1), true);
  turn.endAssistant(assistant([text('live text continues')]));
  render(view);
  assert.equal(flags.at(-1), false);
});
