# Kubernetes 部署指南

> 日期：2026-07-12
> 用途：指导用户在 Kubernetes 上部署 agentgitops

---

## 一、Helm Chart 部署（推荐）

### 1.1 安装

```bash
# 添加 agentgitops Helm 仓库（未来）
# helm repo add agentgitops https://charts.agentgitops.dev

# 或从源码部署
cd deploy/helm

# 部署
helm install agentgitops . \
  --set env.GITHUB_TOKEN=$GITHUB_TOKEN

# 查看状态
kubectl get pods -l app.kubernetes.io/name=agentgitops

# 获取服务地址
kubectl get svc agentgitops
```

### 1.2 自定义配置

```bash
# 创建 values 文件
cat > my-values.yaml << EOF
replicaCount: 2
image:
  tag: "0.1.0"
env:
  AGENTGITOPS_HOST: "0.0.0.0"
  AGENTGITOPS_PORT: "4789"
  GITHUB_TOKEN: "your-token"
persistence:
  size: 5Gi
ingress:
  enabled: true
  hosts:
    - host: agentgitops.example.com
      paths:
        - path: /
          pathType: Prefix
EOF

# 部署
helm install agentgitops . -f my-values.yaml
```

### 1.3 升级

```bash
helm upgrade agentgitops . -f my-values.yaml
```

### 1.4 卸载

```bash
helm uninstall agentgitops
```

---

## 二、配置项

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `replicaCount` | 1 | 副本数 |
| `image.repository` | agentgitops/server | 镜像仓库 |
| `image.tag` | 0.1.0 | 镜像版本 |
| `service.port` | 4789 | 服务端口 |
| `persistence.enabled` | true | 是否启用持久化 |
| `persistence.size` | 1Gi | 持久化大小 |
| `env.GITHUB_TOKEN` | - | GitHub token |
| `env.GITLAB_TOKEN` | - | GitLab token |
| `ingress.enabled` | false | 是否启用 Ingress |
| `autoscaling.enabled` | false | 是否启用自动扩缩容 |

---

## 三、访问

### 3.1 端口转发

```bash
kubectl port-forward svc/agentgitops 4789:4789
# 访问 http://localhost:4789
```

### 3.2 Ingress

如果启用了 Ingress，直接访问配置的域名。

---

## 四、持久化

agentgitops 的数据（SQLite、配置、日志）存储在 PersistentVolume 中。

```bash
# 查看 PVC
kubectl get pvc

# 备份数据
kubectl exec -it deployment/agentgitops -- tar czf - /workspace | > backup.tar.gz
```
