# pi-turn-fold

**Experimental segmented tool folding for Pi 0.85.1.** A standalone Pi extension, not a fork. MIT licensed.

Assistant text streams normally and stays visible. Consecutive tool calls and thinking fold into process groups; **visible text separates the groups**. Tool arguments, results and images stay collapsed while working.

```text
Your question

▸ Process · 3 tools                     # a, b, c

Found the issue. Next I'll update the config.   # streamed immediately

▸ Process · 3 tools                     # d, e, f

Fixed; tests passed.                    # also streamed immediately
```

Expand one process group, then an individual item:

```text
▾ Process · 3 tools
  ▸ Thinking
  ▸ read src/auth.ts · done
  ▸ bash python3 · done
  ▾ edit src/auth.ts · done
    Arguments …
    [native saved edit diff]
```

Groups expand independently. Later tool calls never pull earlier assistant text back into a fold. Plain-text answers without tools or thinking create no empty process row. This is **not** a final-answer-only Focus view.

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
| Toggle all process groups in the latest user turn | `Ctrl+Shift+O` or `/fold` |
| Toggle all groups in a numbered user turn | `/fold 2` |
| Toggle a tool, opening only its containing group | `/fold 2 3` (third tool in user turn 2) |
| Pick one process group to toggle with the keyboard | `/fold groups` |
| Pick any saved tool/thinking item with the keyboard | `/fold inspect` |
| Click one group or item header | Fullscreen mode only |
| Immediately switch to native transcript | `/fold off` |
| Immediately re-enable folding, without reloading | `/fold on` |

User-turn and tool numbers start at 1 in the currently displayed, compaction-aware history; a user turn can contain several process groups. Regular terminal mode supports commands/keyboard, but not mouse clicks. `Ctrl+O` remains Pi's native tool-expansion control; it does **not** open process rows. Use the controls above for folded items.

`/fold on` and `/fold off` can be used while tools or text are streaming; they do not interrupt execution or reload other extensions. Turning off closes expanded plugin details. These switches affect the current runtime only: startup and `/reload` default to on. Updating the extension's **code** still requires one reload to load the new implementation.

Off is a display switch, not an unload: lightweight event/group state keeps tracking so re-enabling can show current history immediately. Native display caches may remain after switching back on. For a no-extension performance baseline, use a fresh process without this extension.

## Scope and limits

- **All assistant text is shown token by token**, including intermediate explanations and final answers. Display follows content-block order, including text and tool calls interleaved within one assistant message. Only thinking and tool activity fold; later activity does not retract earlier text.
- Tool details reuse Pi's native renderer, plus a saved-arguments inspector. Custom/MCP tools use their registered renderer or the native fallback.
- `edit` uses the diff saved in the result. Historical expansion does not preview the edit against today's file.
- `write` shows saved written content. **No old-file snapshot means no trustworthy before/after diff.** This extension does not capture snapshots or change writes.
- “Full output” means what Pi saved. Content already truncated by a tool cannot be recreated.
- Custom extension notices and user-run `!` shell commands stay native and may occupy multiple lines. They are not silently hidden as assistant process.
- No theme, animation, settings panel, snapshots, telemetry, new tools, or model calls.
- **Internal runtime adaptation is required.** No Pi files are patched on disk, but private methods are wrapped in memory. Public extension APIs alone cannot implement this behavior. Unknown renderer conflicts and Pi upgrades can break it.

## Performance and validation

Collapsed tools do not invoke native result/diff/image rendering. Pi's lightweight canonical component shells remain so native lifecycle handling is preserved; a separate visible component tree skips them during layout. Tool state and group counts are updated by ID, not by rescanning history. Only the current assistant message is inspected for new text/tool boundaries. Completed text components are reused, not rebuilt when later tools update. Details are created on demand and dropped on collapse. The extension adds no timer.

Local synthetic display microbenchmark (Node 22, Pi 0.85.1):

| Saved calls | Visible process rows | Update + render p95 |
| ---: | ---: | ---: |
| 300 | 1 | ~0.015 ms |
| 1,000 | 1 | ~0.012 ms |
| 10,000 | 1 | ~0.011 ms |
| 10,000 | 100 | ~0.67 ms |
| 1,000 | 100, with 99 visible text separators | ~0.71 ms |

**These are not input-to-screen latency or total Pi CPU measurements.** They exclude footer statistics, host event/argument parsing, terminal writes and visible image conversion. Many expanded items, long streaming text, or many visible text/group segments can still be expensive. There is no blanket “never lags” claim.

Verified locally:
- State and native-component integration tests: live text, text/tool block ordering, independent group expansion, live/history parity, cached earlier text, parallel completion, failure visibility, lazy rendering, saved edit diff, click coordinates, cleanup and reinstall.
- Actual bundled Pi CLI in isolated regular and fullscreen PTYs: restore 300 synthetic tool calls with three image attachments, split into two groups around visible middle text; two-level expansion; off/on without reload; reload; quit. No model request is sent.
- 50 repeated process expand/collapse cycles release detail rows; 50 off/on cycles retain the same canonical components/wrappers without stacking new ones.

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

这是一个**文字实时显示、工具分段折叠**的实验性 Pi 插件，不需要手动进入 Focus。连续工具 a、b、c 折叠成一组；中间的助手说明正常显示；后续工具 d、e、f 另起一组。文字不会因为继续调用工具而被收回。每组可独立展开，再展开工具查看参数、结果、图片和已有的 `edit` diff。

仅支持 **Pi 0.85.1**，不修改安装文件、不维护 Pi 分支，但依赖内存中的内部接口适配。先用上面的临时加载命令和会话副本试用；不要与其他工具显示插件混用。性能微基准与终端冒烟测试已通过，真实 Ghostty 图片和长会话手感仍需实测。
