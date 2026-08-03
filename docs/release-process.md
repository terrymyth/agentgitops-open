# Release Process

AgentGitOps 的公开制品只从
[`terrymyth/agentgitops-open`](https://github.com/terrymyth/agentgitops-open) 的受保护
`main` 分支发布。私有研发仓库负责开发和筛选，不拥有公开发布权限。

## Prerequisites

- 公开 PR 已合并，三平台 required checks 全部通过。
- GitHub `release` environment 已启用必要审批。
- 首次发布时，`NPM_TOKEN` 仅保存在公开仓库 `release` environment secret 中，并使用
  最小可用权限和最短有效期。
- GHCR 使用工作流的短期 `GITHUB_TOKEN`，不保存长期容器凭据。
- 本地和 CI 均通过：

```bash
pnpm validate:release:metadata
pnpm validate:release -- --public
pnpm validate:release:history
pnpm smoke:npm-install
AGENTGITOPS_SMOKE_DEPLOY_REAL=1 pnpm smoke:deployment
```

## Create a release

1. 在公开仓库更新五个 publishable package、根 `package.json`、Helm Chart 和镜像默认 tag。
2. 运行 `pnpm validate:release:metadata`，确认版本完全一致。
3. 合并公开 PR 后，在 `main` 当前提交创建签名或受保护 tag：

```bash
git tag -s "v<version>" -m "AgentGitOps v<version>"
git push origin "v<version>"
```

4. `Release` workflow 将重新执行全量门禁、真实部署 smoke、npm dry-run，并生成：

   - 五个 npm tarball（CLI 为 `agentgitops-<version>.tgz`）；
   - 独立命名的 Helm Chart `agentgitops-chart-<version>.tgz`；
   - 源码和镜像 SPDX JSON SBOM；
   - `SHA256SUMS`；
   - GHCR 镜像；
   - npm provenance；
   - GitHub Artifact Attestation；
   - GitHub Release。

任何步骤失败都会阻止后续 GitHub Release 创建。npm 多包发布不是原子事务；若在中途失败，不得
覆盖已经发布的版本，应修复后提升 patch/pre-release 版本继续。

## Migrate npm publishing to OIDC

npm Trusted Publisher 只能为已经存在的包配置。因此首个版本使用受控的 `NPM_TOKEN` 完成
bootstrap；五个包都存在后，分别在 npm 包设置中绑定公开仓库
`terrymyth/agentgitops-open`、工作流文件 `release.yml` 和 environment `release`。

完成绑定后：

1. 在候选 tag 上验证工作流能够使用 GitHub OIDC 发布并生成 provenance。
2. 删除工作流中的 `NPM_TOKEN` 强制检查和 environment secret。
3. 撤销 bootstrap token，并保留 npm 与 GitHub 审计记录。
4. 将 P8-009 标记完成；在此之前不得把长期 token 视为最终发布方案。

## Verify as a consumer

```bash
npm install --global "agentgitops@<version>"
agentgitops --version
agentgitops doctor

docker pull "ghcr.io/terrymyth/agentgitops-open:<version>"
gh attestation verify \
  "oci://ghcr.io/terrymyth/agentgitops-open:<version>" \
  --repo terrymyth/agentgitops-open

helm install agentgitops \
  "https://github.com/terrymyth/agentgitops-open/releases/download/v<version>/agentgitops-chart-<version>.tgz"
```

下载 Release assets 后，运行：

```bash
sha256sum --check SHA256SUMS
pnpm validate:release:artifacts -- /path/to/downloaded-release-assets
gh attestation verify <artifact> --repo terrymyth/agentgitops-open
```

## Recovery

- npm：发布新的修复版本；必要时调整 `latest`/`next` dist-tag。
- GHCR：部署上一个已验证 digest，不覆盖原 tag。
- Helm：执行 `helm rollback <release> <revision>`。
- 泄露凭据：立即撤销 token，删除失败 run 中可删除的日志或制品，并按 `SECURITY.md` 处理。
