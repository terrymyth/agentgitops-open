# CI/CD 集成指南

> 日期：2026-07-12
> 用途：指导用户将 agentgitops 集成到 CI/CD 流水线

---

## 一、GitHub Actions

### 1.1 使用模板

将 [`templates/github-actions-agentgitops.yml`](../templates/github-actions-agentgitops.yml) 复制到你的项目 `.github/workflows/agentgitops-ci.yml`：

```bash
cp templates/github-actions-agentgitops.yml .github/workflows/agentgitops-ci.yml
```

### 1.2 自定义

```yaml
# .github/workflows/agentgitops-ci.yml
name: AgentGitOps CI
on:
  pull_request:
    branches: [main]

jobs:
  agentgitops-verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install -g agentgitops
      - run: agentgitops init --name my-project --force
      - run: agentgitops doctor
      - run: agentgitops test --task ${{ github.head_ref }} || true
      - run: agentgitops package --task ${{ github.head_ref }} || true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: change-package
          path: .agentgitops/packages/
```

---

## 二、GitLab CI

### 2.1 使用模板

将 [`templates/gitlab-ci-agentgitops.yml`](../templates/gitlab-ci-agentgitops.yml) 的内容复制到你的 `.gitlab-ci.yml`：

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/agentgitops/agentgitops/main/templates/gitlab-ci-agentgitops.yml'
```

或直接复制内容。

---

## 三、验证项

CI 集成后，每次 PR/MR 会自动：

1. 初始化 agentgitops 项目
2. 运行 `doctor` 检查环境
3. 运行 `test` 执行验证检查
4. 运行 `package` 生成 Change Package
5. 上传 Change Package 作为 artifact

---

## 四、安全注意事项

1. **不要在 CI 中创建真实 PR**：CI 中只做验证，不创建 PR
2. **Token 安全**：使用 CI secrets 引用 token，不要硬编码
3. **权限最小化**：CI 中的 agentgitops 只需要读权限
