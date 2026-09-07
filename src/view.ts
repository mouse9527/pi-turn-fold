import { stripVTControlCharacters } from 'node:util';
import { AssistantMessageComponent, ToolExecutionComponent, getMarkdownTheme } from '@earendil-works/pi-coding-agent';
import { Container, MouseRegion, Text, truncateToWidth, type Component, type TUI } from '@earendil-works/pi-tui';
import { Turn, toolLabel, type Item, type Tool } from './turns.ts';

export type ViewHost = {
  ui: TUI;
  cwd: string;
  toolDefinition(name: string): ConstructorParameters<typeof ToolExecutionComponent>[4];
  showImages: boolean;
  imageWidthCells: number;
  markdownTransformers: ConstructorParameters<typeof AssistantMessageComponent>[5];
};

function line(text: () => string): Component {
  return {
    render: width => [truncateToWidth(text().replace(/[\x00-\x1f\x7f-\x9f]/g, ' '), width)],
    invalidate() {},
  };
}

/** A lightweight row. Native markdown/diff/image renderers exist only while open. */
export class ItemView extends Container {
  item: Item;
  host: ViewHost;
  open = false;
  private seen = -1;
  private detail?: Component;
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
    this.seen = -1;
  }

  private rebuild() {
    this.clear();
    this.addChild(new MouseRegion(line(() => {
      const item = this.item;
      const label = item.kind === 'tool'
        ? `${toolLabel(item)} · ${item.status}${item.truncated ? ' · truncated' : ''}`
        : 'Assistant / thinking';
      return `  ${this.open ? '▾' : '▸'} ${label}`;
    }), event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
  }

  private toolDetail(tool: Tool): Component {
    const box = new Container();
    // Native edit rendering omits some arguments; keep an exact saved-input inspector.
    box.addChild(new Text(`Arguments\n${JSON.stringify(tool.args, null, 2)}`, 2, 0));
    let definition = this.host.toolDefinition(tool.name);
    if (tool.name === 'edit' && definition?.renderCall) {
      const renderCall = definition.renderCall;
      definition = { ...definition, renderCall: (...[args, theme, context]: Parameters<typeof renderCall>) =>
        renderCall(args, theme, { ...context, argsComplete: false }) };
    }
    const alive = this.alive = { value: true };
    const ui = { requestRender: () => { if (alive.value) this.host.ui.requestRender(); } } as TUI;
    const native = new ToolExecutionComponent(tool.name, tool.id, tool.args, {
      showImages: this.host.showImages, imageWidthCells: this.host.imageWidthCells,
    }, definition, ui, this.host.cwd);
    native.setExpanded(true);
    if (tool.result) native.updateResult(tool.result, tool.status === 'running');
    box.addChild(native);
    if (tool.name === 'write') box.addChild(new Text('Saved write content; no before-file snapshot or historical diff is implied.', 2, 0));
    return box;
  }

  override render(width: number): string[] {
    if (this.open && this.seen !== this.item.revision) {
      this.release();
      this.rebuild();
      this.detail = this.item.kind === 'tool'
        ? this.toolDetail(this.item)
        : new AssistantMessageComponent(this.item.message, false, getMarkdownTheme(), 'Thinking...', 1, this.host.markdownTransformers);
      this.addChild(this.detail);
      this.seen = this.item.revision;
    }
    return super.render(width);
  }
}

export class TurnView extends Container {
  turn: Turn;
  host: ViewHost;
  open = false;
  rows = new Map<Item, ItemView>();
  private seen = -1;
  private answer?: Component;
  private answerItem?: Item;
  private answerRevision = -1;

  constructor(turn: Turn, host: ViewHost) {
    super();
    this.turn = turn;
    this.host = host;
  }

  toggle() {
    this.open = !this.open;
    if (!this.open) this.releaseRows();
    this.seen = -1;
    this.host.ui.requestRender(true);
  }

  toggleItem(item: Item | undefined) {
    if (!item) return false;
    if (!this.open) this.toggle();
    this.sync();
    this.rows.get(item)!.toggle();
    return true;
  }

  toggleTool(index: number) {
    return this.toggleItem([...this.turn.tools.values()][index]);
  }

  private releaseRows() {
    for (const row of this.rows.values()) row.release();
    this.rows.clear();
  }

  dispose() {
    this.releaseRows();
    this.clear();
    this.answer = undefined;
    this.answerItem = undefined;
  }

  private sync() {
    if (this.seen === this.turn.revision) return;
    this.seen = this.turn.revision;
    this.clear();
    this.addChild(new Text('', 0, 0));
    this.addChild(new MouseRegion(line(() => `${this.open ? '▾' : '▸'} ${this.turn.summary()}`), event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
    // Errors remain visible even when no final answer exists. Details are never discarded.
    for (const warning of this.turn.warnings) this.addChild(new Text(`⚠ ${stripVTControlCharacters(warning)}`, 1, 0));
    if (this.open) {
      // ponytail: expanded turns walk their rows; virtualize only if measured open-view latency warrants it.
      for (const item of this.turn.items) {
        let row = this.rows.get(item);
        if (!row) { row = new ItemView(item, this.host); this.rows.set(item, row); }
        this.addChild(row);
      }
    }
    const final = !this.turn.running ? this.turn.final : undefined;
    if (final) {
      if (this.answerItem !== final || this.answerRevision !== final.revision) {
        // Thinking and diagnostics belong to process/alert rows, not the final answer.
        const message = { ...final.message, stopReason: 'stop' as const,
          content: final.message.content.filter(block => block.type === 'text') };
        this.answer = new AssistantMessageComponent(message, true, getMarkdownTheme(), '', 1, this.host.markdownTransformers);
        this.answerItem = final;
        this.answerRevision = final.revision;
      }
      this.addChild(this.answer!);
    } else {
      this.answer = undefined;
      this.answerItem = undefined;
    }
  }

  override render(width: number): string[] {
    this.sync();
    return super.render(width);
  }
}
