import type { AssistantMessageComponent, ToolExecutionComponent } from '@earendil-works/pi-coding-agent';
import { categories, compact, refreshPresentation, toolAction, toolCategory, toolTarget, type Category } from './presentation.ts';

export type AssistantMessage = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;
export type Result = Parameters<ToolExecutionComponent['updateResult']>[0];
export type Tool = {
  kind: 'tool'; id: string; name: string; args: Record<string, unknown>;
  result?: Result; status: 'pending' | 'running' | 'done' | 'error';
  revision: number; truncated: boolean;
  diffSource?: string; diffStats?: { added: number; removed: number }; errorSummary?: string;
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

  readonly categories: Record<Category, number> = { Read: 0, Search: 0, Run: 0, Edit: 0, Other: 0 };
  readonly pending = new Map<string, Tool>();
  readonly runningTools = new Map<string, Tool>();
  readonly failures = new Map<string, Tool>();

  track(tool: Tool) {
    for (const [status, map] of [['pending', this.pending], ['running', this.runningTools], ['error', this.failures]] as const) {
      if (tool.status === status) map.set(tool.id, tool);
      else map.delete(tool.id);
    }
  }

  status(running: boolean): Tool['status'] {
    if (this.failed) return 'error';
    const unresolved = this.pending.size + this.runningTools.size;
    if (running && (unresolved || !this.count)) return 'running';
    return unresolved ? 'pending' : 'done';
  }

  summary(running: boolean) {
    const unresolved = this.pending.size + this.runningTools.size;
    const state = { pending: 'Unfinished', running: 'Working', done: 'Process', error: 'Failed' }[this.status(running)];
    return state + categories.filter(category => this.categories[category])
      .map(category => ` · ${category} ${this.categories[category]}`).join('') +
      (!this.count ? ' · Thinking' : '') +
      (unresolved ? ` · ${unresolved} unfinished` : '') +
      (this.failed ? ` · ${this.failed} failed` : '') +
      (this.truncated ? ` · ${this.truncated} truncated` : '');
  }

  activity(running: boolean) {
    const current = this.runningTools.values().next().value as Tool | undefined;
    const failure = this.failures.values().next().value as Tool | undefined;
    // Put the failure first so a long parallel command cannot clip away its reason.
    return (failure ? `Failed: ${failure.errorSummary ?? 'tool execution failed'} · ${toolAction(failure)} ${toolTarget(failure)}`.trimEnd() : '') +
      (current ? `${failure ? ' · ' : ''}${running ? 'Running' : 'Unfinished'}: ${toolAction(current)} ${current.name === 'bash' || current.name === 'powershell' ? '' : toolTarget(current)}`.trimEnd() : '');
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
    if (item.kind === 'tool') {
      this.activeGroup.count++;
      this.activeGroup.categories[toolCategory(item)]++;
      this.activeGroup.track(item);
    }
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

  startTool(tool: Tool, args: Record<string, unknown>) {
    tool.args = args;
    this.result(tool, { content: [], isError: false }, true);
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
    refreshPresentation(tool, result, partial);
    group.track(tool);
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
    const state = this.failed ? 'Failed' : this.running ? 'Working' : pending ? 'Unfinished' : 'Process';
    return `${state} · Tools ${this.tools.size}` +
      (pending ? ` · ${pending} unfinished` : '') +
      (this.failed ? ` · ${this.failed} failed` : '') +
      (this.truncated ? ` · ${this.truncated} truncated` : '') +
      (this.warnings.length ? ` · Warnings ${this.warnings.length}` : '');
  }
}

/** Bounded work even for megabyte commands; never split/scan the entire argument. */
export function toolLabel(tool: Tool): string {
  return `${compact(tool.name)} ${toolTarget(tool)}`.trim();
}
