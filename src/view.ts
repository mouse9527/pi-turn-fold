import { stripVTControlCharacters } from 'node:util';
import { AssistantMessageComponent, ToolExecutionComponent, getMarkdownTheme } from '@earendil-works/pi-coding-agent';
import { Container, MouseRegion, Spacer, Text, truncateToWidth, type Component, type TUI } from '@earendil-works/pi-tui';
import { Turn, ProcessGroup, type Item, type Tool, type TextSegment } from './turns.ts';
import { statusColor, toolRow } from './presentation.ts';

export type ViewHost = {
  ui: TUI;
  color?(name: typeof statusColor[keyof typeof statusColor], text: string): string;
  cwd: string;
  toolDefinition(name: string): ConstructorParameters<typeof ToolExecutionComponent>[4];
  showImages: boolean;
  imageWidthCells: number;
  markdownTransformers: ConstructorParameters<typeof AssistantMessageComponent>[5];
};

function line(text: () => string, style: (text: string) => string = text => text, optional = false): Component {
  return {
    render: width => {
      const raw = stripVTControlCharacters(text()).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
      // Only trusted host styling may introduce ANSI; clipping preserves its reset sequences.
      return optional && !raw ? [] : [truncateToWidth(style(raw), width)];
    },
    invalidate() {},
  };
}

/** Saved input stays available but collapsed so the native card reads first. */
class ArgumentsView extends Container {
  open = false;
  private args: () => Record<string, unknown>;
  private host: ViewHost;
  private text?: Text;

  constructor(args: () => Record<string, unknown>, host: ViewHost) {
    super();
    this.args = args;
    this.host = host;
    this.rebuild();
  }

  toggle() {
    this.open = !this.open;
    this.rebuild();
    this.host.ui.requestRender(true);
  }

  refresh() {
    if (this.open && this.text) this.text.setText(this.body());
  }

  // Serializing megabyte arguments is deferred until this row is actually opened.
  private body(): string {
    return `Arguments\n${JSON.stringify(this.args(), null, 2)}`;
  }

  private rebuild() {
    this.clear();
    this.addChild(new MouseRegion(line(() => `    ${this.open ? '▾' : '▸'} Arguments`,
      text => this.host.color?.('muted', text) ?? text), event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
    this.text = this.open ? new Text(this.body(), 4, 0) : undefined;
    if (this.text) this.addChild(this.text);
  }
}

/** A lightweight row. Native markdown/diff/image renderers exist only while open. */
export class ItemView extends Container {
  item: Item;
  host: ViewHost;
  open = false;
  private seen = -1;
  private detail?: Component;
  private native?: ToolExecutionComponent;
  private argumentsView?: ArgumentsView;
  private alive?: { value: boolean };

  constructor(item: Item, host: ViewHost) {
    super();
    this.item = item;
    this.host = host;
    this.rebuild();
  }

  toggle() {
    this.open = !this.open;
    this.release();
    this.rebuild();
    this.host.ui.requestRender(true);
  }

  release() {
    if (this.alive) this.alive.value = false;
    this.alive = undefined;
    this.detail = undefined;
    this.native = undefined;
    this.argumentsView = undefined;
    this.seen = -1;
  }

  private rebuild() {
    this.clear();
    this.addChild(new MouseRegion(line(() => {
      const item = this.item;
      const label = item.kind === 'tool'
        ? toolRow(item)
        : 'Thinking';
      return `  ${this.open ? '▾' : '▸'} ${label}`;
    }, text => this.host.color?.(this.item.kind === 'tool' ? statusColor[this.item.status] : 'muted', text) ?? text), event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
  }

  private toolDetail(tool: Tool): Component {
    const box = new Container();
    let definition = this.host.toolDefinition(tool.name);
    if (tool.name === 'edit' && definition?.renderCall) {
      const renderCall = definition.renderCall;
      definition = { ...definition, renderCall: (...[args, theme, context]: Parameters<typeof renderCall>) =>
        renderCall(args, theme, { ...context, argsComplete: false }) };
    }
    const alive = this.alive = { value: true };
    const ui = { requestRender: () => { if (alive.value) this.host.ui.requestRender(); } } as TUI;
    const native = this.native = new ToolExecutionComponent(tool.name, tool.id, tool.args, {
      showImages: this.host.showImages, imageWidthCells: this.host.imageWidthCells,
    }, definition, ui, this.host.cwd);
    native.setExpanded(true);
    if (tool.result) native.updateResult(tool.result, tool.status === 'running');
    box.addChild(native);
    // Native edit rendering omits some arguments; keep an exact saved-input inspector, collapsed.
    this.argumentsView = new ArgumentsView(() => this.item.kind === 'tool' ? this.item.args : tool.args, this.host);
    box.addChild(this.argumentsView);
    if (tool.name === 'write') box.addChild(new Text('Saved write content; no before-file snapshot or historical diff is implied.', 2, 0));
    return box;
  }

  override render(width: number): string[] {
    if (this.open && this.seen !== this.item.revision) {
      if (this.item.kind === 'tool' && this.native) {
        // Retain native renderer state/lastComponent, including its nested disclosure state.
        this.argumentsView?.refresh();
        this.native.updateArgs(this.item.args);
        if (this.item.result) this.native.updateResult(this.item.result, this.item.status === 'running');
      } else {
        this.release();
        this.rebuild();
        this.detail = this.item.kind === 'tool'
          ? this.toolDetail(this.item)
          : new AssistantMessageComponent({ ...this.item.message, stopReason: 'stop',
            content: this.item.message.content.filter(block => block.type === 'thinking') },
            false, getMarkdownTheme(), 'Thinking...', 1, this.host.markdownTransformers);
        this.addChild(this.detail);
      }
      this.seen = this.item.revision;
    }
    return super.render(width);
  }
}

/** One consecutive process run, bounded by visible assistant text. */
class ProcessView extends Container {
  group: ProcessGroup;
  turn: Turn;
  host: ViewHost;
  open = false;
  rows = new Map<Item, ItemView>();
  private seen = -1;

  constructor(group: ProcessGroup, turn: Turn, host: ViewHost) {
    super();
    this.group = group;
    this.turn = turn;
    this.host = host;
  }

  toggle() {
    this.open = !this.open;
    if (!this.open) this.release();
    this.seen = -1;
    this.host.ui.requestRender(true);
  }

  release() {
    for (const row of this.rows.values()) row.release();
    this.rows.clear();
    this.clear();
  }

  toggleItem(item: Item) {
    if (!this.open) this.toggle();
    this.sync();
    this.rows.get(item)!.toggle();
  }

  private sync() {
    if (this.seen === this.group.items.length) return;
    this.seen = this.group.items.length;
    this.clear();
    this.addChild(new Spacer(1));
    const header = new Container();
    const status = this.group.status(this.turn.running);
    const headerStyle = (text: string) => this.host.color?.(statusColor[status === 'error' ? 'running' : status], text) ?? text;
    const activityStyle = (text: string) => this.host.color?.(statusColor[status], text) ?? text;
    header.addChild(line(() => `${this.open ? '▾' : '▸'} ${this.group.summary(this.turn.running)}`, headerStyle));
    header.addChild(line(() => {
      const activity = this.group.activity(this.turn.running);
      return activity ? `  ${activity}` : '';
    }, activityStyle, true));
    this.addChild(new MouseRegion(header, event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
    if (this.open) {
      // ponytail: expanded groups walk their rows; virtualize only if measured latency warrants it.
      for (const item of this.group.items) {
        let row = this.rows.get(item);
        if (!row) { row = new ItemView(item, this.host); this.rows.set(item, row); }
        this.addChild(row);
      }
    }
  }

  override render(width: number): string[] {
    this.sync();
    return super.render(width);
  }
}

/** Visible text is streamed in place, never removed when a later tool starts. */
class AssistantTextView extends Container {
  segment: TextSegment;
  private seen = -1;
  private native: AssistantMessageComponent;

  constructor(segment: TextSegment, host: ViewHost) {
    super();
    this.segment = segment;
    this.native = new AssistantMessageComponent(undefined, true, getMarkdownTheme(), '', 1, host.markdownTransformers);
    this.addChild(this.native);
  }

  override render(width: number): string[] {
    if (this.seen !== this.segment.revision) {
      this.native.updateContent({ ...this.segment.assistant.message, stopReason: 'stop',
        content: [{ type: 'text', text: this.segment.text }] }, this.segment.streaming);
      this.seen = this.segment.revision;
    }
    return super.render(width);
  }
}

export class TurnView extends Container {
  turn: Turn;
  host: ViewHost;
  groups = new Map<ProcessGroup, ProcessView>();
  private content = new Container();
  private nextSegment = 0;
  private nextWarning = 0;

  constructor(turn: Turn, host: ViewHost) {
    super();
    this.turn = turn;
    this.host = host;
    this.addChild(this.content);
  }

  get open() { return [...this.groups.values()].some(group => group.open); }
  get rows() { return new Map([...this.groups.values()].flatMap(group => [...group.rows])); }

  toggle() {
    this.sync();
    const open = !this.open;
    for (const group of this.groups.values()) if (group.open !== open) group.toggle();
  }

  toggleGroup(index: number) {
    this.sync();
    const group = [...this.groups.values()][index];
    if (!group) return false;
    group.toggle();
    return true;
  }

  toggleItem(item: Item | undefined) {
    if (!item) return false;
    this.sync();
    const group = this.turn.groupOf.get(item);
    if (!group) return false; // Text-only assistant messages are already visible.
    this.groups.get(group)!.toggleItem(item);
    return true;
  }

  toggleTool(index: number) {
    return this.toggleItem([...this.turn.tools.values()][index]);
  }

  dispose() {
    for (const group of this.groups.values()) group.release();
    this.groups.clear();
    this.content.clear();
    this.clear();
  }

  private sync() {
    // Append only newly discovered segments. Never re-partition history per token/result.
    while (this.nextSegment < this.turn.segments.length) {
      const segment = this.turn.segments[this.nextSegment++];
      if (segment.kind === 'process') {
        const group = new ProcessView(segment, this.turn, this.host);
        this.groups.set(segment, group);
        this.content.addChild(group);
      } else this.content.addChild(new AssistantTextView(segment, this.host));
    }
    // Warnings join the stream where they happened; a later retry must render below them.
    while (this.nextWarning < this.turn.warnings.length) {
      this.content.addChild(new Text(`⚠ ${stripVTControlCharacters(this.turn.warnings[this.nextWarning++])}`, 1, 0));
    }
  }

  override render(width: number): string[] {
    this.sync();
    return super.render(width);
  }
}
