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

A “turn” here begins at a delivered **user message**, not every model `turn_start`. It owns an append-only sequence of **process groups and visible text segments**. Tools are indexed by ID, with a fixed owning group, so interleaved parallel results and late results update the right group and user turn. Historical result reconciliation is a one-time linear pass over Pi's supplied display items. The adapter does not rebuild a full pre-compaction branch on its own.

Only the current assistant message's content blocks are inspected during streaming. A newly visible text block seals the preceding process group; subsequent tools/thinking begin another group. Repeated snapshots update existing text/tool records, rather than repartitioning the conversation. Textless assistant messages do not break a group. Block positions follow Pi's append-oriented streaming message representation. Empty/whitespace text does not create an empty separator.

Each group owns its own expansion state. Opening one tool opens only its containing group, and a newly appended group starts closed without resetting already open groups. `/fold` keeps the user-turn-level convenience toggle; `/fold groups` selects a single group.

## Live text and failures

All visible assistant text streams immediately in content-block order, whether it is an intermediate explanation or a final answer. Text is never moved or retracted when a later tool starts. Each text segment owns a native text-only assistant component; updates carry the correct streaming flag to Markdown transformers. Later tool events do not rebuild or re-transform completed text. Thinking stays inside the process inspector; opening thinking does not duplicate the already-visible assistant text.

No final-answer classifier or end-of-run visibility gate is needed. A text-only answer creates no empty process group. Errors and tool details remain separate from these text-only components.

Assistant error, abort and length stops create visible alert text, including when there is no final answer. An error/abort also marks outstanding tool rows failed for display, matching native Pi's treatment. Tool `isError`, structured truncation metadata and unresolved calls appear in process counts. Unknown tool-specific textual truncation formats cannot always be classified automatically; the saved output remains available.

## Diff correctness

A historical `edit` renderer must not call `computeEditsDiff` against the current file. The detail view wraps only its presentation callback and forces `argsComplete: false`; the result renderer still receives the saved diff. It does not change tool execution or stored arguments.

`write` has no historical before-image by default. Its written content is shown with an explicit notice, never labeled as a reconstructed before/after diff.

## Restoration

Each runtime and instance method wrapper keeps its previous descriptor. Disposal restores only slots still owned by this adapter; it never overwrites a later extension's wrapper. The duplicate-install marker prevents stacking this adapter with itself.

`/fold off` restores methods, removes the invisible anchors, hydrates canonical native display components, and releases projection/detail references. Historical edit previews are disabled during that hydration. Lifecycle shutdown releases resources without requesting a render after terminal shutdown. Reload reconstructs the display via Pi's ordinary path.

An extension that wraps our functions later can keep a reference to our old closure; arbitrary monkey-patch composition cannot be made reliable. The supported environment has no other transcript renderer, and restarting remains the safest recovery for unknown conflicts.

## Performance limits

- Each closed process group's rendering is independent of the number/size of its hidden tools.
- Live tool state and owning-group count updates use maps; no extension-owned periodic work exists.
- Visible text is parsed while it streams, but earlier completed text components are reused. New groups/text are appended without rescanning historical items.
- Canonical shells and display references still occupy memory proportional to retained history.
- Rendering remains linear in visible segment count (text plus process groups); this is not history virtualization.
- An expanded group walks its lightweight item rows. Open details pay native Markdown/diff/image costs.
- Current streaming text, native footer accounting and model/tool argument parsing still cost work.
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
