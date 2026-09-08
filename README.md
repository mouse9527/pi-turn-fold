# pi-turn-fold

**Experimental segmented tool folding for Pi 0.85.1.** A standalone Pi extension, not a fork. MIT licensed.

Assistant text streams normally and stays visible. Consecutive tool calls and thinking fold into process groups; **visible text separates the groups**. Tool arguments, results and images stay collapsed while working.

```text
Your question

▸ Process · Read 2 · Run 1                # a, b, c

Found the issue. Next I'll update the config.   # streamed immediately

▸ Process · Run 1 · Edit 2                # d, e, f

Fixed; tests passed.                    # also streamed immediately
```

Expand one process group, then an individual item:

```text
▾ Process · Read 1 · Run 1 · Edit 1
  ▸ Thinking
  ▸ ✓ read src/auth.ts
  ▸ ✓ bash python3
  ▾ ✓ edit src/auth.ts +12 −4
    Arguments …
    [native saved edit diff]
```

Labels use English categories and recognizable lowercase tool actions, with call counts (not distinct-file counts). The `@tintinweb/pi-subagents` tools `Agent`, `SubagentWorkflow`, `get_subagent_result`, and `steer_subagent`, plus the official `pi-subagents` tool `subagent`, count under `Subagent`. Their rows use bounded action/target labels and never include the large prompt, workflow script, task, or steering message. Known tools are categorized by registered name, never by substring or shell-command guesses; lookalikes and other custom/MCP names remain visible under `Other`. Status glyphs (`○`, `…`, `✓`, `✗`) remain meaningful without color; colors come from Pi's current theme.

Headers use `Process` for completed groups, `Working` for active groups, `Unfinished` for stopped unresolved groups, and `Failed` for failed groups. Builtin `bash`, `powershell`, and `Other` activity (including custom/MCP tools) stays entirely in the one-line header while folded: no transient `Running:` or `Unfinished:` line exposes their command, query, or target. Known non-shell tools retain one bounded activity line with their target/path; after the run stops, outstanding known non-shell calls use `Unfinished:` instead. Failed groups show a failure count and a short reason followed by the failed action/name and bounded target (for example `Failed: exit code 1 · bash npm test`). A parallel current/outstanding call shares that same status line. The reason comes first so long targets cannot hide it; pending/unresolved calls are never labeled completed. These compact hints do not replace saved details. Only successful `edit` results with a valid saved, numbered Pi diff get `+added −removed` statistics.

Groups expand independently, with Pi's standard outer message spacing. Click the group header or its activity line to show items, then an item row to inspect saved arguments, output and edit diffs inline. Open tool/native detail components are retained across streamed results; nested controls provided by a registered native renderer keep their own state. The plugin does not infer arbitrary Agent/MCP child executions from output text or invent a universal nested-call schema. Later tool calls never pull earlier assistant text back into a fold. Plain-text answers without tools or thinking create no empty process row. This is **not** a final-answer-only Focus view.

> **Click-to-expand requires Pi fullscreen mode.** Set `tuiMode` in `~/.pi/agent/settings.json`, then restart Pi:
>
> ```json
> {
>   "tuiMode": "fullscreen"
> }
> ```
>
> Folding still works in regular mode, but Pi does not deliver mouse clicks to the folded components there.

Both common subagent notification protocols are supported by exact type. Adjacent displayed `@tintinweb/pi-subagents` cards with `customType: "subagent-notification"` get a compact group such as `Process · Subagents 3 completed`; click the group and then a task row to reveal bounded structured metadata. Adjacent displayed official `pi-subagents` cards with `customType: "subagent-notify"` get `Process · Subagent notifications N`. Its exact `subagent_supervisor_request` messages also fold: progress reports use `Process · Supervisor N updates`, while groups containing a decision or interview request stay visibly marked `Attention · Supervisor …`. The duplicate `subagent_control_notice` emitted specifically for `event.reason: "supervisor_request"` folds into the same group as an alert; other watchdog/control notices remain native. Exact `subagent_supervisor_reply` entries fold there too. Attention headers use the theme's warning color, not its error color; they indicate required attention, not execution failure. Opening either official group reuses that package's own expanded native renderer, and folding never changes request IDs, reply state, or supervisor/subagent communication. Visible folded subagent messages seal the preceding display fragment, so intervening assistant text remains between asynchronous updates instead of being crossed by a later group. The folded view never parses either card's text/XML, reads transcript output files, or associates `subagents:record` entries. Lookalike types and all unrelated custom components split the run and remain native. Protocol compatibility is checked against `@tintinweb/pi-subagents` 0.19.0 and `pi-subagents` 0.66.0; future upstream protocol changes may require an adapter update.

Failures, aborted responses, truncation and unfinished calls are indicated outside the collapsed details. Pi's extension dialogs, notices, editor and execution behavior remain native.

## Install from GitHub

Requires **Pi 0.85.1**. Disable conflicting transcript/tool renderers before loading; review the source because extensions run with full system access.

### Recommended: unpinned GitHub install and native updates

Like [diagram-design](https://github.com/cathrynlavery/diagram-design), the unpinned Git install is intentional: Pi's native extension updates pull merged changes without selecting a new tag manually.

```bash
pi install https://github.com/mouse9527/pi-turn-fold
# Later, update extension packages without updating the Pi host:
pi update --extensions
# Then run /reload inside Pi, or restart.
```

**Today this tracks development on main, not latest stable.** Native updates follow the Git branch, not the GitHub Latest Release API. A future stable-`main` / development-`dev` policy has not been enacted. This package keeps its `pi.extensions` manifest so Pi discovers the extension; no custom updater is needed.

Pi fetches source and loads TypeScript through its extension loader. No manual clone, local compilation, `npm run build`, `tsc`, or npm account is needed. Pi may run `npm install` automatically for package dependencies. No release ZIP download or compiled artifact is required.

### Optional: version-locked experimental release or rollback

**[v0.3.0-rc.3](https://github.com/mouse9527/pi-turn-fold/releases/tag/v0.3.0-rc.3) is the current experimental prerelease for Pi 0.85.1 only**, not a stable Latest release. Public status, verification evidence and known limits are authoritative on [GitHub Releases](https://github.com/mouse9527/pi-turn-fold/releases); previous RCs remain available. Install this fixed version directly, without a local build:

```bash
pi install git:github.com/mouse9527/pi-turn-fold@v0.3.0-rc.3
```

RC3 folds exact structured subagent completion notifications and adds bounded `Subagent` process-call statistics. It retains RC2's simplified running/unfinished shell hints. Synthetic investigations still did **not** reproduce the originally reported transient raw-card leak or confirm its root cause; these display changes are not a proven general leak fix.

Version tags are immutable. Tagged installs remain version-locked: native updates do not select a newer release or switch RC2 to RC3. Explicitly install a newer published tag to change the pinned version, or choose the unpinned source above to follow development. `@latest` is not a magic GitHub Latest Release alias.

To roll back to RC2:

```bash
pi install git:github.com/mouse9527/pi-turn-fold@v0.3.0-rc.2
# Then run /reload inside Pi, or restart.
```

Restart Pi after installation or changing renderer packages; normal startup loads the registered extension in your existing terminal mode. After a code-only update, restart or use `/reload`. Installation does not disable conflicting renderers automatically.

To uninstall:

```bash
pi remove git:github.com/mouse9527/pi-turn-fold
```

**Migrating from a local checkout:** local and Git sources have different package identities and can load twice. Remove the local package registration first (`pi remove /absolute/path/to/pi-turn-fold`, using its registered path and `-l` if project-local), or remove its direct extension registration; do not delete the source checkout. Stop passing the old local `-e` path before starting the Git-installed copy.

## Try without changing your configuration

**Only Pi 0.85.1 is supported.** Other versions refuse activation. Disable other transcript/tool-display extensions; do not stack this with `pi-cc-extensions`, `pi-tool-display`, or another folding renderer.

```bash
# After cloning this repository; no npm install is needed to load the extension in Pi.
pi --no-extensions -e ./extensions/index.ts
```

To test a long session, first copy its JSONL file into a **separate temporary directory**, then pass `--session /path/to/copy.jsonl`. Do not use the original file for experimentation. No session data is included in this repository.

`--no-extensions` disables discovery of your other extensions for that invocation only. Other global settings still apply. The automated smoke test below uses a completely separate agent directory and synthetic history.

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

User-turn and tool numbers start at 1 in the currently displayed, compaction-aware history; a user turn can contain several process groups. Regular terminal mode supports commands/keyboard, but native Pi does not deliver mouse clicks there; this plugin does not enable terminal mouse capture or change your mode/settings. `Ctrl+O` remains Pi's native tool-expansion control; it does **not** open process rows. Use the controls above for folded items.

`/fold on` and `/fold off` can be used while tools or text are streaming; they do not interrupt execution or reload other extensions. Turning off closes expanded plugin details. These switches affect the current runtime only: startup and `/reload` default to on. Updating the extension's **code** still requires one reload to load the new implementation.

Off is a display switch, not an unload: lightweight event/group state keeps tracking so re-enabling can show current history immediately. Native display caches may remain after switching back on. For a no-extension performance baseline, use a fresh process without this extension.

## Scope and limits

- **All assistant text is shown token by token**, including intermediate explanations and final answers. Display follows content-block order, including text and tool calls interleaved within one assistant message. Only thinking and tool activity fold; later activity does not retract earlier text.
- Tool details reuse Pi's native renderer, plus a saved-arguments inspector. Custom/MCP tools use their registered renderer or the native fallback.
- `edit` uses the diff saved in the result. Historical expansion does not preview the edit against today's file.
- `write` shows saved written content. **No old-file snapshot means no trustworthy before/after diff.** This extension does not capture snapshots or change writes.
- “Full output” means what Pi saved. Content already truncated by a tool cannot be recreated.
- Custom extension notices and user-run `!` shell commands stay native and may occupy multiple lines. The only custom-message exceptions are the exact displayed `subagent-notification`, `subagent-notify`, `subagent_supervisor_request`, supervisor-request-specific `subagent_control_notice`, and exact `subagent_supervisor_reply` entries described above; unknown custom messages, other control notices, and other custom entries remain visible.
- No custom theme, animation, settings panel, snapshots, telemetry, new tools, or model calls.
- **Internal runtime adaptation is required.** No Pi files are patched on disk, but private methods are wrapped in memory. Public extension APIs alone cannot implement this behavior. Unknown renderer conflicts and Pi upgrades can break it.

## Performance and validation

Collapsed tools do not invoke native result/diff/image rendering. Collapsed subagent notification groups do not read previews/output paths or construct task details. Pi's lightweight canonical component shells remain so native lifecycle handling is preserved; a separate visible component tree skips them during layout. Tool state and group counts are updated by ID, not by rescanning history. Only the current assistant message is inspected for new text/tool boundaries. Completed text components are reused, not rebuilt when later tools update. Details are created on demand and dropped on collapse. The extension adds no timer.

Local synthetic display microbenchmark (Node 22, Pi 0.85.1):

| Saved calls | Visible process rows | Update + render p95 |
| ---: | ---: | ---: |
| 300 | 1 | ~0.020 ms |
| 1,000 | 1 | ~0.015 ms |
| 10,000 | 1 | ~0.015 ms |
| 10,000 | 100 | ~0.57 ms |
| 1,000 | 100, with 99 visible text separators | ~0.58 ms |

**These are not input-to-screen latency or total Pi CPU measurements.** They exclude footer statistics, host event/argument parsing, terminal writes and visible image conversion. Many expanded items, long streaming text, or many visible text/group segments can still be expensive. There is no blanket “never lags” claim.

Verified locally:
- State and native-component integration tests: live text, text/tool block ordering, independent group expansion, live/history parity, cached earlier text, parallel completion, failure visibility, lazy rendering, saved edit diff, click coordinates, cleanup and reinstall.
- Actual bundled Pi CLI in isolated regular and fullscreen PTYs: restore 300 synthetic tool calls with three image attachments, split into two groups around visible middle text; verify native message spacing from emitted rows; two-level command expansion; off/on without reload; reload; quit. No model request is sent. Inline mouse acceptance uses component event-dispatch tests (including nested registered renderers), not real terminal mouse input.
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

### Maintainer release

Version bumps and immutable annotated tags remain manual. To publish an existing tag, open **Actions → Release → Run workflow**, keep the workflow ref on the default branch (`main` today), enter the `vVERSION` tag, and optionally supply human change notes. RC tags become prereleases; a stable tag also requires the explicit manual-terminal-acceptance checkbox.

The workflow verifies the annotated tag, exact commit, package/lock versions, and all checks above before a separate publisher with `contents: write` creates the GitHub Release. Existing published releases are left unchanged; existing drafts require manual review. It never creates or moves tags, changes branches or local Pi installations, builds assets, or publishes npm. See [the release procedure](docs/release.md).

Node 22.19+ and Python 3 are required for the checks; no test framework is added. Runtime Pi imports are supplied by Pi's extension loader, not bundled with this package. See [the adapter design and limitations](docs/design.md).

## 中文说明

这是一个**文字实时显示、工具分段折叠**的实验性 Pi 插件，不需要手动进入 Focus。连续工具 a、b、c 折叠成一组；中间的助手说明正常显示；后续工具 d、e、f 另起一组。文字不会因为继续调用工具而被收回。每组可独立展开，再展开工具查看参数、结果、图片和已有的 `edit` diff。

仅支持 **Pi 0.85.1**，不修改安装文件、不维护 Pi 分支，但依赖内存中的内部接口适配。先用上面的临时加载命令和会话副本试用；不要与其他工具显示插件混用。性能微基准与终端冒烟测试已通过，真实 Ghostty 图片和长会话手感仍需实测。
