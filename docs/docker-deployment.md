# Docker 部署指南

> 日期：2026-07-12
> 用途：指导用户使用 Docker 部署 agentgitops

---

## 一、快速开始

### 1.1 Docker Compose（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/terrymyth/agentgitops-open.git
cd agentgitops

# 2. 创建数据目录
mkdir -p data

# 3. 将你的 Git 项目放入 data 目录（或挂载到其他路径）
cd data && git clone https://github.com/your/repo.git my-project && cd ..

# 4. 启动
docker-compose up

# 5. 访问
# Web UI: http://localhost:4789
```

### 1.2 Docker 直接运行

```bash
# 构建镜像
docker build -t agentgitops .

# 运行
docker run -d \
  --name agentgitops \
  -p 4789:4789 \
  -v /path/to/your/project:/workspace \
  -v agentgitops-data:/root/.agentgitops \
  agentgitops

# 访问 http://localhost:4789
```

---

## 二、配置

### 2.1 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENTGITOPS_HOST` | `0.0.0.0` | 监听地址 |
| `AGENTGITOPS_PORT` | `4789` | 监听端口 |
| `AGENTGITOPS_MODE` | `full` | Server 模式（`full` 或 `relay`） |
| `GITHUB_TOKEN` | - | GitHub API token（创建 PR 时需要） |
| `GITLAB_TOKEN` | - | GitLab API token |

### 2.2 挂载卷

| 卷 | 说明 |
|----|------|
| `/workspace` | 你的 Git 项目目录 |
| `/root/.agentgitops` | agentgitops 全局数据（项目注册表等） |

---

## 三、健康检查

```bash
# 检查服务是否正常
curl http://localhost:4789/api/health
```

---

## 四、停止

```bash
# Docker Compose
docker-compose down

# Docker
docker stop agentgitops && docker rm agentgitops
```
