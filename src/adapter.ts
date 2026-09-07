import { InteractiveMode, AssistantMessageComponent, ToolExecutionComponent, VERSION } from '@earendil-works/pi-coding-agent';
import { Container, type Component } from '@earendil-works/pi-tui';
import { Turn, type AssistantMessage, type Tool } from './turns.ts';
import { TurnView, type ViewHost } from './view.ts';

// All unsupported host access is quarantined here, pinned to the tested Pi release.
// `any` is intentional: these private fields are not an extension API.
type Host = any;
type Method = (this: any, ...args: any[]) => any;
const owner = Symbol.for('pi-turn-fold.adapter');

export function installAdapter(version = VERSION) {
  if (version !== '0.85.1') throw new Error(`pi-turn-fold supports Pi 0.85.1 only (found ${version})`);
  const proto = InteractiveMode.prototype as any;
  if (proto[owner]) throw new Error('pi-turn-fold is already loaded');
  const undo: (() => void)[] = [];
  let mode: Host;
  let disposed = false;
  let scope = 0;
  let live = false;
  let current: Turn | undefined;
  const views: TurnView[] = [];
  const owners = new Map<string, Turn>();
  const hidden = new WeakSet<object>();
  const projection = new Container();
  const viewAnchors = new Map<Component, TurnView>();

  function patch(target: any, key: string, wrap: (original: Method) => Method) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const original = target[key];
    if (typeof original !== 'function') throw new Error(`Incompatible Pi: missing ${key}`);
    const replacement = wrap(original);
    target[key] = replacement;
    undo.push(() => {
      if (target[key] !== replacement) return; // Never clobber another extension's later patch.
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    });
  }

  function reset() {
    for (const view of views) view.dispose();
    views.length = 0;
    owners.clear();
    viewAnchors.clear();
    projection.clear();
    current = undefined;
  }

  function newTurn() {
    current?.finish();
    current = new Turn();
    current.running = live;
    const host: ViewHost = {
      ui: mode.ui, cwd: mode.sessionManager.getCwd(),
      toolDefinition: name => mode.getRegisteredToolDefinition(name),
      get showImages() { return mode.settingsManager.getShowImages(); },
      get imageWidthCells() { return mode.settingsManager.getImageWidthCells(); },
      get markdownTransformers() { return mode.getMarkdownTransformers(); },
    };
    const view = new TurnView(current, host);
    views.push(view);
    // Invisible anchor retains correct ordering for native direct child splices.
    const anchor: Component = { render: () => [], invalidate() {} };
    viewAnchors.set(anchor, view);
    mode.chatContainer.addChild(anchor);
    return current;
  }

  function capture(host: Host) {
    if (mode === host) return;
    if (mode) throw new Error('Multiple interactive hosts are not supported');
    if (!host.chatContainer || !host.ui || typeof host.getRegisteredToolDefinition !== 'function' ||
        !(host instanceof InteractiveMode)) throw new Error('Incompatible interactive host');
    mode = host;
    const chat = mode.chatContainer;
    for (const child of chat.children) projection.addChild(child);
    patch(chat, 'addChild', original => function(child) {
      original.call(this, child);
      if (child instanceof AssistantMessageComponent || child instanceof ToolExecutionComponent) hidden.add(child);
      if (!hidden.has(child)) projection.addChild(viewAnchors.get(child) ?? child);
    });
    patch(chat, 'removeChild', original => function(child) {
      original.call(this, child);
      projection.removeChild(viewAnchors.get(child) ?? child);
    });
    patch(chat, 'clear', original => function() { reset(); return original.call(this); });
    patch(chat, 'render', () => function(width) { return projection.render(width); });
    patch(chat, 'handleMouse', () => function(event) { return projection.handleMouse(event); });
    patch(chat, 'invalidate', original => function() {
      original.call(this);
      for (const view of views) view.invalidate();
    });
  }

  function inScope<T>(fn: () => T): T {
    scope++;
    try { return fn(); } finally { scope--; } // Never hold a global construction gate across await.
  }

  function endAssistant(message: AssistantMessage) {
    const turn = current ?? newTurn();
    turn.endAssistant(message);
    for (const block of message.content) if (block.type === 'toolCall') owners.set(block.id, turn);
  }

  function toolFor(event: any): [Turn, Tool] {
    const turn = owners.get(event.toolCallId) ?? current ?? newTurn();
    let tool = turn.tools.get(event.toolCallId);
    if (!tool) tool = turn.tool(event.toolCallId, event.toolName ?? 'tool', event.args ?? {});
    owners.set(event.toolCallId, turn);
    return [turn, tool];
  }

  function eventState(event: any) {
    if (event.type === 'agent_start') {
      live = true;
      if (current) { current.running = true; current.revision++; }
    } else if (event.type === 'agent_end') {
      live = false;
      current?.finish();
    } else if (event.message?.role === 'assistant') {
      const turn = current ?? newTurn();
      if (event.type === 'message_start') turn.startAssistant(event.message);
      else if (event.type === 'message_update') turn.updateAssistant(event.message);
      else if (event.type === 'message_end') endAssistant(event.message);
    } else if (event.type.startsWith('tool_execution_')) {
      const [turn, tool] = toolFor(event);
      if (event.type === 'tool_execution_start') {
        tool.args = event.args; tool.status = 'running'; tool.revision++; turn.revision++;
      } else if (event.type === 'tool_execution_update') {
        turn.result(tool, { ...event.partialResult, isError: false }, true);
      } else if (event.type === 'tool_execution_end') {
        turn.result(tool, { ...event.result, isError: event.isError });
      }
    } else if (event.type === 'message_end' && event.message?.role === 'toolResult') {
      const message = event.message;
      const [turn, tool] = toolFor(message);
      turn.result(tool, message);
    }
  }

  function dispose(hydrate = false) {
    if (disposed) return;
    disposed = true;
    for (const restore of undo.reverse()) restore();
    delete proto[owner];
    if (mode) {
      // Remove only our anchors; canonical native components were never rearranged.
      mode.chatContainer.children = mode.chatContainer.children.filter((child: Component) => !viewAnchors.has(child));
      if (hydrate) {
        for (const child of mode.chatContainer.children) {
          if (!hidden.has(child)) continue;
          // Avoid historical edit preview while restoring the native display.
          if (child instanceof ToolExecutionComponent) {
            (child as any).argsComplete = false;
            (child as any).updateDisplay();
            (child as any).maybeConvertImagesForKitty();
          } else if (child instanceof AssistantMessageComponent) child.invalidate();
        }
      }
    }
    reset();
    if (hydrate) mode?.ui.requestRender(true);
    mode = undefined;
  }

  try {
    proto[owner] = true;
    patch(AssistantMessageComponent.prototype, 'updateContent', original => function(message, streaming) {
      if (scope || hidden.has(this)) {
        hidden.add(this);
        this.lastMessage = message;
        this.isStreaming = streaming ?? this.isStreaming;
        return;
      }
      return original.call(this, message, streaming);
    });
    patch(ToolExecutionComponent.prototype, 'updateDisplay', original => function() {
      if ((mode && this.ui === mode.ui) || hidden.has(this)) { hidden.add(this); return; }
      return original.call(this);
    });
    patch(ToolExecutionComponent.prototype, 'maybeConvertImagesForKitty', original => function() {
      if (!hidden.has(this)) return original.call(this);
    });
    patch(proto, 'bindCurrentSessionExtensions', original => function(...args) {
      capture(this);
      return original.apply(this, args);
    });
    patch(proto, 'addMessageToChat', original => function(message, options) {
      capture(this);
      if (message.role === 'assistant' && !current) newTurn();
      const result = message.role === 'assistant'
        ? inScope(() => original.call(this, message, options))
        : original.call(this, message, options);
      if (message.role === 'user') newTurn();
      else if (message.role === 'assistant') endAssistant(message);
      return result;
    });
    patch(proto, 'renderSessionItems', original => function(items, options) {
      capture(this);
      const result = original.call(this, items, options);
      for (const item of items) if (item.role === 'toolResult') {
        const [turn, tool] = toolFor(item);
        turn.result(tool, item);
      }
      return result;
    });
    patch(proto, 'handleEvent', original => function(event) {
      capture(this);
      // Pi 0.85.1 handles these display events synchronously once initialized.
      // Preserve ALL native queue/abort/progress/footer/retry/compaction side effects.
      const result = original.call(this, event);
      eventState(event);
      return result;
    });
    patch(proto, 'addCustomEntryToChat', original => function(...args) {
      const result = original.apply(this, args);
      if (mode === this) {
        // Rare custom entries can bypass addChild via splice; reconcile only on that event.
        projection.children = this.chatContainer.children.filter((child: Component) => !hidden.has(child))
          .map((child: Component) => viewAnchors.get(child) ?? child);
      }
      return result;
    });
  } catch (error) {
    dispose(true);
    throw error;
  }

  return {
    views,
    get captured() { return Boolean(mode); },
    dispose,
    toggle(turn = views.length - 1, tool?: number) {
      const view = views[turn];
      if (!view) return false;
      if (tool !== undefined) return view.toggleTool(tool);
      view.toggle();
      return true;
    },
  };
}
