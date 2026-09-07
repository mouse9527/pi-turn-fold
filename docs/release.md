# 发布方案：先 Git tag + GitHub Release

> 首个实验预发布 [`v0.3.0-rc.1`](https://github.com/mouse9527/pi-turn-fold/releases/tag/v0.3.0-rc.1) 已发布；对应提交为 `0fcdead2d9e5b9a168395dc00ca40709f03db3fe`。发布分支与 tag CI 均通过，固定 tag 安装已验证。下文保留准备流程与后续发布方案，不应盲目重跑已执行的创建命令。
> 本次从基线 `14b6f9217c90d771a189923a384670ffcbe2cb92`（原 package version `0.2.1`）在隔离工作树的 `release/v0.3.0-rc.1` 分支准备候选；不修改开发工作树。

## 1. 最小方案与现状

- **推荐**：Git 安装作为一等分发方式；annotated tag 固定源码，GitHub Release 提供说明、兼容性和验证证据。
- **已有**：公开 MIT 仓库、Pi package manifest、源码 TS、lockfile，以及 `.github/workflows/ci.yml` 的 push/PR 检查。
- CI 已配置 `npm ci --ignore-scripts`、typecheck、node:test、microbench、真实 bundled Pi CLI 的 regular/fullscreen 隔离 PTY smoke。
- **当前**：`main` 仍是开发分支；`v0.3.0-rc.1` 从隔离的 `release/v0.3.0-rc.1` 分支发布，未晋升为稳定 Latest。公开状态以 [GitHub Releases](https://github.com/mouse9527/pi-turn-fold/releases) 为准，历史版本号/版本提交本身不等于公开 Release。
- **未来建议，尚未实施**：`dev` 承载开发/候选，默认分支 `main` 仅接收已验证的正式发布 SHA；届时无 ref 安装才可作为稳定更新渠道。现在无 ref 得到的是最新开发源码，不宣称稳定。
- **尚未实现/本方案不新增**：release workflow、tag 保护规则、npm 分发、自动版本提升或自动 release notes。
- 先用人工 `gh release create --draft` + 审核后发布；已有 CI 足够，不新增流水线、token 或发布依赖。
- TS 源码由 Pi extension loader 直接加载；用户无需本地 `tsc` 或 `npm run build`，维护者也不生成发布 build。Pi 仍可能自动安装依赖；不上传 dist、二进制或 node_modules，GitHub 自带源码归档足够。
- 运行时没有新增第三方依赖，Pi 核心 imports 由宿主提供；开发依赖不等于运行时捆绑依赖。

## 2. 版本与状态必须分开

本次准备实验候选 **`0.3.0-rc.1`**；人工验收通过后才考虑正式 **`0.3.0`**。
0.x 表示接口仍可能变化；本项目约定：功能/不兼容交互或宿主支持策略变化升 minor，纯兼容修复升 patch（例如 `0.2.2`）。
这不是宣称 SemVer 为所有 0.x 项目强制规定了同一种兼容策略。

| 状态 | 实际含义 |
| --- | --- |
| 修改 package/lock 版本 | 仅元数据变更，没有发布 |
| commit + push | 源码可见，未必通过 CI，更不是 Release |
| 同一 SHA 的 CI 全绿 + 人工验收记录 | 具备候选发布证据 |
| 推送 annotated tag | Git 用户已经可以安装该固定 ref，但 Release 可能仍是草稿 |
| GitHub draft | 说明待审，不算公开 Release |
| 发布 prerelease / 正式 Release | 对外公告的候选 / 正式版本；应分别报告 URL、tag、SHA |

RC 缺少真实终端验收时可以公开为明确标记的实验预发布，不设置为 Latest。
正式 `0.3.0` 必须完成下述人工门禁；发现错误发 `rc.2` 或后续修复版本，绝不移动/重用旧 tag。
正式版修改版本号会产生新 SHA，不能直接套用 RC 的 CI 结论；重新验证并记录。

## 3. 兼容性矩阵与门禁

| 环境 | 发布要求 / 证据边界 |
| --- | --- |
| Pi **0.85.1**, Node 22.19+ 的 Node 22, Linux CI | check/test/bench + bundled CLI regular/fullscreen PTY 全通过 |
| Pi **0.85.1**, macOS + Ghostty | 候选 SHA 上人工检查两种模式；记录 macOS、Ghostty、Node 精确版本 |
| 其他 Pi 版本 | 不支持；version guard 必须拒绝激活，不得部分安装适配器 |
| Windows、其他 Node major / 终端 | 本轮不增加验证承诺；不能由 Linux CI 推导支持 |

`src/adapter.ts` 依赖私有运行时方法，严格检查 `VERSION === '0.85.1'`。
optional peers 的 `*` 是 Pi 核心供给/装载声明，**不是宿主兼容性保证**。
宿主升级必须复查私有调用、guard、固定 devDependencies/lockfile，并在新宿主重跑单测、两种 PTY 和人工矩阵；不能仅放宽范围。
不和其他 transcript/tool renderer 叠加；非 TUI 模式不承诺折叠。

人工门禁（正式发布逐项通过；RC 未完成项必须写进 Known limits）：
- [ ] 流式文字及中间说明不被后续工具收回；独立分组/两级展开、键盘可用，fullscreen 点击坐标正确。
- [ ] 失败、abort、未完成调用、截断在折叠外可见；没有 final answer 也不能隐藏错误。
- [ ] 历史 `edit` 显示保存的 diff，不按当前磁盘重算；`write` 仅显示保存内容，不虚构 before/after。
- [ ] streaming 中 `/fold off`、`/fold on` 不终止工具、不重载；reload/退出后无重复 wrapper 或残留。
- [ ] Ghostty 图片展开/折叠、滚动、切换模式后无残像；PTY 输出断言不能证明图片像素清理。
- [ ] 真实长会话副本输入/滚动手感可接受；记录样本规模、方法和现象，不把 bench p95 当输入到屏幕延迟。
- [ ] 持续 heap/CPU 未测就明确未测；不作“永不卡顿”“零内存增长”承诺。

## 4. 维护者准备与本地验证（批准后执行）

本次在从上述基线创建的隔离 release 工作树执行；不要操作另一位开发者的在途工作树。
以下准备命令针对本次 `release/v0.3.0-rc.1` 分支，RC 不进入 `main`；未来 `dev` 开发 / `main` 稳定策略尚未实施。验证无需本地构建或编译产物。
`origin` 应指向 `https://github.com/mouse9527/pi-turn-fold.git`（SSH 同仓库也可）。

```bash
cd /path/to/clean/pi-turn-fold
set -e
REPO=mouse9527/pi-turn-fold
VERSION=0.3.0-rc.1
TAG=v$VERSION
git remote -v
test -z "$(git status --porcelain)"
test "$(git branch --show-current)" = release/v0.3.0-rc.1
npm version "$VERSION" --no-git-tag-version --ignore-scripts
# 核对 package.json 与 package-lock.json 同步；人工更新 README 的实际变化/限制。
git diff -- package.json package-lock.json README.md docs/release.md
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run bench
CLI="$PWD/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"
node "$CLI" --version
python3 tests/smoke.py "$CLI"
FOLD_SMOKE_FULLSCREEN=1 python3 tests/smoke.py "$CLI"
# 此处完成第 3 节人工验收；仅使用隔离配置、合成历史或会话副本。
git add package.json package-lock.json README.md docs/release.md
git diff --cached --check
git diff --cached
# 确认暂存区没有会话、凭据、截图中的私人信息、个人路径或其他未批准文件。
git commit -m "chore: prepare $VERSION"
SHA=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
git push origin "$BRANCH"
```

smoke 默认也指向上述 bundled CLI；显式参数防止误测另一个全局 Pi。
该脚本建立临时 agent 目录及 300 次合成工具历史（含三张图片），不发送模型请求。
本次候选的本地测试结果记录于仓库外 release notes；最终 commit SHA 和分支/tag CI URL 必须由维护者验证后补齐，不能据准备过程宣称 CI 已通过。
保存候选 SHA、命令退出码、Node/Pi 版本、bench 输出和人工结果；公开证据只用脱敏摘要/合成材料。

## 5. CI、tag、公开 Release（逐步人工确认）

以下沿用上节变量；另开 shell 时须从验证记录恢复它们，不能默认最新 HEAD 就是已验证 SHA。

```bash
gh run list --repo "$REPO" --workflow CI --event push --branch "$BRANCH" --commit "$SHA" \
  --json databaseId,headSha,headBranch,status,conclusion,url
# 选择该分支 push、准确 SHA 的运行 ID，不使用无条件的“最近一次成功”。
RUN_ID=替换为该次运行ID
gh run watch "$RUN_ID" --repo "$REPO" --exit-status
test "$(gh run view "$RUN_ID" --repo "$REPO" --json headSha --jq .headSha)" = "$SHA"
test "$(gh run view "$RUN_ID" --repo "$REPO" --json headBranch --jq .headBranch)" = "$BRANCH"
test "$(gh run view "$RUN_ID" --repo "$REPO" --json conclusion --jq .conclusion)" = success
```

未来正式版晋升（本次 RC 跳过；仅当未来分支策略另行批准并建立后适用）：先在 `dev` 完成正式版本号的准确 SHA CI + 第 3 节人工门禁，保存证据；维护者批准后才执行：

```bash
git fetch origin
git switch main
git merge --ff-only origin/main
git merge --ff-only "$SHA"
test "$(git rev-parse HEAD)" = "$SHA"
git push origin main
BRANCH=main
```

只能 fast-forward 到已验证 SHA，不可 squash/生成未验证 merge commit；无法快进就停止，在 `dev` 整理后重新验证新 SHA。
晋升后按上面的分支 CI 命令重新选择 `main`、同一 `$SHA` 的 push 运行并通过，再继续 tag。
`main` push 已让原生更新用户取得源码，不能等 Release 发布才算门禁；因此人工批准必须在晋升前完成。GitHub Release 是公告，不是下载开关。

```bash
test "$(git rev-parse HEAD)" = "$SHA"
test -z "$(git status --porcelain)"
git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}"
# 输出必须为空；同名本地/远端 tag 已存在则停止，不覆盖。
git tag -a "$TAG" "$SHA" -m "pi-turn-fold $VERSION; Pi 0.85.1"
git push origin "refs/tags/$TAG"
test "$(git cat-file -t "$TAG")" = tag
test "$(git rev-parse "$TAG^{commit}")" = "$SHA"
git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}"
```

远端普通 tag 行是 tag object SHA；**`refs/tags/$TAG^{}` 行才应等于已验证的 commit SHA**。
现有 CI 也会被 tag push 触发；必须单独选择并验证 tag 运行，不能用同 SHA 的先前分支运行代替。
不要创建与发布 tag 同名的分支；若列表为空，等待 tag 运行出现，不回退选择分支运行。

```bash
gh run list --repo "$REPO" --workflow CI --event push --branch "$TAG" --commit "$SHA" \
  --json databaseId,headSha,headBranch,status,conclusion,url
TAG_RUN_ID=替换为上面tag推送运行ID
gh run watch "$TAG_RUN_ID" --repo "$REPO" --exit-status
test "$(gh run view "$TAG_RUN_ID" --repo "$REPO" --json headSha --jq .headSha)" = "$SHA"
test "$(gh run view "$TAG_RUN_ID" --repo "$REPO" --json headBranch --jq .headBranch)" = "$TAG"
test "$(gh run view "$TAG_RUN_ID" --repo "$REPO" --json conclusion --jq .conclusion)" = success
```

任何失败先停下调查；修复需要新 commit、新版本和新 tag，不用 force-push“修好”旧 tag。

```bash
# 用编辑器在仓库外创建说明文件，按第 8 节填写真实证据。
NOTES="${TMPDIR:-/tmp}/pi-turn-fold-$VERSION-notes.md"
"${EDITOR:-vi}" "$NOTES"
gh release create "$TAG" --repo "$REPO" --verify-tag --draft --prerelease \
  --title "pi-turn-fold $VERSION (Pi 0.85.1 only)" --notes-file "$NOTES"
# 维护者核对草稿、远端 peeled SHA、CI 链接和风险声明后才执行：
gh release edit "$TAG" --repo "$REPO" --draft=false --prerelease --latest=false
gh release view "$TAG" --repo "$REPO" --json url,isDraft,isPrerelease,tagName
```

正式版另走完整准备/CI/tag 流程，设置 `VERSION=0.3.0`；创建草稿时去掉 `--prerelease`，
最终执行 `gh release edit "$TAG" --repo "$REPO" --draft=false --prerelease=false --latest`。
这是公开发布动作，不是 push 的隐式附带效果。流程中断后先检查远端状态，别盲目重跑创建命令。

## 6. 用户安装、升级与本地路径

最新源码安装与 Pi 原生插件更新（**今天是开发渠道**；未来 `main` 稳定策略落实后才是稳定渠道）：

```bash
pi install git:github.com/mouse9527/pi-turn-fold
pi update --extension git:github.com/mouse9527/pi-turn-fold
# 或更新所有 Pi 扩展包，不升级 Pi 宿主：
pi update --extensions
pi list
# 锁定版本（示例 tag 仅在实际推送后可用）；升版重新 install 新 tag：
pi install git:github.com/mouse9527/pi-turn-fold@v0.3.0-rc.1
# 项目级安装加 -l；包命令须紧跟 pi，不写 pi --flag install ...。
```

- 无 ref 首次 clone 使用默认分支；后续原生更新按托管 checkout 的 upstream（无 upstream 时回退远端默认分支），**不查询 GitHub Latest Release API**。Release 标记 Latest 不会改变更新目标。
- `@latest` 只是名为 `latest` 的 Git ref，不是 GitHub Latest Release 别名；不建议维护移动 latest tag，也不新增自定义 updater。
- immutable `@vTAG` / commit 锁定版本，不自动跳到新版本；升级用 `pi install git:github.com/mouse9527/pi-turn-fold@新tag`。Git 包身份按不含 ref 的仓库 URL，重新安装新 tag 是换版本，不是另装一份。
- 更新检查跳过 pinned Git ref，但显式更新仍 fetch 配置的 ref 并协调 checkout；branch ref 或刻意移动的 tag 可能变化，不能泛称所有 `@ref` 永不移动。本项目版本 tag 不移动。
- 单独 `pi update` 更新的是 **Pi 本身**，不是扩展；`--all` 还会升级宿主，可能触发 0.85.1 guard，勿作为本插件推荐升级步骤。
- 本地源 `pi install /absolute/path/to/pi-turn-fold` 不复制文件；相对路径相对其 settings 文件解析。
- 当前 `../../workspace/pi-turn-fold` 安装指向本地源码，发布 tag 不会替它切版本；源码变化只需重新加载，不由 package update 拉新代码。
- 本地源和 Git URL 的身份不同，可能重复加载。切渠道先 `pi list`，备份配置，再 `pi remove /absolute/path/to/pi-turn-fold`（项目安装加 `-l`），然后安装 Git ref。
- 安装/升级代码后，等当前工作结束，在 Pi 内执行一次 `/reload`（或重启一次）。换 renderer 时重启更稳妥，并先移除冲突插件。
- 已加载后 `/fold on`、`/fold off` 立即切换，无需 reload；reload/新启动默认 on，off 不是卸载。

## 7. 回滚与数据保护

发布前记录“上一已验证 ref”；首次发布没有旧 tag，可选择经重新验证的基线完整 commit：

```bash
pi install git:github.com/mouse9527/pi-turn-fold@14b6f9217c90d771a189923a384670ffcbe2cb92
# 后续也可用真实存在的旧 immutable tag；随后在 Pi 内 /reload 一次。
```

这只是扩展源码回滚，不自动回退 Pi 宿主、配置或会话；基线也仅支持 Pi 0.85.1。
严重显示问题先 `/fold off`；无法加载则移除该包并重启，不删除会话来“修复”。
Pi 协调 Git ref 时可能 reset + clean checkout，并在存在 package.json 时运行 npm install；
**不要在 `~/.pi/agent/git/...` 或项目 `.pi/git/...` 托管 clone 内保存本地修改或唯一文件。**
改代码使用独立开发 clone。安装第三方包会执行任意代码，用户应先审查源码。
操作前在仓库外私下备份全局/项目 settings 和需要保留的会话；测试只用复制到独立临时目录的 JSONL，不打开原件做实验。
不自动覆盖原始配置、不把备份/session/auth/私有日志带入 Git、Release 附件或公开 CI artifacts。

## 8. Release notes 模板与剩余决定

```markdown
## Changes
- 用户可见变化（只写本次实际完成项；无先前 tag 时明确首个公开版本）。
## Compatibility
- Pi 0.85.1 only；私有 runtime adapter；其他版本拒绝激活。
- Node / OS / Ghostty 的实际验证版本；regular/fullscreen；冲突 renderer 说明。
## Install / Upgrade / Rollback
- 无 ref 安装/原生插件更新命令及当前渠道状态；immutable tag 锁版/换版命令；一次 /reload；已验证旧 ref 回滚。
## Verification
- 完整 commit SHA、annotated tag、CI run URL；check/test/bench/两种 PTY 结果。
- 人工验收人/日期/环境/样本规模；失败、abort、saved diff 与图片检查结果。
## Known limits
- 实验状态；PTY 不证明图片像素/真实输入延迟；未测 heap/CPU 如实注明。
- write 无旧快照；截断内容不可恢复；不兼容其他 transcript renderer。
```

默认决定：先 GitHub 手动发布，不上 npm。仅当需要 npm 搜索/registry 安装或确有用户需求时再申请 npm 名称、内容审计和凭据方案；若采用该渠道，npm 更新语义须按届时 Pi 版本另行核验。
若人工发布频率真正成为负担，再单独批准最小 `workflow_dispatch` + 人工 environment gate；本轮不创建 workflow、不改权限或保护规则。
依据：原方案基线 package/CI/README、adapter 与测试；原方案编写时完整核对已安装 Pi 0.85.1 的 `docs/packages.md`、`quickstart.md`、`usage.md`，并读取 `dist/core/package-manager.js` 的 `checkForAvailableUpdates`、`getLocalGitUpdateTarget`、`installGit`、`updateGit`、`ensureGitRef` 实现。宿主升级后重新核对；上述实现核对为原方案记录。候选准备后，维护者独立复验并确认[分支 CI](https://github.com/mouse9527/pi-turn-fold/actions/runs/34137808216)与 [tag CI](https://github.com/mouse9527/pi-turn-fold/actions/runs/34138061325)均通过，随后公开预发布并验证固定 tag 安装。未来稳定分支策略尚未实施，人工终端/图片等未测边界仍见 Release notes。
