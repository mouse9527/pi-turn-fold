import type { AssistantMessageComponent, ToolExecutionComponent } from '@earendil-works/pi-coding-agent';

export type AssistantMessage = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;
export type Result = Parameters<ToolExecutionComponent['updateResult']>[0];
export type Tool = {
  kind: 'tool'; id: string; name: string; args: Record<string, unknown>;
  result?: Result; status: 'pending' | 'running' | 'done' | 'error';
  revision: number; truncated: boolean;
};
export type Assistant = { kind: 'assistant'; message: AssistantMessage; revision: number };
export type Item = Tool | Assistant;
export type TextSegment = { kind: 'text'; text: string; assistant: Assistant; streaming: boolean; revision: number };

/** Counts are updated by tool ID, never by scanning the group's saved outputs. */
export class ProcessGroup {
  readonly kind = 'process';
  items: Item[] = [];
  count = 0;
  completed = 0;
  failed = 0;
  truncated = 0;
  revision = 0;

  summary(running: boolean) {
    const pending = this.count - this.completed - this.failed;
    return `${running && pending ? 'Working' : 'Process'} · ${this.count ? `${this.count} tools` : 'thinking'}` +
      (pending ? ` · ${pending} ${running ? 'pending' : 'unfinished'}` : '') +
      (this.failed ? ` · ⚠ ${this.failed} failed` : '') +
      (this.truncated ? ` · ⚠ ${this.truncated} truncated` : '');
  }
}

/** Display-only references. Never mutates messages, arguments, results or session entries. */
export class Turn {
  items: Item[] = [];
  tools = new Map<string, Tool>();
  segments: (ProcessGroup | TextSegment)[] = [];
  groupOf = new Map<Item, ProcessGroup>();
  private activeGroup?: ProcessGroup;
  private textBlocks = new Map<number, TextSegment>();
  final?: Assistant;
  streaming?: Assistant;
  running = false;
  completed = 0;
  failed = 0;
  truncated = 0;
  warnings: string[] = [];
  revision = 0;

  private addToGroup(item: Item) {
    if (!this.activeGroup) {
      this.activeGroup = new ProcessGroup();
      this.segments.push(this.activeGroup);
    }
    this.activeGroup.items.push(item);
    if (item.kind === 'tool') this.activeGroup.count++;
    this.activeGroup.revision++;
    this.groupOf.set(item, this.activeGroup);
  }

  tool(id: string, name: string, args: Record<string, unknown>): Tool {
    let tool = this.tools.get(id);
    if (!tool) {
      tool = { kind: 'tool', id, name, args, status: 'pending', revision: 0, truncated: false };
      this.tools.set(id, tool);
      this.items.push(tool);
      this.addToGroup(tool);
    } else {
      tool.args = args;
      tool.revision++;
    }
    this.revision++;
    return tool;
  }

  startAssistant(message: AssistantMessage) {
    this.final = undefined;
    this.streaming = { kind: 'assistant', message, revision: 0 };
    this.items.push(this.streaming);
    this.textBlocks.clear();
    this.updateAssistant(message);
  }

  updateAssistant(message: AssistantMessage) {
    if (!this.streaming) { this.startAssistant(message); return; }
    const item = this.streaming;
    item.message = message;
    item.revision++;
    // Only the current message is visited. Completed messages/groups are never regrouped.
    for (const [index, block] of message.content.entries()) {
      if (block.type === 'text' && block.text.trim()) {
        let segment = this.textBlocks.get(index);
        if (!segment) {
          segment = { kind: 'text', text: block.text, assistant: item, streaming: true, revision: 0 };
          this.textBlocks.set(index, segment);
          this.segments.push(segment);
          this.activeGroup = undefined; // Visible text seals the preceding process group.
        } else if (segment.text !== block.text) {
          segment.text = block.text;
          segment.revision++;
        }
      } else if (block.type === 'toolCall') {
        this.tool(block.id, block.name, block.arguments);
      } else if (block.type === 'thinking' && block.thinking.trim() && !this.groupOf.has(item)) {
        this.addToGroup(item);
      }
    }
    this.revision++;
  }

  endAssistant(message: AssistantMessage) {
    this.updateAssistant(message);
    if (!message.content.some(block => block.type === 'toolCall')) this.final = this.streaming;
    for (const segment of this.textBlocks.values()) { segment.streaming = false; segment.revision++; }
    if (message.stopReason === 'error' || message.stopReason === 'aborted' || message.stopReason === 'length') {
      const label = { error: 'Error', aborted: 'Operation aborted', length: 'Response truncated' }[message.stopReason];
      this.warnings.push(message.errorMessage ? `${label}: ${message.errorMessage}` : label);
      if (message.stopReason !== 'length') {
        // Match native Pi's display-only failure of tool calls whose assistant was aborted.
        for (const tool of this.tools.values()) if (tool.status === 'pending' || tool.status === 'running') {
          this.result(tool, { content: [{ type: 'text', text: message.errorMessage || label }], isError: true });
        }
      }
    }
    this.streaming = undefined;
    this.revision++;
  }

  result(tool: Tool, result: Result, partial = false) {
    const group = this.groupOf.get(tool)!;
    // End events and persisted toolResult messages may both describe the same result.
    for (const counts of [this, group]) {
      if (tool.status === 'done') counts.completed--;
      if (tool.status === 'error') counts.failed--;
      if (tool.truncated) counts.truncated--;
    }
    tool.result = result;
    tool.status = partial ? 'running' : result.isError ? 'error' : 'done';
    tool.truncated = Boolean(result.details?.truncation?.truncated || result.details?.truncated);
    for (const counts of [this, group]) {
      if (tool.status === 'done') counts.completed++;
      if (tool.status === 'error') counts.failed++;
      if (tool.truncated) counts.truncated++;
      counts.revision++;
    }
    tool.revision++;
  }

  finish() {
    this.running = false;
    this.revision++;
  }

  summary() {
    const pending = this.tools.size - this.completed - this.failed;
    return `${this.running ? 'Working' : 'Process'} · ${this.tools.size} tools` +
      (pending ? ` · ${pending} ${this.running ? 'pending' : 'unfinished'}` : '') +
      (this.failed ? ` · ⚠ ${this.failed} failed` : '') +
      (this.truncated ? ` · ⚠ ${this.truncated} truncated` : '') +
      (this.warnings.length ? ` · ⚠ ${this.warnings.length} alerts` : '');
  }
}

/** Bounded work even for megabyte commands; never split/scan the entire argument. */
export function toolLabel(tool: Tool): string {
  const value = tool.args.path ?? tool.args.file_path ?? tool.args.command ?? tool.args.query ?? '';
  const prefix = typeof value === 'string' ? value.slice(0, 160).split(/[\r\n]/, 1)[0] : '';
  return `${tool.name} ${prefix}`.trim().replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
