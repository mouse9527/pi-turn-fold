import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { Container, type TUI } from '@earendil-works/pi-tui';
import { Turn, type AssistantMessage } from '../src/turns.ts';
import { TurnView, type ViewHost } from '../src/view.ts';

initTheme('dark', false);
let rendererRequests = 0;
const host: ViewHost = {
  ui: { requestRender() {} } as TUI, cwd: process.cwd(), showImages: true, imageWidthCells: 60,
  markdownTransformers: [], toolDefinition() { rendererRequests++; return undefined; },
};
const content = [{ type: 'text', text: 'large saved output\n'.repeat(2000) }];
const args = { command: 'python3\n' + 'large input\n'.repeat(2000) };
function measure(fn: () => void) {
  for (let i = 0; i < 100; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const start = performance.now(); fn(); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { p50: +samples[500].toFixed(4), p95: +samples[950].toFixed(4) };
}
const message: AssistantMessage = {
  role: 'assistant', content: [{ type: 'text', text: 'Progress update between tool groups.' }],
  api: 'anthropic-messages', provider: 'test', model: 'test', timestamp: 0, stopReason: 'stop',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};
const results = [];
for (const [calls, turns, groupEvery] of [[300, 1, 0], [1000, 1, 0], [10000, 1, 0], [10000, 100, 0], [1000, 1, 10]]) {
  const root = new Container();
  let current!: Turn;
  for (let t = 0; t < turns; t++) {
    current = new Turn();
    for (let i = 0; i < calls / turns; i++) {
      if (groupEvery && i > 0 && i % groupEvery === 0) current.endAssistant(message);
      const tool = current.tool(`${t}-${i}`, 'bash', args);
      current.result(tool, { content, isError: false });
    }
    root.addChild(new TurnView(current, host));
  }
  const tool = current.tool('live', 'bash', args);
  current.running = true;
  const render = measure(() => { root.render(120); });
  const update = measure(() => { current.result(tool, { content, isError: false }, true); root.render(120); });
  results.push({ calls, turns, text_separators: groupEvery ? calls / groupEvery - turns : 0, render_p50_ms: render.p50, render_p95_ms: render.p95, update_render_p95_ms: update.p95 });
  assert.equal(rendererRequests, 0, 'Folded tools must never request native detail renderers');
}
console.table(results);
console.log('Display microbenchmark only: excludes footer, host event parsing, terminal writes, images on screen and input latency.');
