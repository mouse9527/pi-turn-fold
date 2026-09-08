import { stripVTControlCharacters } from 'node:util';
import type { Result, Tool } from './turns.ts';

export const categories = ['Read', 'Search', 'Run', 'Edit', 'Subagent', 'Other'] as const;
export type Category = typeof categories[number];
const knownTools = new Map<string, [Category, string]>([
  ['read', ['Read', 'read']], ['grep', ['Search', 'search']], ['find', ['Search', 'find']], ['ls', ['Search', 'ls']],
  ['bash', ['Run', 'bash']], ['powershell', ['Run', 'powershell']],
  ['edit', ['Edit', 'edit']], ['write', ['Edit', 'write']],
  ['Agent', ['Subagent', 'agent']], ['SubagentWorkflow', ['Subagent', 'workflow']],
  ['get_subagent_result', ['Subagent', 'result']], ['steer_subagent', ['Subagent', 'steer']],
  ['subagent', ['Subagent', 'agent']],
]);
export const statusSymbol = { pending: '○', running: '…', done: '✓', error: '✗' } as const;
export const statusColor = { pending: 'muted', running: 'warning', done: 'success', error: 'error' } as const;

/** Bound input work before sanitizing; full commands/paths remain available in details. */
export function compact(value: string, limit = 160): string {
  return stripVTControlCharacters(value.slice(0, limit).split(/[\r\n]/, 1)[0])
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
}

export function toolCategory(tool: Tool): Category { return knownTools.get(tool.name)?.[0] ?? 'Other'; }
export function toolAction(tool: Tool): string {
  if (tool.name === 'Agent' && typeof tool.args.resume === 'string' && tool.args.resume) return 'resume';
  if (tool.name === 'subagent') {
    if (typeof tool.args.action === 'string' && tool.args.action) return compact(tool.args.action);
    if (tool.args.workflowScript || tool.args.workflowScriptPath || tool.args.workflow) return 'workflow';
  }
  return knownTools.get(tool.name)?.[1] ?? compact(tool.name);
}
export function toolTarget(tool: Tool): string {
  const values = tool.name === 'Agent' ? [tool.args.description, tool.args.name, tool.args.resume]
    : tool.name === 'SubagentWorkflow' ? [tool.args.name, tool.args.title, tool.args.scriptPath]
    : tool.name === 'get_subagent_result' || tool.name === 'steer_subagent' ? [tool.args.agent_id]
    : tool.name === 'subagent' ? [tool.args.agent, tool.args.id, tool.args.name, tool.args.topic, tool.args.workflowScriptPath]
    : [tool.args.path, tool.args.file_path, tool.args.command, tool.args.query];
  const value = values.find(value => typeof value === 'string' && value);
  return typeof value === 'string' ? compact(value) : '';
}

/** Only Pi's saved, line-numbered display diff; never infer changes from arguments or today's file. */
export function savedEditStats(diff: string): { added: number; removed: number } | undefined {
  let added = 0, removed = 0, numbered = false;
  for (const line of diff.split('\n')) {
    if (!line || /^ +\.\.\.$/.test(line)) continue;
    if (!/^[ +\-] *\d+ /.test(line)) return undefined;
    numbered = true;
    if (line[0] === '+') added++;
    else if (line[0] === '-') removed++;
  }
  return numbered ? { added, removed } : undefined;
}

function errorSummary(tool: Tool, result: Result): string {
  const code = result.details?.exitCode;
  if (Number.isInteger(code) && code !== 0) return `exit code ${code}`;
  // Inspect only a bounded suffix of a bounded number of blocks, even for huge failures.
  const lastText = result.content.slice(-8).reverse().find(block => block.type === 'text' && block.text?.slice(-1024).trim());
  const tail = stripVTControlCharacters(lastText?.text?.slice(-1024) ?? '').trim();
  if (tool.name === 'bash' || tool.name === 'powershell') {
    const exit = tail.match(/Command exited with code (-?\d+)\s*$/);
    if (exit) return `exit code ${exit[1]}`;
    const timeout = tail.match(/Command timed out after ([\d.]+) seconds\s*$/);
    if (timeout) return `timed out after ${timeout[1]} seconds`;
    if (/Command aborted\s*$/.test(tail)) return 'cancelled';
  }
  const reason = typeof result.details?.error === 'string' ? result.details.error : tail.split(/[\r\n]/).at(-1) ?? '';
  return compact(reason, 120) || 'tool execution failed';
}

/** Called on result events, never during layout; repeated saved diffs reuse their counts. */
export function refreshPresentation(tool: Tool, result: Result, partial: boolean) {
  tool.errorSummary = !partial && result.isError ? errorSummary(tool, result) : undefined;
  const diff = tool.name === 'edit' && !partial && !result.isError && typeof result.details?.diff === 'string'
    ? result.details.diff as string : undefined;
  if (tool.diffSource !== diff) {
    tool.diffSource = diff;
    tool.diffStats = diff === undefined ? undefined : savedEditStats(diff);
  }
}

export function toolRow(tool: Tool): string {
  let label = `${statusSymbol[tool.status]} ${toolAction(tool)} ${toolTarget(tool)}`.trimEnd();
  if (tool.status === 'done' && tool.diffStats) label += ` +${tool.diffStats.added} −${tool.diffStats.removed}`;
  if (tool.errorSummary) label += ` · ${tool.errorSummary}`;
  if (tool.truncated) label += ' · output truncated';
  return label;
}
