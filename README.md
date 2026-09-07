# pi-turn-fold

**Experimental default turn folding for Pi 0.85.1.** A standalone Pi extension, not a fork. MIT licensed.

Keep the question and final answer visible. Fold intermediate assistant text, thinking, tool arguments, results and tool images into one process row—also while working.

```text
Your question

▸ Process · 8 tools

Final answer
```

Expand the process, then an individual item:

```text
▾ Process · 8 tools
  ▸ Assistant / thinking
  ▸ read src/auth.ts · done
  ▸ bash python3 · done
  ▾ edit src/auth.ts · done
    Arguments …
    [native saved edit diff]
```

Failures, aborted responses, truncation and unfinished calls are indicated outside the collapsed details. Pi's extension dialogs, notices, editor and execution behavior remain native.

## Try without changing your configuration

**Only Pi 0.85.1 is supported.** Other versions refuse activation. Disable other transcript/tool-display extensions; do not stack this with `pi-cc-extensions`, `pi-tool-display`, or another folding renderer.

```bash
# After cloning this repository; no npm install is needed to load the extension in Pi.
pi --no-extensions -e ./extensions/index.ts --tui-mode fullscreen
```

To test a long session, first copy its JSONL file into a **separate temporary directory**, then pass `--session /path/to/copy.jsonl`. Do not use the original file for experimentation. No session data is included in this repository.

`--no-extensions` disables discovery of your other extensions for that invocation only. Other global settings still apply. The automated smoke test below uses a completely separate agent directory and synthetic history.

Once you have tested it, optional persistent installation:

```bash
pi install git:github.com/mouse9527/pi-turn-fold
```

Restart Pi after changing renderer packages. Installing the package does **not** automatically disable conflicting packages.

## Controls

Folding is **on by default**; there is no `/focus` step.

| Action | Control |
| --- | --- |
| Toggle latest process | `Ctrl+Shift+O` or `/fold` |
| Toggle numbered process | `/fold 2` |
| Toggle a tool within that process | `/fold 2 3` (third tool, not third assistant item) |
| Pick any saved tool/assistant/thinking item with the keyboard | `/fold inspect` |
| Click process or item header | Fullscreen mode only |
| Restore native transcript for this run | `/fold off` |
| Re-enable after `/fold off` | `/reload` |

Numbers start at 1 in the currently displayed, compaction-aware history. Regular terminal mode supports commands/keyboard, but not mouse clicks. `Ctrl+O` remains Pi's native tool-expansion control; it does **not** open process rows. Use the controls above for folded items.

## Scope and limits

- **Final text appears at the end of the agent run**, not token by token. This avoids repeatedly showing intermediate text and taking it away when another tool call follows. During generation, the process summary stays visible. Expand a process item to inspect current text.
- Tool details reuse Pi's native renderer, plus a saved-arguments inspector. Custom/MCP tools use their registered renderer or the native fallback.
- `edit` uses the diff saved in the result. Historical expansion does not preview the edit against today's file.
- `write` shows saved written content. **No old-file snapshot means no trustworthy before/after diff.** This extension does not capture snapshots or change writes.
- “Full output” means what Pi saved. Content already truncated by a tool cannot be recreated.
- Custom extension notices and user-run `!` shell commands stay native and may occupy multiple lines. They are not silently hidden as assistant process.
- No theme, animation, settings panel, snapshots, telemetry, new tools, or model calls.
- **Internal runtime adaptation is required.** No Pi files are patched on disk, but private methods are wrapped in memory. Public extension APIs alone cannot implement this behavior. Unknown renderer conflicts and Pi upgrades can break it.

## Performance and validation

Collapsed tools do not invoke native result/diff/image rendering. Pi's lightweight canonical component shells remain so native lifecycle handling is preserved; a separate visible component tree skips them during layout. Tool state is updated by ID, not by rescanning history. Details are created on demand and dropped on collapse. The extension adds no timer.

Local synthetic display microbenchmark (Node 22, Pi 0.85.1):

| Saved calls | Visible process rows | Update + render p95 |
| ---: | ---: | ---: |
| 300 | 1 | ~0.015 ms |
| 1,000 | 1 | ~0.012 ms |
| 10,000 | 1 | ~0.011 ms |
| 10,000 | 100 | ~0.67 ms |

**These are not input-to-screen latency or total Pi CPU measurements.** They exclude footer statistics, host event/argument parsing, terminal writes and visible image conversion. Many expanded items, very long final answers and very many user turns can still be expensive. There is no blanket “never lags” claim.

Verified locally:
- State and native-component integration tests: streaming, parallel completion, failure visibility, lazy rendering, saved edit diff, click coordinates, cleanup and reinstall.
- Actual bundled Pi CLI in isolated regular and fullscreen PTYs: restore 300 synthetic tool calls with three image attachments; two-level expansion; native restoration; reload; quit. No model request is sent.
- 50 repeated process expand/collapse cycles release detail rows.

**Still needs manual acceptance:** Ghostty image pixel cleanup, real long-session input/scroll latency, and sustained heap/CPU profiling. PTY tests are not a substitute for those checks. Treat this as a prototype until your own session passes them.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run bench
python3 tests/smoke.py
FOLD_SMOKE_FULLSCREEN=1 python3 tests/smoke.py

# Also test a specific globally installed Pi CLI:
python3 tests/smoke.py /path/to/pi-coding-agent/dist/bundle/cli.js
```

Node 22.19+ and Python 3 are required for the checks; no test framework is added. Runtime Pi imports are supplied by Pi's extension loader, not bundled with this package. See [the adapter design and limitations](docs/design.md).

## 中文说明

这是一个**默认整轮折叠**的实验性 Pi 插件，不需要手动进入 Focus。平时保留问题、过程摘要和最终回复；需要时展开过程，再展开工具查看参数、结果、图片和已有的 `edit` diff。

仅支持 **Pi 0.85.1**，不修改安装文件、不维护 Pi 分支，但依赖内存中的内部接口适配。先用上面的临时加载命令和会话副本试用；不要与其他工具显示插件混用。性能微基准与终端冒烟测试已通过，真实 Ghostty 图片和长会话手感仍需实测。
