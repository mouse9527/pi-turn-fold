# Prototype design

## Boundary

The extension changes presentation only. It registers no tools, modifies no context messages, rewrites no session entries, and edits no installed Pi file. It relies on the ordinary TypeScript extension loader supplying the host's exported classes. Loading a second copy from an absolute `dist/` path would patch the wrong class graph; the real bundled-CLI smoke test covers this distinction.

Runtime compatibility is pinned to Pi **0.85.1**, not a guessed semver range. Only one adapter may be active. Known competing renderer commands are rejected, but this is **not comprehensive conflict detection**. Test with extension discovery disabled.

## Why keep canonical component shells?

Pi's native `handleEvent` owns more than drawing. It handles pending-tool bookkeeping, streaming state, diagnostics, retry/compaction state, working indicators, queues and shutdown. Swallowing those events would risk losing errors or breaking execution-related controls.

The adapter calls the original event and historical rendering methods. Native tool/assistant shells retain current data, but their expensive presentation methods are deferred:

- `AssistantMessageComponent.updateContent`: retain the message reference without building Markdown for canonical hidden assistants.
- `ToolExecutionComponent.updateDisplay`: suppress native argument/result/diff layout for canonical tools.
- `ToolExecutionComponent.maybeConvertImagesForKitty`: no image conversion for canonical hidden tools.

Independent native detail components are constructed only when the user opens an item. They receive a guarded rendering callback; callbacks from closed detail components cannot trigger further host redraws. Native image conversion already in flight is not cancellable and may finish after collapse.

## Visible tree

The canonical chat remains flat and in native order. The adapter projects user messages, lightweight turn anchors, and native notices into a second `Container`. Hidden native tools and assistants are absent from that visible tree, not rendered and then erased.

Both `render` and `handleMouse` delegate to that same tree, so mouse offsets use real component layout. Only process/item header clicks are consumed. Wheel input, selection and editor focus retain native routing.

Native custom entries occasionally insert directly into `chatContainer.children`. The adapter reconciles that rare insertion path explicitly; ordinary streaming events do not rescan the canonical tree.

A “turn” here begins at a delivered **user message**, not every model `turn_start`. Tools are indexed by ID so interleaved parallel results and late results remain associated with their originating user turn. Historical result reconciliation is a one-time linear pass over Pi's supplied display items. The adapter does not rebuild a full pre-compaction branch on its own.

## Final answers and failures

While an agent run is active, text stays inside the process. At run end, the latest assistant message without tool calls contributes its text-only final answer. Prior assistant messages and thinking remain individually inspectable.

Assistant error, abort and length stops create visible alert text, including when there is no final answer. An error/abort also marks outstanding tool rows failed for display, matching native Pi's treatment. Tool `isError`, structured truncation metadata and unresolved calls appear in process counts. Unknown tool-specific textual truncation formats cannot always be classified automatically; the saved output remains available.

## Diff correctness

A historical `edit` renderer must not call `computeEditsDiff` against the current file. The detail view wraps only its presentation callback and forces `argsComplete: false`; the result renderer still receives the saved diff. It does not change tool execution or stored arguments.

`write` has no historical before-image by default. Its written content is shown with an explicit notice, never labeled as a reconstructed before/after diff.

## Restoration

Each runtime and instance method wrapper keeps its previous descriptor. Disposal restores only slots still owned by this adapter; it never overwrites a later extension's wrapper. The duplicate-install marker prevents stacking this adapter with itself.

`/fold off` restores methods, removes the invisible anchors, hydrates canonical native display components, and releases projection/detail references. Historical edit previews are disabled during that hydration. Lifecycle shutdown releases resources without requesting a render after terminal shutdown. Reload reconstructs the display via Pi's ordinary path.

An extension that wraps our functions later can keep a reference to our old closure; arbitrary monkey-patch composition cannot be made reliable. The supported environment has no other transcript renderer, and restarting remains the safest recovery for unknown conflicts.

## Performance limits

- Closed process rendering is independent of the number/size of its hidden tools.
- Live state updates use maps; no extension-owned periodic work exists.
- Canonical shells and display references still occupy memory proportional to retained history.
- Rendering all visible user turns remains linear in turn count; this is not history virtualization.
- An expanded turn walks its lightweight item rows. Open details pay native Markdown/diff/image costs.
- Current final answers, native footer accounting and model/tool argument parsing are outside this optimization.
- Synthetic microbenchmarks measure only `Turn` updates and `TurnView` rendering. They do not prove end-to-end input latency, stable heap usage, or Ghostty pixel cleanup.

## Manual acceptance before daily use

Use a session copy and a fresh Pi process with only this extension:

1. Restore the copy; confirm defaults, final replies, errors and image-only tool calls.
2. Run long commands with large streamed results; type and scroll while they execute.
3. Expand/collapse a tool image repeatedly in Ghostty; check for stale pixels and continuing redraws.
4. Resize and change theme with closed/open items; verify correct mouse targets and readable output.
5. Exercise abort, tool failure, model error, length limit, permission UI, new/resume/fork/tree and compaction.
6. Measure idle CPU, input-to-paint p95 and heap growth before/after 50 switches.
7. Disable and reload, or restart without the extension, and verify native behavior and unchanged saved data.

Do not promote component benchmark timings to a “never lags” guarantee.
