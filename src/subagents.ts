import { stripVTControlCharacters } from 'node:util';
import { CustomMessageComponent } from '@earendil-works/pi-coding-agent';
import { Container, MouseRegion, Spacer, truncateToWidth, type Component, type TUI } from '@earendil-works/pi-tui';
import { compact, statusColor, statusSymbol } from './presentation.ts';

type NotificationStatus = 'running' | 'done' | 'error';
type NotificationProtocol = 'tintinweb' | 'official' | 'supervisor' | 'control' | 'steering' | 'watchdog' | 'wait' | 'command' | 'children';
type GroupState = { summary: string; status: NotificationStatus };
type NotificationDetails = Record<string, unknown>;
type Host = {
  ui: TUI;
  color?(name: typeof statusColor[keyof typeof statusColor], text: string): string;
};
type Task = {
  component: CustomMessageComponent;
  details: NotificationDetails;
  description: string;
  status: NotificationStatus;
};

function safe(value: string, limit: number): string {
  return stripVTControlCharacters(value.slice(0, limit).split(/[\r\n]/, 1)[0])
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
}

function line(text: () => string, style: (value: string) => string = value => value): Component {
  return {
    render: width => [truncateToWidth(style(safe(text(), 1200)), width)],
    invalidate() {},
  };
}

function messageOf(component: Component): any {
  return (component as any).message;
}

function entryOf(component: Component): any {
  return (component as any).entry;
}

function messageProtocol(message: any): NotificationProtocol | undefined {
  if (message?.display !== true) return undefined;
  if (message.customType === 'subagent-notification') return 'tintinweb';
  if (message.customType === 'subagent-notify') return 'official';
  if (message.customType === 'subagent_supervisor_request') return 'supervisor';
  if (message.customType === 'subagent_control_notice')
    return message.details?.event?.reason === 'supervisor_request' ? 'supervisor' : 'control';
  if (message.customType === 'subagent_steering_notice') return 'steering';
  if (message.customType === 'subagent_watchdog_warning') return 'watchdog';
  if (message.customType === 'subagent-wait-subscription') return 'wait';
  if (message.customType === 'subagent-slash-result') return 'command';
  // Official 0.67.0 sends these without details and only for non-completed outcomes.
  if (message.customType === 'subagent-incremental-child-notify') return 'children';
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Counts only exact structured fields; never parses a card's rendered text. */
function countedState(protocol: NotificationProtocol, components: Component[]): GroupState | undefined {
  const count = components.length;
  const details = () => components.map(component => messageOf(component)?.details);
  if (protocol === 'official') return { summary: `Process · Subagent notifications ${count}`, status: 'done' };
  if (protocol === 'control') return { summary: `Attention · Subagent ${plural(count, 'alert')}`, status: 'running' };
  if (protocol === 'children') return { summary: `Attention · Workflow ${plural(count, 'child alert')}`, status: 'running' };
  if (protocol === 'steering') {
    const recovered = details().filter(value => value?.state === 'recovered').length;
    const failed = count - recovered;
    const counts = [recovered && `${recovered} recovered`, failed && plural(failed, 'failure')].filter(Boolean);
    return { summary: `${failed ? 'Attention' : 'Process'} · Subagent steering ${counts.join(' · ')}`, status: failed ? 'running' : 'done' };
  }
  if (protocol === 'watchdog') {
    const blockers = details().filter(value => value?.severity === 'blocker').length;
    const concerns = count - blockers;
    const counts = [blockers && plural(blockers, 'blocker'), concerns && plural(concerns, 'concern')].filter(Boolean);
    return { summary: `${blockers ? 'Blocked' : 'Attention'} · Watchdog ${counts.join(' · ')}`, status: blockers ? 'error' : 'running' };
  }
  if (protocol === 'wait') {
    const completed = details().filter(value => value?.outcome === 'completed').length;
    const attention = count - completed;
    const counts = [completed && `${completed} completed`, attention && plural(attention, 'alert')].filter(Boolean);
    return { summary: `${attention ? 'Attention' : 'Process'} · Subagent waits ${counts.join(' · ')}`, status: attention ? 'running' : 'done' };
  }
  if (protocol === 'command') {
    const failed = details().filter(value => value?.result?.isError === true).length;
    return { summary: `${failed ? 'Failed' : 'Process'} · Subagent ${plural(count, 'command')}${failed ? ` · ${failed} failed` : ''}`,
      status: failed ? 'running' : 'done' };
  }
}

export function isFoldedSubagentMessage(message: unknown): boolean {
  return messageProtocol(message) !== undefined;
}

function notificationProtocol(component: Component): NotificationProtocol | undefined {
  return component instanceof CustomMessageComponent ? messageProtocol(messageOf(component))
    : entryOf(component)?.customType === 'subagent_supervisor_reply' ? 'supervisor' : undefined;
}

export function isSubagentNotification(component: Component): boolean {
  return notificationProtocol(component) !== undefined;
}

function supervisorKind(component: Component): 'update' | 'decision' | 'alert' | 'reply' {
  const entry = entryOf(component);
  if (entry?.customType === 'subagent_supervisor_reply') return 'reply';
  const message = messageOf(component);
  if (message?.customType === 'subagent_control_notice') return 'alert';
  const details = message?.details;
  return details?.expectsReply === true || details?.reason === 'need_decision' || details?.reason === 'interview_request' ? 'decision' : 'update';
}

function supervisorState(components: Component[]) {
  const replies = components.flatMap(component => {
    const data = entryOf(component)?.data;
    return data && typeof data === 'object' ? [data] : [];
  });
  let updates = 0, decisions = 0, alerts = 0;
  for (const component of components) {
    const kind = supervisorKind(component);
    if (kind === 'update' || kind === 'reply') { if (kind === 'update') updates++; continue; }
    const details = messageOf(component)?.details;
    const resolved = kind === 'decision'
      ? replies.some(reply => reply.requestId === details?.requestId)
      : replies.some(reply => reply.runId === details?.event?.runId && typeof reply.createdAt === 'number' &&
          typeof details?.event?.ts === 'number' && reply.createdAt >= details.event.ts);
    if (!resolved) { if (kind === 'decision') decisions++; else alerts++; }
  }
  return { updates, decisions, alerts, replies: replies.length, attention: decisions + alerts > 0 };
}

/** Reuse the official package's renderer without parsing or mutating its canonical card. */
function expandedNativeClone(component: Component): Component {
  const source = component as any;
  if (!(component instanceof CustomMessageComponent)) {
    const clone = new source.constructor(source.entry, source.renderer);
    clone.setExpanded(true);
    return clone;
  }
  const clone = new CustomMessageComponent(source.message, source.customRenderer, source.markdownTheme, source.outputPad);
  clone.setExpanded(true);
  return clone;
}

function taskOf(component: CustomMessageComponent, details: NotificationDetails): Task {
  const rawStatus = details.status;
  const status: NotificationStatus = ['failed', 'error', 'aborted', 'stopped'].includes(String(rawStatus)) ? 'error'
    : ['completed', 'done', 'success', 'steered'].includes(String(rawStatus)) ? 'done' : 'running';
  const description = typeof details.description === 'string' ? compact(details.description)
    : typeof details.id === 'string' ? compact(details.id) : 'Subagent';
  return { component, details, description: description || 'Subagent', status };
}

function tasksOf(component: CustomMessageComponent): Task[] {
  const details = messageOf(component)?.details;
  if (!details || typeof details !== 'object') return [taskOf(component, {})];
  const others = Array.isArray(details.others) ? details.others.filter((value: unknown) => value && typeof value === 'object') as NotificationDetails[] : [];
  return [taskOf(component, details), ...others.map(value => taskOf(component, value))];
}

function number(details: NotificationDetails, key: string): number | undefined {
  const value = details[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

class TaskView extends Container {
  open = false;
  readonly task: Task;
  private host: Host;
  private detail?: Component;

  constructor(task: Task, host: Host) {
    super();
    this.task = task;
    this.host = host;
    this.rebuild();
  }

  toggle() {
    this.open = !this.open;
    this.rebuild();
    this.host.ui.requestRender(true);
  }

  release() {
    this.open = false;
    this.detail = undefined;
    this.clear();
  }

  private details(): Component {
    const details = this.task.details;
    const box = new Container();
    const metadata: string[] = [];
    const toolUses = number(details, 'toolUses') ?? (Array.isArray(details.toolUses) ? details.toolUses.length : undefined);
    const tokens = number(details, 'totalTokens');
    const cost = number(details, 'totalCost');
    const duration = number(details, 'durationMs');
    if (toolUses !== undefined) metadata.push(`Tool uses: ${toolUses}`);
    if (tokens !== undefined) metadata.push(`Tokens: ${tokens}`);
    if (cost !== undefined) metadata.push(`Cost: $${cost}`);
    if (duration !== undefined) metadata.push(`Duration: ${duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`}`);
    if (metadata.length) box.addChild(line(() => `      ${metadata.join(' · ')}`));
    const rawPreview = details.resultPreview;
    const rawOutputFile = details.outputFile;
    const preview = typeof rawPreview === 'string' ? safe(rawPreview, 800) : '';
    const outputFile = typeof rawOutputFile === 'string' ? safe(rawOutputFile, 240) : '';
    if (preview) box.addChild(line(() => `      Result: ${preview}`));
    if (outputFile) box.addChild(line(() => `      Output: ${outputFile}`));
    return box;
  }

  private rebuild() {
    this.clear();
    const style = (text: string) => this.host.color?.(statusColor[this.task.status], text) ?? text;
    this.addChild(new MouseRegion(line(() => `  ${this.open ? '▾' : '▸'} ${statusSymbol[this.task.status]} ${this.task.description}`, style), event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
    if (this.open) {
      this.detail = this.details();
      this.addChild(this.detail);
    } else this.detail = undefined;
  }
}

/** A display-only run of adjacent visible subagent completion notifications. */
export class SubagentGroup extends Container {
  readonly kind = 'subagents';
  readonly protocol: NotificationProtocol;
  open = false;
  components: Component[] = [];
  private host: Host;
  private tasks: Task[] = [];
  private rows = new Map<Task, TaskView>();
  private nativeRows = new Map<Component, Component>();
  private version = 0;
  private seen = -1;

  constructor(host: Host, protocol: NotificationProtocol) { super(); this.host = host; this.protocol = protocol; }

  setComponents(components: Component[]) {
    if (this.rows.size || this.nativeRows.size) this.releaseRows();
    this.components = components;
    this.tasks = this.protocol === 'tintinweb' ? components.flatMap(component => tasksOf(component as CustomMessageComponent)) : [];
    this.version++;
  }

  add(component: Component) {
    this.components.push(component);
    if (this.protocol === 'tintinweb') this.tasks.push(...tasksOf(component as CustomMessageComponent));
    this.version++;
  }

  toggle() {
    this.open = !this.open;
    if (!this.open) this.releaseRows();
    this.seen = -1;
    this.host.ui.requestRender(true);
  }

  close() {
    if (this.open) this.toggle();
  }

  dispose() {
    this.releaseRows();
    this.components = [];
    this.tasks = [];
    this.clear();
  }

  state(): GroupState {
    const counted = countedState(this.protocol, this.components);
    if (counted) return counted;
    if (this.protocol === 'supervisor') {
      const { updates, decisions, alerts, replies, attention } = supervisorState(this.components);
      const counts = [updates && plural(updates, 'update'), decisions && plural(decisions, 'decision'),
        alerts && plural(alerts, 'alert'), replies && `${replies} repl${replies === 1 ? 'y' : 'ies'}`].filter(Boolean);
      return { summary: `${attention ? 'Attention' : 'Process'} · Supervisor ${counts.join(' · ')}`, status: attention ? 'running' : 'done' };
    }
    let completed = 0, running = 0, failed = 0;
    for (const task of this.tasks) {
      if (task.status === 'done') completed++;
      else if (task.status === 'error') failed++;
      else running++;
    }
    const label = failed ? 'Failed' : running ? 'Working' : 'Process';
    const counts = [completed && `${completed} completed`, running && `${running} running`, failed && `${failed} failed`].filter(Boolean);
    return { summary: `${label} · Subagents ${counts.join(' · ')}`, status: failed ? 'error' : running ? 'running' : 'done' };
  }

  summary(): string {
    return this.state().summary;
  }

  private releaseRows() {
    for (const row of this.rows.values()) row.release();
    this.rows.clear();
    this.nativeRows.clear();
    this.clear();
  }

  private sync() {
    if (this.seen === this.version) return;
    this.seen = this.version;
    this.clear();
    this.addChild(new Spacer(1));
    const status = this.state().status;
    const style = (text: string) => this.host.color?.(statusColor[status], text) ?? text;
    this.addChild(new MouseRegion(line(() => `${this.open ? '▾' : '▸'} ${this.summary()}`, style), event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
    if (this.open && this.protocol !== 'tintinweb') for (const component of this.components) {
      let row = this.nativeRows.get(component);
      if (!row) { row = expandedNativeClone(component); this.nativeRows.set(component, row); }
      this.addChild(row);
    }
    if (this.open && this.protocol === 'tintinweb') for (const task of this.tasks) {
      let row = this.rows.get(task);
      if (!row) { row = new TaskView(task, this.host); this.rows.set(task, row); }
      this.addChild(row);
    }
  }

  override render(width: number): string[] {
    this.sync();
    return super.render(width);
  }
}

/** Maintains folded notification runs without changing Pi's canonical components. */
export class SubagentProjection {
  private projection: Container;
  private host: Host;
  private groups = new Set<SubagentGroup>();
  private groupOf = new Map<Component, SubagentGroup>();

  constructor(projection: Container, host: Host) { this.projection = projection; this.host = host; }

  append(canonical: Component, visible: Component | undefined) {
    if (!visible) return;
    const protocol = notificationProtocol(canonical);
    if (!protocol) { this.projection.addChild(visible); return; }
    const component = canonical;
    const last = this.projection.children.at(-1);
    const group = last instanceof SubagentGroup && last.protocol === protocol ? last : new SubagentGroup(this.host, protocol);
    if (group !== last) { this.groups.add(group); this.projection.addChild(group); }
    group.add(component);
    this.groupOf.set(component, group);
  }

  reconcile(children: Component[], project: (child: Component) => Component | undefined) {
    const output: Component[] = [];
    const used = new Set<SubagentGroup>();
    let run: Component[] = [];
    let runProtocol: NotificationProtocol | undefined;
    const flush = () => {
      if (!run.length || !runProtocol) return;
      const protocol = runProtocol;
      const reusable = run.map(component => this.groupOf.get(component))
        .find(candidate => candidate?.protocol === protocol && !used.has(candidate));
      const group = reusable ?? new SubagentGroup(this.host, protocol);
      group.setComponents(run);
      used.add(group);
      output.push(group);
      run = [];
      runProtocol = undefined;
    };
    for (const child of children) {
      const visible = project(child);
      if (!visible) continue;
      const protocol = notificationProtocol(child);
      if (protocol) {
        if (runProtocol && runProtocol !== protocol) flush();
        runProtocol = protocol;
        run.push(child);
      } else { flush(); output.push(visible); }
    }
    flush();
    for (const group of this.groups) if (!used.has(group)) group.dispose();
    this.groups = used;
    this.groupOf.clear();
    for (const group of used) for (const component of group.components) this.groupOf.set(component, group);
    this.projection.children = output;
    this.projection.invalidate();
  }

  closeAll() { for (const group of this.groups) group.close(); }

  clear() {
    for (const group of this.groups) group.dispose();
    this.groups.clear();
    this.groupOf.clear();
  }
}
