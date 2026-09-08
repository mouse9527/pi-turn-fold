import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { InteractiveMode, AssistantMessageComponent, ToolExecutionComponent, VERSION, initTheme, createBashToolDefinition } from '@earendil-works/pi-coding-agent';
import { Container, Text, TuiMainScreen } from '@earendil-works/pi-tui';
import { createInteractiveTuiReference } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js';
import { installAdapter } from '../src/adapter.ts';
import type { AssistantMessage } from '../src/turns.ts';

initTheme('dark', false);
const proto = InteractiveMode.prototype as any;
const text = (component: Container) => stripVTControlCharacters(component.render(120).join('\n'));
const user = (content: string) => ({ role: 'user', content, timestamp: 1 });
const call = (id: string) => ({ type: 'toolCall' as const, id, name: 'probe', arguments: { query: `input-${id}` } });
const assistant = (content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage => ({
  role: 'assistant', content, stopReason, api: 'anthropic-messages', provider: 'anthropic', model: 'synthetic', timestamp: 2,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const result = (id: string, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: 'probe',
  content: [{ type: 'text', text: `saved-output-${id}` }], details: {}, isError, timestamp: 3 });

// Keep all display/control methods on the actual installed prototype. Only dependencies are stubbed.
function host() {
  const counters = { renderCall: 0, renderResult: 0, renders: 0, footer: 0, disposed: 0 };
  const progress: boolean[] = [];
  const history: string[] = [];
  const editor = { onEscape() {}, addToHistory: (value: string) => history.push(value), setWorkingStatusIndicator() {} };
  const definition = {
    name: 'probe', label: 'Probe', description: 'Synthetic renderer', parameters: {},
    renderCall: () => { counters.renderCall++; return new Text('native-probe-call', 0, 0); },
    renderResult: (value: any) => { counters.renderResult++; return new Text(value.content[0].text, 0, 0); },
  };
  const session = {
    settingsManager: { getShowImages: () => false, getImageWidthCells: () => 60, getCodeBlockIndent: () => '  ',
      getShowCacheMissNotices: () => false, getShowTerminalProgress: () => true },
    sessionManager: { getCwd: () => process.cwd(), getEntries: () => [] },
    extensionRunner: { getMarkdownTransformers: () => [], getMessageRenderer: () => undefined,
      getEntryRenderer: (name: string) => name === 'test-entry' ? () => new Text('custom-entry-visible', 0, 0) : undefined },
    getToolDefinition: () => definition, getSteeringMessages: () => [], getFollowUpMessages: () => [], retryAttempt: 0,
  };
  const mode = Object.assign(Object.create(InteractiveMode.prototype), {
    runtimeHost: { session }, isInitialized: true,
    ui: { requestRender: () => counters.renders++, terminal: { setProgress: (value: boolean) => progress.push(value) },
      getClearOnShrink: () => false },
    footer: { invalidate: () => counters.footer++ }, chatContainer: new Container(), pendingTools: new Map(),
    pendingMessagesContainer: new Container(), statusContainer: new Container(), compactionQueuedMessages: [],
    editor, defaultEditor: editor, options: { tuiMode: 'regular' }, workingVisible: false,
    hideThinkingBlock: false, hiddenThinkingLabel: 'Thinking...', outputPad: 1, toolOutputExpanded: false,
    mermaidMarkdownTransformer: { transform: (value: string) => value },
  });
  return { mode, counters, progress, history, session };
}

const patchedMethods: [object, string[]][] = [
  [proto, ['bindCurrentSessionExtensions', 'addMessageToChat', 'renderSessionItems', 'handleEvent', 'addCustomEntryToChat']],
  [AssistantMessageComponent.prototype, ['updateContent']],
  [ToolExecutionComponent.prototype, ['updateDisplay', 'maybeConvertImagesForKitty']],
];
function descriptors(targets = patchedMethods) {
  return targets.flatMap(([target, keys]) => keys.map(key => ({ target, key, value: Object.getOwnPropertyDescriptor(target, key) })));
}
function assertRestored(before: ReturnType<typeof descriptors>) {
  for (const { target, key, value } of before) assert.deepEqual(Object.getOwnPropertyDescriptor(target, key), value, key);
  assert.equal(Object.hasOwn(proto, Symbol.for('pi-turn-fold.adapter')), false);
}

// Prototype patches are process-global; these top-level tests deliberately run serially.
test('installed Pi 0.85.1 streams parallel tools with a folded projection and canonical native shell state', async () => {
  assert.equal(VERSION, '0.85.1');
  assert.match(import.meta.resolve('@earendil-works/pi-coding-agent'), /node_modules\//);
  const { mode, counters, progress } = host();
  const before = descriptors();
  const chatBefore = descriptors([[mode.chatContainer, ['addChild', 'removeChild', 'clear', 'render', 'handleMouse', 'invalidate']]]);
  const adapter = installAdapter();
  try {
    assert.equal(adapter.captured, false);
    const originalEscape = () => {};
    mode.retryEscapeHandler = originalEscape;
    mode.pendingTools.set('stale', {});
    await mode.handleEvent({ type: 'agent_start' });
    assert.equal(mode.defaultEditor.onEscape, originalEscape);
    assert.equal(mode.retryEscapeHandler, undefined);
    assert.equal(mode.pendingTools.size, 0);
    await mode.handleEvent({ type: 'turn_start' });
    await mode.handleEvent({ type: 'message_start', message: user('user-visible') });
    const planning = assistant([{ type: 'thinking', thinking: 'secret-thinking' }, { type: 'text', text: 'intermediate-visible' }, call('a'), call('b')], 'toolUse');
    const planningBefore = structuredClone(planning);
    await mode.handleEvent({ type: 'message_start', message: assistant([]) });
    await mode.handleEvent({ type: 'message_update', message: planning });
    const nativeAssistant = mode.streamingComponent;
    assert.ok(nativeAssistant instanceof AssistantMessageComponent);
    assert.equal(mode.streamingMessage, planning);
    assert.equal(mode.pendingTools.size, 2);
    const nativeTools = [...mode.pendingTools.values()] as ToolExecutionComponent[];
    assert.ok(nativeTools.every(tool => tool instanceof ToolExecutionComponent && mode.chatContainer.children.includes(tool)));
    assert.match(text(mode.chatContainer), /intermediate-visible/);
    assert.doesNotMatch(text(mode.chatContainer), /secret-thinking|native-probe/);
    await mode.handleEvent({ type: 'message_end', message: planning });
    assert.equal(mode.streamingComponent, undefined);
    assert.equal(mode.streamingMessage, undefined);
    for (const id of ['a', 'b']) await mode.handleEvent({ type: 'tool_execution_start', toolCallId: id, toolName: 'probe', args: call(id).arguments });
    await mode.handleEvent({ type: 'tool_execution_update', toolCallId: 'a', partialResult: result('partial') });
    assert.equal(adapter.views[0].turn.tools.get('a')?.status, 'running');
    for (const id of ['b', 'a']) {
      const value = result(id);
      await mode.handleEvent({ type: 'tool_execution_end', toolCallId: id, result: value, isError: false });
      assert.equal(mode.pendingTools.has(id), false);
      await mode.handleEvent({ type: 'message_end', message: value });
    }
    const final = assistant([{ type: 'thinking', thinking: 'final-thinking-hidden' }, { type: 'text', text: 'final-answer-visible' }]);
    await mode.handleEvent({ type: 'message_start', message: assistant([]) });
    await mode.handleEvent({ type: 'message_update', message: final });
    assert.match(text(mode.chatContainer), /final-answer-visible/, 'final text streams before message/agent end');
    assert.match(text(mode.chatContainer), /intermediate-visible/, 'later output never retracts earlier text');
    await mode.handleEvent({ type: 'message_end', message: final });
    mode.activeStatusIndicator = { kind: 'working', dispose: () => counters.disposed++ };
    await mode.handleEvent({ type: 'agent_end' });
    assert.equal(mode.activeStatusIndicator, undefined);
    assert.equal(counters.disposed, 1);
    assert.deepEqual(progress, [true, false]);
    assert.ok(counters.footer >= 10);
    assert.ok(counters.renders > 0);
    assert.equal(mode.pendingTools.size, 0);
    assert.equal(adapter.views.length, 1);
    assert.equal(adapter.views[0].open, false);
    assert.equal(adapter.views[0].turn.completed, 2);
    assert.equal(adapter.views[0].turn.running, false);
    const folded = text(mode.chatContainer);
    assert.match(folded, /user-visible/);
    assert.match(folded, /Process · Other 2/);
    assert.match(folded, /final-answer-visible/);
    assert.match(folded, /intermediate-visible/);
    assert.doesNotMatch(folded, /secret-thinking|final-thinking-hidden|saved-output|native-probe-call/);
    assert.deepEqual([counters.renderCall, counters.renderResult], [0, 0]);
    assert.deepEqual(planning, planningBefore);
    assert.ok(mode.chatContainer.children.includes(nativeAssistant));
    const nativeChildren = mode.chatContainer.children.filter((child: any) => child instanceof AssistantMessageComponent || child instanceof ToolExecutionComponent);
    assert.equal(nativeChildren.length, 4);
    adapter.toggle(0);
    text(mode.chatContainer);
    assert.deepEqual([counters.renderCall, counters.renderResult], [0, 0], 'opening a turn alone stays lazy');
    adapter.toggle(0, 0);
    assert.match(text(mode.chatContainer), /saved-output-a/);
    assert.ok(counters.renderCall > 0 && counters.renderResult > 0);
    adapter.dispose(true);
    assertRestored(before);
    assertRestored(chatBefore);
    assert.ok(nativeChildren.every((child: any) => mode.chatContainer.children.includes(child)));
    const restored = text(mode.chatContainer);
    assert.match(restored, /intermediate-visible/);
    assert.match(restored, /saved-output-a/);
    assert.doesNotMatch(restored, /Process · Other 2/);
    adapter.dispose(true);
    const second = installAdapter();
    try {
      mode.chatContainer.clear();
      mode.addMessageToChat(user('reinstalled-user'));
      mode.addMessageToChat(assistant([{ type: 'text', text: 'reinstalled-answer' }]));
      assert.equal(second.views.length, 1);
      assert.match(text(mode.chatContainer), /reinstalled-answer/);
    } finally { second.dispose(true); }
    assertRestored(before);
    assertRestored(chatBefore);
  } finally { adapter.dispose(true); }
});

test('real historical rendering routes late results to their owning turns and retains no-final errors', () => {
  const { mode, counters, history } = host();
  const adapter = installAdapter();
  try {
    const error = { ...assistant([call('failed')], 'error'), errorMessage: 'historical-provider-error' };
    const items = [user('historical-first'), assistant([call('old')], 'toolUse'),
      assistant([{ type: 'text', text: 'historical-answer' }]), user('historical-second'), error,
      result('old'), result('failed', true)];
    const saved = structuredClone(items);
    mode.renderSessionItems(items, { populateHistory: true });
    assert.deepEqual(items, saved);
    assert.deepEqual(history, ['historical-first', 'historical-second']);
    assert.equal(adapter.views.length, 2);
    assert.equal(adapter.views[0].turn.completed, 1);
    assert.equal(adapter.views[1].turn.failed, 1);
    assert.equal(adapter.views[1].turn.final, undefined);
    assert.equal(adapter.views[0].turn.tools.get('old')?.result, items[5]);
    assert.equal(mode.pendingTools.size, 0);
    const folded = text(mode.chatContainer);
    assert.match(folded, /historical-answer/);
    assert.match(folded, /historical-provider-error/);
    assert.match(folded, /1 failed/);
    assert.match(folded, /Failed: saved-output-failed/);
    assert.doesNotMatch(folded, /saved-output-old/);
    assert.deepEqual([counters.renderCall, counters.renderResult], [0, 0]);
    adapter.toggle(0, 0);
    assert.match(text(mode.chatContainer), /saved-output-old/);
    mode.chatContainer.clear();
    assert.equal(adapter.views.length, 0);
    assert.equal(text(mode.chatContainer), '');
  } finally { adapter.dispose(true); }
});

test('unknown components and native custom-entry splices stay visible and restore in canonical order', async () => {
  const { mode } = host();
  const before = new Text('unknown-before', 0, 0);
  mode.chatContainer.addChild(before);
  const adapter = installAdapter();
  try {
    mode.addMessageToChat(user('custom-user'));
    const anchor = mode.chatContainer.children.at(-1);
    await mode.handleEvent({ type: 'message_start', message: assistant([]) });
    const native = mode.streamingComponent;
    const after = new Text('unknown-after', 0, 0);
    mode.chatContainer.addChild(after);
    await mode.handleEvent({ type: 'entry_appended', entry: { type: 'custom', id: 'entry', parentId: null,
      timestamp: new Date(0).toISOString(), customType: 'test-entry', data: {} } });
    await mode.handleEvent({ type: 'message_start', message: { role: 'custom', customType: 'notice',
      content: 'custom-message-visible', display: true, timestamp: 1 } });
    const children = mode.chatContainer.children;
    const customIndex = children.findIndex((child: Container) => text(child).includes('custom-entry-visible'));
    assert.equal(children[customIndex + 1], native, 'real Pi custom-entry path splices before streaming component');
    const visible = text(mode.chatContainer);
    for (const label of ['unknown-before', 'unknown-after', 'custom-entry-visible', 'custom-message-visible']) assert.match(visible, new RegExp(label));
    assert.ok(visible.indexOf('custom-entry-visible') < visible.indexOf('unknown-after'));
    mode.chatContainer.removeChild(after);
    assert.doesNotMatch(text(mode.chatContainer), /unknown-after/);
    const canonical = [...mode.chatContainer.children];
    adapter.dispose(true);
    assert.deepEqual(mode.chatContainer.children, canonical.filter(child => child !== anchor));
    assert.ok(mode.chatContainer.children.includes(native));
    assert.match(text(mode.chatContainer), /custom-entry-visible/);
  } finally { adapter.dispose(true); }
});

test('live failure without a final answer remains visible and native pending state is cleared', async () => {
  const { mode, counters } = host();
  const adapter = installAdapter();
  try {
    await mode.handleEvent({ type: 'agent_start' });
    await mode.handleEvent({ type: 'message_start', message: user('failing-user') });
    await mode.handleEvent({ type: 'message_start', message: assistant([]) });
    const failed = { ...assistant([call('unfinished')], 'error'), errorMessage: 'live-provider-error' };
    await mode.handleEvent({ type: 'message_update', message: failed });
    assert.equal(mode.pendingTools.size, 1);
    await mode.handleEvent({ type: 'message_end', message: failed });
    assert.equal(mode.pendingTools.size, 0);
    assert.equal(mode.streamingComponent, undefined);
    await mode.handleEvent({ type: 'agent_end' });
    assert.equal(adapter.views[0].turn.final, undefined);
    assert.match(text(mode.chatContainer), /Error: live-provider-error/);
    assert.deepEqual([counters.renderCall, counters.renderResult], [0, 0]);
  } finally { adapter.dispose(true); }
});

test('off/on is immediate, idempotent and does not stack wrappers or components over 50 cycles', () => {
  const { mode, counters } = host();
  const before = descriptors();
  const adapter = installAdapter();
  try {
    const messages = [user('switch-user'), assistant([call('a')], 'toolUse'), result('a'),
      assistant([{ type: 'text', text: 'switch-answer' }])];
    const saved = structuredClone(messages);
    mode.renderSessionItems(messages);
    adapter.toggle(0, 0);
    assert.match(text(mode.chatContainer), /saved-output-a/);
    const canonical = [...mode.chatContainer.children];
    const view = adapter.views[0];
    const wrapped = descriptors();
    for (let i = 0; i < 50; i++) {
      assert.equal(adapter.setEnabled(false), true);
      assert.equal(adapter.enabled, false);
      assert.match(text(mode.chatContainer), /saved-output-a/);
      assert.doesNotMatch(text(mode.chatContainer), /Process · Other/);
      assert.equal(view.rows.size, 0);
      const calls = counters.renderCall;
      adapter.setEnabled(false);
      assert.equal(counters.renderCall, calls, 'repeated off must not hydrate again');
      assert.equal(adapter.toggle(), false, 'fold shortcuts do not operate on the hidden projection');
      assert.equal(adapter.setEnabled(true), true);
      assert.equal(adapter.enabled, true);
      assert.match(text(mode.chatContainer), /Process · Other 1/);
      assert.match(text(mode.chatContainer), /switch-answer/);
      assert.doesNotMatch(text(mode.chatContainer), /saved-output-a/);
      assert.equal(counters.renderCall, calls, 'on must not invoke hidden native tool renderers');
      adapter.setEnabled(true);
      assert.deepEqual(descriptors(), wrapped);
      assert.equal(adapter.views.length, 1);
      assert.equal(adapter.views[0], view);
      assert.equal(mode.chatContainer.children.length, canonical.length);
      canonical.forEach((child, index) => assert.equal(mode.chatContainer.children[index], child));
    }
    assert.deepEqual(messages, saved);
  } finally { adapter.dispose(true); }
  assertRestored(before);
  assert.equal(adapter.setEnabled(true), false, 'disposed adapters cannot be re-enabled');
});

test('switching during tools and streaming text preserves native execution and latest folded state', async () => {
  const { mode, counters } = host();
  const adapter = installAdapter();
  try {
    await mode.handleEvent({ type: 'agent_start' });
    await mode.handleEvent({ type: 'message_start', message: user('live-switch-user') });
    await mode.handleEvent({ type: 'message_start', message: assistant([]) });
    const planning = assistant([call('live')], 'toolUse');
    await mode.handleEvent({ type: 'message_update', message: planning });
    await mode.handleEvent({ type: 'message_end', message: planning });
    const pending = mode.pendingTools;
    const native = pending.get('live');
    adapter.setEnabled(false);
    await mode.handleEvent({ type: 'tool_execution_start', toolCallId: 'live', toolName: 'probe', args: call('live').arguments });
    await mode.handleEvent({ type: 'tool_execution_update', toolCallId: 'live', partialResult: result('progress') });
    assert.match(text(mode.chatContainer), /saved-output-progress/);
    adapter.setEnabled(true);
    assert.equal(mode.pendingTools, pending);
    assert.equal(pending.get('live'), native);
    const calls = counters.renderCall;
    const failed = result('live', true);
    await mode.handleEvent({ type: 'tool_execution_end', toolCallId: 'live', result: failed, isError: true });
    await mode.handleEvent({ type: 'message_end', message: failed });
    assert.equal(pending.size, 0);
    assert.match(text(mode.chatContainer), /1 failed/);
    assert.match(text(mode.chatContainer), /Failed: saved-output-live/);
    assert.doesNotMatch(text(mode.chatContainer), /saved-output-progress|native-probe-call/);
    assert.equal(counters.renderCall, calls);
    await mode.handleEvent({ type: 'message_start', message: assistant([]) });
    await mode.handleEvent({ type: 'message_update', message: assistant([{ type: 'text', text: 'partial' }], 'pending') });
    assert.match(text(mode.chatContainer), /partial/);
    const streaming = mode.streamingComponent;
    adapter.setEnabled(false);
    const final = assistant([{ type: 'text', text: 'partial continued while off' }]);
    await mode.handleEvent({ type: 'message_update', message: final });
    assert.match(text(mode.chatContainer), /partial continued while off/);
    adapter.setEnabled(true);
    assert.equal(mode.streamingComponent, streaming);
    assert.match(text(mode.chatContainer), /partial continued while off/);
    await mode.handleEvent({ type: 'message_end', message: final });
    await mode.handleEvent({ type: 'agent_end' });
    assert.equal(adapter.views[0].turn.running, false);
    assert.equal(adapter.views[0].turn.failed, 1);
    assert.equal(adapter.views[0].turn.items.filter(item => item.kind === 'assistant').length, 2);
  } finally { adapter.dispose(true); }
});

test('native bash elapsed timer is cleared when folding resumes, without stopping execution', async t => {
  const { mode, session } = host();
  const definition = createBashToolDefinition(process.cwd());
  session.getToolDefinition = (() => definition) as unknown as typeof session.getToolDefinition;
  const clear = t.mock.method(globalThis, 'clearInterval');
  const adapter = installAdapter();
  let native: any;
  try {
    await mode.handleEvent({ type: 'agent_start' });
    await mode.handleEvent({ type: 'message_start', message: user('timer-switch') });
    adapter.setEnabled(false);
    await mode.handleEvent({ type: 'message_start', message: assistant([]) });
    const planning = assistant([{ type: 'toolCall', id: 'shell', name: 'bash', arguments: { command: 'never executed' } }], 'toolUse');
    await mode.handleEvent({ type: 'message_update', message: planning });
    await mode.handleEvent({ type: 'message_end', message: planning });
    native = mode.pendingTools.get('shell');
    assert.equal(native instanceof ToolExecutionComponent, true);
    await mode.handleEvent({ type: 'tool_execution_start', toolCallId: 'shell', toolName: 'bash', args: { command: 'never executed' } });
    const partial = { content: [{ type: 'text', text: 'synthetic progress' }], isError: false };
    await mode.handleEvent({ type: 'tool_execution_update', toolCallId: 'shell', partialResult: partial });
    const interval = native.rendererState.interval;
    assert.ok(interval, 'real native shell renderer started its elapsed-time timer');
    adapter.setEnabled(true);
    assert.equal(native.rendererState.interval, undefined);
    assert.ok(clear.mock.calls.some(call => call.arguments[0] === interval));
    assert.equal(mode.pendingTools.get('shell'), native);
    assert.equal(native.executionStarted, true);
    assert.equal(native.isPartial, true);
    assert.match(text(mode.chatContainer), /Running: bash(?:\n|$)/);
    assert.doesNotMatch(text(mode.chatContainer), /never executed/);
    adapter.setEnabled(false);
    const resumed = native.rendererState.interval;
    assert.ok(resumed, 'native display may resume its own timer while off');
    adapter.setEnabled(true);
    assert.equal(native.rendererState.interval, undefined);
    assert.ok(clear.mock.calls.some(call => call.arguments[0] === resumed));
    await mode.handleEvent({ type: 'tool_execution_end', toolCallId: 'shell', result: partial, isError: false });
    assert.equal(native.rendererState.interval, undefined);
    assert.equal(native.isPartial, false);
    assert.equal(mode.pendingTools.size, 0);
    assert.match(text(mode.chatContainer), /Process · Run 1/);
    adapter.setEnabled(false);
    assert.equal(native.rendererState.interval, undefined, 'final native hydration cannot restart it');
    await mode.handleEvent({ type: 'agent_end' });
  } finally {
    adapter.dispose(true);
    if (native?.rendererState.interval) clearInterval(native.rendererState.interval);
  }
});

test('every interleaved streaming frame hides native shells, not assistant prose or the bounded activity line', async t => {
  const { mode, counters } = host();
  const frames: { site: string; folded: boolean; value: string }[] = [];
  let adapter: ReturnType<typeof installAdapter> | undefined;
  const paint = (site: string) => frames.push({ site, folded: adapter?.enabled ?? false, value: text(mode.chatContainer) });
  // Real Pi stable facade and requestRender scheduler; no terminal, execution or model I/O.
  const renderer = new TuiMainScreen(mode.ui.terminal) as any;
  renderer.stopped = false;
  t.mock.method(renderer, 'doRender', () => paint('scheduled'));
  const requestRender = renderer.requestRender;
  t.mock.method(renderer, 'requestRender', function(this: any, force?: boolean) {
    paint('requestRender-before-eventState');
    return requestRender.call(this, force);
  });
  mode.ui = createInteractiveTuiReference(() => renderer);
  const addChild = mode.chatContainer.addChild;
  t.mock.method(mode.chatContainer, 'addChild', function(this: Container, child: any) {
    addChild.call(this, child);
    paint('addChild-before-hidden-registration');
  });
  adapter = installAdapter();
  const updateDisplay = (ToolExecutionComponent.prototype as any).updateDisplay;
  (ToolExecutionComponent.prototype as any).updateDisplay = function(this: any) {
    const constructing = !mode.chatContainer.children.includes(this);
    assert.equal(this.ui, mode.ui, 'native construction receives the stable facade, not its current renderer');
    updateDisplay.call(this);
    paint(constructing ? 'constructor-before-addChild' : 'updateDisplay');
  };
  const send = async (event: any) => {
    const pending = mode.handleEvent(event);
    paint('handleEvent-before-await');
    await pending;
    await new Promise<void>(resolve => setImmediate(resolve));
    paint('handleEvent-after-await');
  };
  try {
    await send({ type: 'agent_start' });
    await send({ type: 'message_start', message: user('synthetic-frame-user') });
    await send({ type: 'message_start', message: assistant([]) });
    const prose = { type: 'text' as const, text: 'Visible prose: {"toolCall":"literal-example"}' };
    await send({ type: 'message_update', message: assistant([prose], 'pending') });
    assert.match(text(mode.chatContainer), /literal-example/);
    let planning = assistant([prose, { ...call('frames'), arguments: {} }], 'pending');
    await send({ type: 'message_update', message: planning });
    const native = mode.pendingTools.get('frames');
    assert.equal(native.argsComplete, false);
    const args = { query: 'INTENTIONAL-FIRST-LINE\nRAW-ARGUMENT-TAIL' };
    planning = assistant([prose, { ...call('frames'), arguments: args }], 'pending');
    await send({ type: 'message_update', message: planning });
    assert.doesNotMatch(text(mode.chatContainer), /INTENTIONAL-FIRST-LINE/, 'pending tools do not have a running summary');
    mode.chatContainer.invalidate();
    renderer.requestRender(true);
    await send({ type: 'message_end', message: { ...planning, stopReason: 'toolUse' } });
    assert.equal(native.argsComplete, true);
    await send({ type: 'tool_execution_start', toolCallId: 'frames', toolName: 'probe', args });
    assert.match(text(mode.chatContainer), /Running: probe INTENTIONAL-FIRST-LINE/);
    await send({ type: 'tool_execution_update', toolCallId: 'frames', partialResult: result('RAW-PARTIAL') });
    assert.deepEqual([counters.renderCall, counters.renderResult], [0, 0], 'even constructor-time renderers were gated');
    adapter.setEnabled(false);
    assert.match(text(mode.chatContainer), /native-probe-call/);
    assert.match(text(mode.chatContainer), /saved-output-RAW-PARTIAL/);
    adapter.setEnabled(true);
    native.invalidate(); // A stale renderer callback after folding resumes is gated too.
    mode.chatContainer.invalidate();
    const completed = { ...result('frames'), content: result('RAW-FINAL').content };
    await send({ type: 'tool_execution_end', toolCallId: 'frames', result: completed, isError: false });
    await send({ type: 'message_end', message: completed });
    await send({ type: 'message_start', message: assistant([]) });
    await send({ type: 'message_update', message: assistant([{ type: 'text', text: 'Visible final stream' }], 'pending') });
    assert.match(text(mode.chatContainer), /Visible final stream/);
    // Exercise the constructor fallback without a preceding message_update/toolCall block.
    await send({ type: 'tool_execution_start', toolCallId: 'fallback', toolName: 'probe', args: { query: 'fallback\nRAW-ARGUMENT-TAIL' } });
    await send({ type: 'tool_execution_end', toolCallId: 'fallback', result: result('RAW-FALLBACK'), isError: false });
    await send({ type: 'agent_end' });
    renderer.renderNow(true);
    // Exercise the real throttled timer in addition to forced/nextTick renders.
    renderer.requestRender();
    await new Promise(resolve => setTimeout(resolve, 25));
    for (const frame of frames.filter(frame => frame.folded)) {
      assert.doesNotMatch(frame.value, /native-probe-call|RAW-ARGUMENT-TAIL|saved-output-RAW/, frame.site);
    }
    for (const site of ['constructor-before-addChild', 'addChild-before-hidden-registration', 'requestRender-before-eventState', 'scheduled']) {
      assert.ok(frames.some(frame => frame.folded && frame.site === site), site);
    }
    assert.match(text(mode.chatContainer), /literal-example/);
    assert.equal(mode.pendingTools.size, 0);
  } finally {
    (ToolExecutionComponent.prototype as any).updateDisplay = updateDisplay;
    adapter.dispose(true);
    renderer.stopped = true;
    renderer.cancelRenderTimer();
  }
  assert.match(text(mode.chatContainer), /native-probe-call/);
  assert.match(text(mode.chatContainer), /saved-output-RAW-FINAL/);
});

for (const name of ['bash', 'powershell']) test(`${name} closed frames omit arguments across argument streaming and execution phases`, async () => {
  const { mode } = host();
  const adapter = installAdapter();
  const frames: { phase: string; value: string }[] = [];
  const paint = (phase: string) => frames.push({ phase, value: text(mode.chatContainer) });
  const send = async (phase: string, event: any) => {
    const pending = mode.handleEvent(event);
    paint(`${phase}: before await`);
    await pending;
    paint(`${phase}: after await`);
  };
  const command = 'COMMAND-MARKER\n' + 'x'.repeat(1_000_000) + '\nCOMMAND-TAIL';
  const planning = (args: Record<string, unknown>) => assistant([
    { type: 'text', text: 'STREAMING-PROSE' },
    { type: 'toolCall', id: 'shell', name, arguments: args },
  ], 'pending');
  try {
    await send('agent start', { type: 'agent_start' });
    await send('user', { type: 'message_start', message: user('phase coverage') });
    await send('assistant start', { type: 'message_start', message: assistant([]) });
    for (const end of [14, 30, command.length]) {
      const message = planning({ command: command.slice(0, end) });
      await send('toolcall_delta / argsComplete=false', { type: 'message_update', message,
        assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '', partial: message } });
      assert.equal(mode.pendingTools.get('shell').argsComplete, false);
      assert.doesNotMatch(text(mode.chatContainer), /Running:/);
    }
    await send('message_end / argsComplete=true', { type: 'message_end', message: { ...planning({ command }), stopReason: 'toolUse' } });
    assert.equal(mode.pendingTools.get('shell').argsComplete, true);
    assert.doesNotMatch(text(mode.chatContainer), /Running:/);
    await send('tool_execution_start', { type: 'tool_execution_start', toolCallId: 'shell', toolName: name, args: { command } });
    assert.match(text(mode.chatContainer), new RegExp(`Running: ${name}(?:\\n|$)`));
    const output = { content: [{ type: 'text', text: 'OUTPUT-MARKER' }], isError: false };
    await send('tool_execution_update', { type: 'tool_execution_update', toolCallId: 'shell', partialResult: output });
    adapter.setEnabled(false);
    adapter.setEnabled(true);
    paint('folding re-enabled during execution');
    assert.match(text(mode.chatContainer), new RegExp(`Running: ${name}(?:\\n|$)`));
    await send('tool_execution_end', { type: 'tool_execution_end', toolCallId: 'shell', result: output, isError: false });
    assert.doesNotMatch(text(mode.chatContainer), /Running:/);
    await send('agent end', { type: 'agent_end' });
    for (const { phase, value } of frames) assert.doesNotMatch(value, /COMMAND-MARKER|COMMAND-TAIL|OUTPUT-MARKER|native-probe-call/, phase);
    assert.match(text(mode.chatContainer), /STREAMING-PROSE/);
    assert.equal(adapter.views[0].turn.tools.get('shell')?.args.command, command);
  } finally { adapter.dispose(true); }
});

test('version and duplicate-install guards leave original descriptors intact', () => {
  const before = descriptors();
  assert.throws(() => installAdapter('0.85.0'), /supports Pi 0.85.1 only/);
  assertRestored(before);
  const adapter = installAdapter();
  try { assert.throws(() => installAdapter(), /already loaded/); }
  finally { adapter.dispose(); }
  assertRestored(before);
});
