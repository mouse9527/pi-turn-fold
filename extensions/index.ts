import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installAdapter } from '../src/adapter.ts';
import { toolLabel } from '../src/turns.ts';

export default function(pi: ExtensionAPI) {
  let adapter: ReturnType<typeof installAdapter> | undefined;
  let failure: string | undefined;
  try { adapter = installAdapter(); }
  catch (error) { failure = String(error); }

  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') { adapter?.dispose(); adapter = undefined; return; }
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

  pi.on('session_shutdown', () => { adapter?.dispose(); adapter = undefined; });

  pi.registerShortcut('ctrl+shift+o', {
    description: 'Expand/collapse the latest process (pi-turn-fold)',
    handler: async ctx => {
      if (!adapter?.toggle()) ctx.ui.notify('No folded turn available.', 'info');
    },
  });

  pi.registerCommand('fold', {
    description: 'Toggle process: /fold [turn [tool]], /fold inspect, or /fold off',
    handler: async (args, ctx) => {
      if (!adapter || ctx.mode !== 'tui') { ctx.ui.notify(failure ?? 'Folding is inactive; reload to enable.', 'warning'); return; }
      const input = args.trim();
      if (input === 'off') {
        adapter.dispose(true);
        adapter = undefined;
        ctx.ui.notify('Native transcript restored. /reload to enable folding again.', 'info');
        return;
      }
      if (input === 'inspect') {
        const choices = adapter.views.map((view, i) => `${i + 1}. ${view.turn.summary()}`);
        const choice = await ctx.ui.select('Select turn', choices);
        if (!choice || !adapter) return;
        const view = adapter.views[choices.indexOf(choice)];
        if (!view) return;
        const items = view.turn.items.map((item, i) => `${i + 1}. ${item.kind === 'tool' ? toolLabel(item) : 'Assistant / thinking'}`);
        const item = await ctx.ui.select('Select saved process item', items);
        if (!item || !adapter || !adapter.views.includes(view)) return;
        view.toggleItem(view.turn.items[items.indexOf(item)]);
        return;
      }
      if (input && !/^\d+(?:\s+\d+)?$/.test(input)) {
        ctx.ui.notify('Usage: /fold [turn [tool]], /fold inspect, /fold off', 'info');
        return;
      }
      const [turn, tool] = input ? input.split(/\s+/).map(Number) : [];
      if (!adapter.toggle(turn === undefined ? undefined : turn - 1, tool === undefined ? undefined : tool - 1))
        ctx.ui.notify('Turn/tool number not found (numbering starts at 1).', 'warning');
    },
  });
}
