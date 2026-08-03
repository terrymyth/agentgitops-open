# Kubernetes 部署指南

> 更新日期：2026-08-03<br>
> 适用范围：公开 Release 的 GHCR 镜像与 `agentgitops-chart-<version>.tgz`

## 前置条件

- Kubernetes 集群与当前 `kubectl` 相差不超过一个 minor 版本；
- Helm 4.2.3 或兼容版本；
- 集群能够拉取 `ghcr.io/terrymyth/agentgitops-open:<version>`；
- 已下载同一版本的 Helm Chart，并完成 SHA-256 与 attestation 验证；
- provider token 等凭据已存放在 Kubernetes Secret 或外部 Secret Manager 中。

不要把 token 写入 values 文件、`--set env.*` 参数、Git 历史或 CI 日志。

## 安全准备

以下示例从受限文件创建 Secret，文件内容是 token 本身。生产环境优先使用 External Secrets、
Secrets Store CSI Driver 或平台自带密钥服务。

```bash
kubectl create namespace agentgitops
kubectl create secret generic agentgitops-provider-credentials \
  --namespace agentgitops \
  --from-file=GITHUB_TOKEN=/secure/path/github-token \
  --from-file=GITLAB_TOKEN=/secure/path/gitlab-token
```

Secret 的键会通过 `envFrom.secretRef` 注入容器；Helm 不读取或复制 Secret 内容。

## 安装

先验证从 GitHub Release 下载的制品：

```bash
sha256sum --check SHA256SUMS
gh attestation verify "agentgitops-chart-<version>.tgz" \
  --repo terrymyth/agentgitops-open
```

创建不含凭据的 `values-production.yaml`：

```yaml
image:
  tag: "<version>"

existingSecret: agentgitops-provider-credentials

persistence:
  enabled: true
  size: 5Gi

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: agentgitops.example.com
      paths:
        - path: /
          pathType: Prefix
```

安装并等待 readiness probe：

```bash
helm upgrade --install agentgitops "./agentgitops-chart-<version>.tgz" \
  --namespace agentgitops \
  --values values-production.yaml \
  --wait \
  --timeout 5m

kubectl rollout status deployment/agentgitops \
  --namespace agentgitops \
  --timeout 3m

helm test agentgitops --namespace agentgitops --logs
```

## 关键参数

| 参数                                          | 默认值                                      | 说明                               |
| --------------------------------------------- | ------------------------------------------- | ---------------------------------- |
| `image.repository`                            | `ghcr.io/terrymyth/agentgitops-open`        | 公开镜像仓库                       |
| `image.tag`                                   | 与 Chart 相同的 SemVer                      | 镜像版本                           |
| `imagePullSecrets`                            | `[]`                                        | 私有镜像仓库拉取凭据引用           |
| `existingSecret`                              | `""`                                       | 注入为容器环境变量的现有 Secret    |
| `service.port`                                | `4789`                                      | Service 端口                       |
| `persistence.enabled` / `size`                | `true` / `1Gi`                              | PVC 开关与容量                     |
| `ingress.enabled` / `className`               | `false` / `""`                             | Ingress 开关与控制器               |
| `nodeSelector` / `tolerations` / `affinity`   | 空                                          | Pod 调度约束                       |
| `livenessProbe` / `readinessProbe`            | `/api/health`                               | 存活与就绪探针                     |

`env` 只用于非敏感运行参数；凭据必须通过 `existingSecret` 或工作负载身份注入。

v1 强制 `replicaCount: 1`。当前本地工作区状态和默认 ReadWriteOnce PVC 不具备多副本一致性；
Helm 会拒绝更大的副本数。水平扩展必须在共享存储、会话一致性和并发写入策略完成后另行设计。

## 升级、持久性与回滚

```bash
helm upgrade agentgitops "./agentgitops-chart-<new-version>.tgz" \
  --namespace agentgitops \
  --values values-production.yaml \
  --wait \
  --timeout 5m

helm history agentgitops --namespace agentgitops
helm rollback agentgitops <revision> \
  --namespace agentgitops \
  --wait \
  --timeout 5m
```

升级与回滚后都应重新执行 `kubectl rollout status`、`helm test`，并确认 PVC 为 `Bound`、
已有工作区数据仍可读取。卸载 release 默认不会删除 PVC；是否保留或删除数据必须由运维人员显式决定。

## 受保护的目标集群 smoke

公开仓库提供手动 `Kubernetes Smoke` workflow，在预先创建的专用 smoke namespace 中执行：

1. 安装已发布 GHCR SemVer 镜像；
2. 等待 Deployment 和探针，通过 Helm health test；
3. 确认 PVC 绑定并写入持久化标记；
4. 执行一次 Helm upgrade，确认数据仍存在；
5. 回滚到 revision 1，再次验证健康和数据；
6. 无论成功或失败都卸载唯一 release，并删除该 release 的 PVC。

在 GitHub `kubernetes-smoke` environment 中配置：

- Secret `KUBE_CONFIG_DATA`：目标 kubeconfig 的单行 base64；
- 可选 Variable `KUBE_CONTEXT`：要使用的 context；
- Variable `KUBE_NAMESPACE`：预先创建、名称以 `agentgitops-smoke` 开头的专用 namespace；
- Required reviewer 和仅允许受保护 `main` 的部署分支策略。

`KUBE_CONFIG_DATA` 应使用只对该 namespace 授权的最小权限 ServiceAccount，不应授予集群管理员
权限。workflow 只接受不带前缀 `v` 的已发布 SemVer 镜像 tag。没有目标集群凭据或对应 GHCR
镜像时，P8-008 仍保持“自动化就绪、外部验证待完成”。
