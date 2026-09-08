import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installAdapter } from '../src/adapter.ts';
import { isRoutineMcpRefreshNotice } from '../src/notices.ts';
import { toolLabel } from '../src/turns.ts';

export default function(pi: ExtensionAPI) {
  let adapter: ReturnType<typeof installAdapter> | undefined;
  let restoreNotify: (() => void) | undefined;
  let failure: string | undefined;
  try { adapter = installAdapter(); }
  catch (error) { failure = String(error); }

  pi.on('session_start', (_event, ctx) => {
    restoreNotify?.();
    restoreNotify = undefined;
    if (ctx.mode !== 'tui') { adapter?.dispose(); adapter = undefined; return; }
    const originalNotify = ctx.ui.notify;
    const filteredNotify = (message: string, type?: 'info' | 'warning' | 'error') => {
      if (!adapter?.enabled || !isRoutineMcpRefreshNotice(message, type)) originalNotify.call(ctx.ui, message, type);
    };
    ctx.ui.notify = filteredNotify;
    restoreNotify = () => { if (ctx.ui.notify === filteredNotify) ctx.ui.notify = originalNotify; };
    adapter?.setColor((name, text) => ctx.ui.theme.fg(name, text));
    const conflicts = pi.getCommands().filter(command =>
      /^(ccstyle|tool-display|compact-tools|tidy-bash|compact-transcript)$/.test(command.name));
    if (conflicts.length) {
      failure = `Disable other transcript/tool renderers first: ${conflicts.map(c => c.name).join(', ')}`;
      adapter?.dispose(true);
      adapter = undefined;
    }
    if (failure) ctx.ui.notify(`pi-turn-fold inactive: ${failure}`, 'warning');
    else if (!adapter?.captured) ctx.ui.notify('pi-turn-fold: host not captured yet; folding will attach on history rendering.', 'warning');
  });

  pi.on('session_shutdown', () => { restoreNotify?.(); restoreNotify = undefined; adapter?.dispose(); adapter = undefined; });

  pi.registerShortcut('ctrl+shift+o', {
    description: 'Expand/collapse process groups in the latest turn (pi-turn-fold)',
    handler: async ctx => {
      if (adapter && !adapter.enabled) ctx.ui.notify('Folding is off. Use /fold on to enable.', 'info');
      else if (!adapter?.toggle()) ctx.ui.notify('No folded turn available.', 'info');
    },
  });

  pi.registerCommand('fold', {
    description: 'Toggle process: /fold [turn [tool]], /fold groups, /fold inspect, /fold on|off',
    handler: async (args, ctx) => {
      if (!adapter || ctx.mode !== 'tui') { ctx.ui.notify(failure ?? 'Folding is unavailable in this runtime.', 'warning'); return; }
      const input = args.trim();
      if (input === 'on' || input === 'off') {
        if (!adapter.setEnabled(input === 'on')) ctx.ui.notify('Interactive host is not ready yet.', 'warning');
        else ctx.ui.notify(input === 'on' ? 'Folding enabled.' : 'Native transcript restored. /fold on to enable folding again.', 'info');
        return;
      }
      if (!adapter.enabled) { ctx.ui.notify('Folding is off. Use /fold on to enable.', 'info'); return; }
      if (input === 'inspect' || input === 'groups') {
        const choices = adapter.views.map((view, i) => `${i + 1}. ${view.turn.summary()}`);
        const choice = await ctx.ui.select('Select turn', choices);
        if (!choice || !adapter) return;
        const view = adapter.views[choices.indexOf(choice)];
        if (!view) return;
        if (input === 'groups') {
          const groups = view.turn.segments.filter(segment => segment.kind === 'process');
          const labels = groups.map((group, i) => `${i + 1}. ${group.summary(view.turn.running)}`);
          const choice = await ctx.ui.select('Toggle one process group', labels);
          if (choice && adapter?.views.includes(view)) view.toggleGroup(labels.indexOf(choice));
          return;
        }
        const saved = view.turn.items.filter(item => view.turn.groupOf.has(item));
        const items = saved.map((item, i) => `${i + 1}. ${item.kind === 'tool' ? toolLabel(item) : 'Thinking'}`);
        const item = await ctx.ui.select('Select saved process item', items);
        if (!item || !adapter || !adapter.views.includes(view)) return;
        view.toggleItem(saved[items.indexOf(item)]);
        return;
      }
      if (input && !/^\d+(?:\s+\d+)?$/.test(input)) {
        ctx.ui.notify('Usage: /fold [turn [tool]], /fold groups, /fold inspect, /fold on|off', 'info');
        return;
      }
      const [turn, tool] = input ? input.split(/\s+/).map(Number) : [];
      if (!adapter.toggle(turn === undefined ? undefined : turn - 1, tool === undefined ? undefined : tool - 1))
        ctx.ui.notify('Turn/tool number not found (numbering starts at 1).', 'warning');
    },
  });
}
