import { stripVTControlCharacters } from 'node:util';
import { CustomMessageComponent } from '@earendil-works/pi-coding-agent';
import { Container, MouseRegion, Spacer, truncateToWidth, type Component, type TUI } from '@earendil-works/pi-tui';
import { compact, statusColor, statusSymbol } from './presentation.ts';

type NotificationStatus = 'running' | 'done' | 'error';
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

function messageOf(component: CustomMessageComponent): any {
  return (component as any).message;
}

export function isSubagentNotification(component: Component): component is CustomMessageComponent {
  if (!(component instanceof CustomMessageComponent)) return false;
  const message = messageOf(component);
  return message?.display === true && message.customType === 'subagent-notification';
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
  open = false;
  components: CustomMessageComponent[] = [];
  private host: Host;
  private tasks: Task[] = [];
  private rows = new Map<Task, TaskView>();
  private version = 0;
  private seen = -1;

  constructor(host: Host) { super(); this.host = host; }

  setComponents(components: CustomMessageComponent[]) {
    if (this.rows.size) this.releaseRows();
    this.components = components;
    this.tasks = components.flatMap(tasksOf);
    this.version++;
  }

  add(component: CustomMessageComponent) {
    this.components.push(component);
    this.tasks.push(...tasksOf(component));
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

  summary(): string {
    let completed = 0, running = 0, failed = 0;
    for (const task of this.tasks) {
      if (task.status === 'done') completed++;
      else if (task.status === 'error') failed++;
      else running++;
    }
    const state = failed ? 'Failed' : running ? 'Working' : 'Process';
    const counts = [completed && `${completed} completed`, running && `${running} running`, failed && `${failed} failed`].filter(Boolean);
    return `${state} · Subagents ${counts.join(' · ')}`;
  }

  private releaseRows() {
    for (const row of this.rows.values()) row.release();
    this.rows.clear();
    this.clear();
  }

  private sync() {
    if (this.seen === this.version) return;
    this.seen = this.version;
    this.clear();
    this.addChild(new Spacer(1));
    const status: NotificationStatus = this.tasks.some(task => task.status === 'error') ? 'error'
      : this.tasks.some(task => task.status === 'running') ? 'running' : 'done';
    const style = (text: string) => this.host.color?.(statusColor[status], text) ?? text;
    this.addChild(new MouseRegion(line(() => `${this.open ? '▾' : '▸'} ${this.summary()}`, style), event => {
      if (event.type !== 'click' || event.button !== 'left') return;
      this.toggle();
      return { handled: true };
    }));
    if (this.open) for (const task of this.tasks) {
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
  private groupOf = new Map<CustomMessageComponent, SubagentGroup>();

  constructor(projection: Container, host: Host) { this.projection = projection; this.host = host; }

  append(canonical: Component, visible: Component | undefined) {
    if (!visible) return;
    if (!isSubagentNotification(canonical)) { this.projection.addChild(visible); return; }
    const last = this.projection.children.at(-1);
    const group = last instanceof SubagentGroup ? last : new SubagentGroup(this.host);
    if (group !== last) { this.groups.add(group); this.projection.addChild(group); }
    group.add(canonical);
    this.groupOf.set(canonical, group);
  }

  reconcile(children: Component[], project: (child: Component) => Component | undefined) {
    const output: Component[] = [];
    const used = new Set<SubagentGroup>();
    let run: CustomMessageComponent[] = [];
    const flush = () => {
      if (!run.length) return;
      let group = run.map(component => this.groupOf.get(component)).find(candidate => candidate && !used.has(candidate));
      if (!group) group = new SubagentGroup(this.host);
      group.setComponents(run);
      used.add(group);
      output.push(group);
      run = [];
    };
    for (const child of children) {
      const visible = project(child);
      if (!visible) continue;
      if (isSubagentNotification(child)) run.push(child);
      else { flush(); output.push(visible); }
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
