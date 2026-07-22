# Relay 部署指南

> 日期：2026-07-10
> 用途：指导用户在云服务器或内网服务器上部署 Team Sync Relay

---

## 一、Relay 是什么

Relay 是 Team Sync 的中心信号层服务器，负责接收和分发多个 Local Hub 的同步事件。

**关键判断**：Relay 只同步事件摘要（任务元数据、变更文件列表、冲突信号），**不同步代码**。代码仍通过 GitHub/GitLab 的标准 push/pull 同步。

```
Windows 电脑 (Local Hub)  ──┐
                             ├──→ Relay 服务器 ←──┐
Mac 电脑 (Local Hub)     ──┘                     │
                                                │
                          其他同事 (Local Hub) ──┘
```

---

## 二、部署方式

### 2.1 直接运行（最简单）

```bash
# 安装 agentgitops
npm install -g agentgitops

# 初始化一个空目录作为 Relay 数据目录
mkdir /opt/agentgitops-relay
cd /opt/agentgitops-relay
agentgitops init --name relay --force

# 启动 Relay 模式
agentgitops server start --mode relay --host 0.0.0.0 --port 4790
```

### 2.2 Docker 部署

```dockerfile
# Dockerfile.relay
FROM node:22-slim
WORKDIR /app
RUN npm install -g agentgitops
RUN mkdir -p /data && cd /data && agentgitops init --name relay --force
EXPOSE 4790
CMD ["agentgitops", "server", "start", "--mode", "relay", "--host", "0.0.0.0", "--port", "4790"]
```

```bash
# 构建并运行
docker build -f Dockerfile.relay -t agentgitops-relay .
docker run -d --name relay -p 4790:4790 -v relay-data:/data agentgitops-relay
```

### 2.3 Docker Compose 部署

```yaml
# docker-compose.yml
version: "3.8"
services:
  relay:
    build:
      context: .
      dockerfile: Dockerfile.relay
    ports:
      - "4790:4790"
    volumes:
      - relay-data:/data
    restart: unless-stopped
    environment:
      - AGENTGITOPS_TEAM_SECRET=${TEAM_SECRET}

volumes:
  relay-data:
```

```bash
# 启动
echo "TEAM_SECRET=your-secret-here" > .env
docker-compose up -d
```

### 2.4 systemd 部署（Linux 服务器）

```ini
# /etc/systemd/system/agentgitops-relay.service
[Unit]
Description=AgentGitOps Team Sync Relay
After=network.target

[Service]
Type=simple
User=agentgitops
WorkingDirectory=/opt/agentgitops-relay
ExecStart=/usr/bin/agentgitops server start --mode relay --host 0.0.0.0 --port 4790
Restart=always
RestartSec=10
Environment=AGENTGITOPS_TEAM_SECRET=your-secret-here

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable agentgitops-relay
sudo systemctl start agentgitops-relay
```

---

## 三、HTTPS 配置（推荐）

### 3.1 Nginx 反向代理 + Let's Encrypt

```nginx
# /etc/nginx/sites-available/agentgitops-relay
server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4790;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# 申请证书
sudo certbot --nginx -d relay.example.com
```

### 3.2 自签证书（内网测试）

```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=relay.internal"
```

---

## 四、Local Hub 连接 Relay

### 4.1 创建 Team

在第一台机器（如 Windows）上：

```bash
agentgitops team init --name my-team --relay https://relay.example.com --secret your-secret
```

### 4.2 加入 Team

在其他机器（如 Mac、同事电脑）上：

```bash
agentgitops team join --team-id <team-id> --relay https://relay.example.com --secret your-secret
```

### 4.3 同步

```bash
# 上传本地事件到 Relay
agentgitops sync push

# 从 Relay 拉取其他机器的事件
agentgitops sync pull

# 查看团队状态
agentgitops sync status
```

---

## 五、安全注意事项

1. **Team Secret**：不要在代码或日志中暴露；用环境变量 `AGENTGITOPS_TEAM_SECRET` 传递
2. **HTTPS**：生产环境必须用 HTTPS，防止事件摘要被中间人截获
3. **防火墙**：只开放 Relay 端口（4790）给团队成员的 IP
4. **数据备份**：Relay 的 SQLite 数据定期备份（`/data/.agentgitops/db.sqlite`）
5. **不存代码**：Relay 只存事件摘要，不含源码，但仍建议部署在内网或受控环境

---

## 六、故障排查

| 问题 | 排查 |
|------|------|
| `sync push` 报连接超时 | 检查 Relay 是否运行、防火墙是否开放端口 |
| `sync push` 报 401 | 检查 Team Secret 是否一致 |
| `sync push` 报 403 | 检查是否用了 relay 模式（非 sync/team 路由被拒） |
| `sync pull` 无数据 | 检查其他 Hub 是否已 push；检查 teamId 是否一致 |
| Relay 内存增长 | 事件摘要会累积，定期清理已 applied 的事件（后续版本支持） |
