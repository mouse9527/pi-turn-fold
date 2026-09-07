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

/** Display-only references. Never mutates messages, arguments, results or session entries. */
export class Turn {
  items: Item[] = [];
  tools = new Map<string, Tool>();
  final?: Assistant;
  streaming?: Assistant;
  running = false;
  completed = 0;
  failed = 0;
  truncated = 0;
  warnings: string[] = [];
  revision = 0;

  tool(id: string, name: string, args: Record<string, unknown>): Tool {
    let tool = this.tools.get(id);
    if (!tool) {
      tool = { kind: 'tool', id, name, args, status: 'pending', revision: 0, truncated: false };
      this.tools.set(id, tool);
      this.items.push(tool);
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
    this.revision++;
  }

  updateAssistant(message: AssistantMessage) {
    if (!this.streaming) this.startAssistant(message);
    this.streaming!.message = message;
    this.streaming!.revision++;
    this.revision++;
  }

  endAssistant(message: AssistantMessage) {
    this.updateAssistant(message);
    let calls = false;
    for (const block of message.content) {
      if (block.type === 'toolCall') {
        calls = true;
        this.tool(block.id, block.name, block.arguments);
      }
    }
    if (!calls) this.final = this.streaming;
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
    // End events and persisted toolResult messages may both describe the same result.
    if (tool.status === 'done') this.completed--;
    if (tool.status === 'error') this.failed--;
    if (tool.truncated) this.truncated--;
    tool.result = result;
    tool.status = partial ? 'running' : result.isError ? 'error' : 'done';
    tool.truncated = Boolean(result.details?.truncation?.truncated || result.details?.truncated);
    if (tool.status === 'done') this.completed++;
    if (tool.status === 'error') this.failed++;
    if (tool.truncated) this.truncated++;
    tool.revision++;
    this.revision++;
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
