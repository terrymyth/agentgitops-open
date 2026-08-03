# Phase 8：Release Closure

> 启动日期：2026-07-23<br>
> 状态：进行中<br>
> 事实源：本文档和 [`v1-release-standard.md`](./v1-release-standard.md)

Phase 8 不增加新的功能面。它把已经实现的能力收口为可安装、可部署、可验证、可追溯、
可恢复的公开发行版，并固化私有研发仓库到公开发行仓库的安全交付链。

## 1. 完成定义

只有同时满足以下条件，Phase 8 才能标记完成：

1. 私有仓库变更通过私有 PR 合并，公开安全部分通过独立公开 PR 合并。
2. 五个 npm 包（含 CLI）、Helm Chart 和 Git tag 使用同一个 SemVer。
3. 空缓存 npm 安装、Docker 真实启动、Compose 配置、Helm lint/template 全部通过。
4. 公开 tag 自动产生 npm provenance、GHCR 镜像、源码与镜像 SBOM、SHA-256 校验和和
   GitHub Artifact Attestation。
5. 公开 `main` 三平台 required checks 全绿，发布工作流只允许在
   `terrymyth/agentgitops-open` 执行。
6. Release Notes 包含安装方式、破坏性变更、已知限制、验证命令和恢复方式。
7. 发布后从 npm、GHCR 和 Helm Chart 各执行一次消费者视角验证。

## 2. 任务清单

| 编号   | 任务                       | 状态   | 验收证据                                            |
| ------ | -------------------------- | ------ | --------------------------------------------------- |
| P8-001 | 双仓与版本事实源收口       | 已完成       | 双仓 PR 链、独立历史和版本元数据门禁已验证                         |
| P8-002 | npm 发布保护与 provenance  | 自动化完成   | 仅公开仓库 `main` 的匹配 tag 可真发布；待 P8-007 实发验证          |
| P8-003 | GHCR 镜像发布与健康检查    | 启动验证完成 | Release run `30857307421` 真实构建、启动并通过 `/api/health`       |
| P8-004 | Helm lint/template/package | 已完成       | lint/template、6 归档唯一性、Ingress/Secret/health hook 已验证     |
| P8-005 | SBOM、校验和与制品证明     | 源码侧完成   | 8 个 main 制品通过 SHA-256 和 attestation；镜像侧待 tag            |
| P8-006 | 依赖升级审查               | 已完成       | 三项新增供应链公告已修复，完整 audit 为 0；CI 阻断 high/critical   |
| P8-007 | 正式候选版本发布           | 外部待办     | 需要发布版本决策、npm bootstrap 权限和三端消费者验证               |
| P8-008 | 目标 Kubernetes 集群 smoke | 自动化就绪   | 受保护 environment/workflow 已配置；待 kubeconfig、namespace 和镜像 |
| P8-009 | npm OIDC 可信发布迁移      | 外部待办     | 首次发布后配置 Trusted Publisher 并撤销 bootstrap token            |

## 3. 2026-08-03 远程证据

- 公开 `main` 三平台 CI：run `30853846219`；Linux、macOS、Windows 全绿。
- 非标签 Release：run `30857307421`；真实 Docker/Compose/Helm、npm dry-run、源 SBOM、
  SHA-256、Artifact upload 和 attestation 全绿。
- 下载后独立验证：五个 npm 包与 `agentgitops-chart-0.1.0.tgz` 共六个唯一归档均存在；
  `SHA256SUMS` 覆盖七个内容制品，连同校验文件共八个文件均通过限定公开 `main` 和
  `release.yml` 的 `gh attestation verify`。
- 非标签运行按设计跳过 GHCR push、镜像 SBOM/attestation、npm publish 和 GitHub Release，
  因而不能替代 P8-007 的正式候选版本验证。
- v1 Helm 明确阻断多副本：本地工作区和 ReadWriteOnce PVC 尚不具备并发写入一致性，不能用
  HPA 或 `replicaCount > 1` 伪装成已支持水平扩展。
- GitHub `kubernetes-smoke` environment 已限制为受保护分支并要求 reviewer；截至本快照未配置
  `KUBE_CONFIG_DATA`、`KUBE_NAMESPACE` 或 `KUBE_CONTEXT`，因此未伪造目标集群运行结果。

## 4. 发布顺序

```text
私有功能分支
  → 私有 PR / CI / 审查
  → 私有 main
  → 公开安全补丁或 clean cherry-pick
  → 公开 PR / CI / ruleset
  → 公开 main
  → 版本 tag
  → Release workflow
  → npm + GHCR + Helm + SBOM + Attestation
  → 消费者验证
```

禁止从私有仓库创建公开 tag、发布 npm 包或推送 GHCR 正式镜像。

## 5. 阻断条件

- 版本不一致、tag 不匹配或 npm 元数据指向私有仓库。
- 公开历史卫生检查失败。
- Docker 只能构建但不能启动。
- Helm 只能静态存在但不能 lint/template。
- npm、镜像或 Release asset 缺少校验和、SBOM 或 provenance。
- 发布凭据缺失、权限过大、写入日志，或发布来源不是公开仓库。
- npm 包已具备 Trusted Publisher 条件但仍长期依赖可复用写 token。
- 依赖重大版本升级未通过完整测试和迁移审查。

## 6. 回滚策略

- npm 已发布版本不可覆盖；发现问题后发布修复版本，必要时通过 dist-tag 撤下默认推荐。
- GHCR 镜像按不可变 digest 使用；回滚到上一个已验证 digest，不复用已发布 tag。
- Helm 使用 `helm rollback` 回到上一个 release revision。
- GitHub Release 可标记为 pre-release 或撤下，但不得重写对应 Git tag 的历史。
