# 에이전트 프로비저닝 레퍼런스

> 각 AI 코딩 에이전트의 설치, 설정 파일, approval-free 구성 방법을 정리.
> Lima provision 스크립트에 들어갈 내용의 기초 자료.

---

## 1. Claude Code

### 설치

```bash
# Node.js 필요 (snap 또는 nvm)
sudo snap install node --classic
npm install -g @anthropic-ai/claude-code
```

바이너리: `claude`

### 인증

| 방법 | 설명 |
|------|------|
| OAuth (기본) | 최초 실행 시 브라우저 인증 → `~/.claude/.credentials.json` 저장 |
| API 키 | 환경변수 `ANTHROPIC_API_KEY` |
| OAuth 토큰 직접 주입 | 환경변수 `CLAUDE_CODE_OAUTH_TOKEN` |

**OAuth 토큰 주입 시 주의:** 인터랙티브 모드에서는 `~/.claude/.credentials.json`에 토큰을 기록하고, `~/.claude.json`에 `hasCompletedOnboarding: true`를 설정해야 onboarding 화면을 건너뜀. (관련: https://github.com/anthropics/claude-code/issues/8938)

### 설정 파일

| 스코프 | 경로 | 용도 |
|--------|------|------|
| Managed | `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS) | IT 관리 (최우선) |
| User | `~/.claude/settings.json` | 전역 사용자 설정 |
| Project | `.claude/settings.json` | 프로젝트 공유 설정 (git commit) |
| Local | `.claude/settings.local.json` | 개인 프로젝트 설정 (gitignored) |

**우선순위:** Managed > CLI args > Local > Project > User

### Approval-free 설정

#### 방법 1: CLI 플래그

```bash
claude --dangerously-skip-permissions
```

#### 방법 2: 설정 파일 (`~/.claude/settings.json`)

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions",
    "allow": [
      "Bash",
      "Edit",
      "MultiEdit",
      "Write",
      "Read",
      "Glob",
      "Grep",
      "WebFetch"
    ]
  }
}
```

`defaultMode` 옵션:
- `"acceptEdits"` (기본) - 편집은 자동 승인, 나머지 프롬프트
- `"askPermissions"` - 모든 동작에 프롬프트
- `"bypassPermissions"` - 모든 권한 검사 건너뜀

#### 방법 3: 세밀한 권한 제어

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(git *)",
      "Edit(./src/**)",
      "Read"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Read(./.env)"
    ],
    "ask": [
      "Bash(git push *)"
    ]
  }
}
```

평가 순서: deny > ask > allow (먼저 매칭되는 규칙 적용)

### agentbox에서의 활용

Lima VM은 격리 환경이므로 `bypassPermissions`를 안전하게 사용할 수 있다.

**Provision 스크립트 예시:**

```yaml
provision:
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      snap install node --classic
      npm install -g @anthropic-ai/claude-code

  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail
      mkdir -p ~/.claude
      cat > ~/.claude/settings.json << 'SETTINGS'
      {
        "permissions": {
          "defaultMode": "bypassPermissions",
          "allow": ["Bash", "Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "WebFetch"]
        }
      }
      SETTINGS
```

---

## 2. Codex

### 설치

```bash
# Node.js 필요
sudo snap install node --classic
npm install -g @openai/codex
```

바이너리: `codex`

### 인증

| 방법 | 설명 |
|------|------|
| API 키 | 환경변수 `OPENAI_API_KEY` |
| 자격증명 파일 | `~/.codex/auth.json` |

### 설정 파일

| 스코프 | 경로 | 용도 |
|--------|------|------|
| User | `~/.codex/config.toml` | 전역 사용자 설정 |
| Project | `.codex/config.toml` | 프로젝트별 설정 |
| Admin | `requirements.toml` | 관리자 제약 (강제) |

### Approval-free 설정

#### CLI 플래그

```bash
# 방법 1: full-auto (on-request + workspace-write)
codex --full-auto

# 방법 2: 완전 자동 (never + danger-full-access)
codex --ask-for-approval never --sandbox danger-full-access

# 방법 3: 모든 안전장치 비활성화
codex --dangerously-bypass-approvals-and-sandbox
```

#### 설정 파일 (`~/.codex/config.toml`)

```toml
# 승인 정책
# untrusted: 안전한 read-only 명령만 자동, 나머지 프롬프트
# on-failure: 샌드박스에서 자동 실행, 실패 시만 프롬프트
# on-request: 모델이 판단 (기본)
# never: 프롬프트 안 함 (위험)
approval_policy = "never"

# 샌드박스 모드
# read-only: 최소 접근 (기본)
# workspace-write: 프로젝트 디렉토리 쓰기 허용
# danger-full-access: 제한 없음 (위험)
sandbox_mode = "danger-full-access"
```

**`--full-auto` vs config.toml:**
- `--full-auto`는 `approval_policy = "on-request"` + `sandbox_mode = "workspace-write"`의 단축.
- Lima VM 격리 환경에서는 `approval_policy = "never"` + `sandbox_mode = "danger-full-access"`가 적합.

### agentbox에서의 활용

```yaml
provision:
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      snap install node --classic
      npm install -g @openai/codex

  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail
      mkdir -p ~/.codex
      cat > ~/.codex/config.toml << 'CONFIG'
      approval_policy = "never"
      sandbox_mode = "danger-full-access"
      CONFIG
```

---

## 3. Gemini CLI

### 설치

```bash
sudo snap install node --classic
npm install -g @google/gemini-cli
```

바이너리: `gemini`

### 인증

| 방법 | 설명 |
|------|------|
| OAuth (기본) | 최초 실행 시 브라우저 인증 → `~/.gemini/oauth_creds.json` |
| API 키 | 환경변수 `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY` |

**OAuth 관련 파일 (모두 `~/.gemini/`):**
- `oauth_creds.json` — OAuth 토큰
- `google_account_id` — 계정 ID
- `google_accounts.json` — 계정 목록
- `settings.json` — 사용자 설정

### 설정 파일

| 스코프 | 경로 | 용도 |
|--------|------|------|
| System defaults | `/Library/Application Support/GeminiCli/system-defaults.json` (macOS) | 시스템 기본값 |
| User | `~/.gemini/settings.json` | 전역 사용자 설정 |
| Project | `.gemini/settings.json` | 프로젝트별 설정 |
| System (최우선) | `/Library/Application Support/GeminiCli/settings.json` (macOS) | 관리자 강제 |

**우선순위:** Default < System defaults < User < Project < System < Env vars < CLI args

### Approval-free 설정 (YOLO 모드)

#### CLI 플래그

```bash
# 방법 1: YOLO 모드 (deprecated)
gemini --yolo

# 방법 2: approval-mode (권장)
gemini --approval-mode=yolo

# 방법 3: 자동 편집만
gemini --approval-mode=auto_edit
```

`--yolo` / `--approval-mode=yolo` 사용 시 **샌드박스가 자동 활성화**된다.
- 기본적으로 `gemini-cli-sandbox` Docker 이미지 사용
- 프로젝트별 커스텀: `.gemini/sandbox.Dockerfile`
- Lima VM 안에서는 Docker 없이 YOLO를 사용하고 싶을 수 있음 → 아래 참조

#### 설정 파일 (`~/.gemini/settings.json`)

```json
{
  "tools": {
    "approvalMode": "auto_edit"
  }
}
```

`approvalMode` 옵션:
- `"default"` — 매번 승인 프롬프트
- `"auto_edit"` — 편집 도구 자동 승인, 나머지 프롬프트
- `"plan"` — 읽기 전용 (실행 안 함)

**참고:** settings.json에서 `"yolo"` 값은 아직 지원되지 않는다. CLI 플래그로만 가능.

#### YOLO + 샌드박스 없이 사용

Lima VM 안에서는 이미 격리되어 있으므로 Gemini의 자체 샌드박스는 불필요하다.
YOLO 모드의 자동 샌드박스를 비활성화하려면:

```bash
# 샌드박스 없이 YOLO
gemini --approval-mode=yolo --no-sandbox
```

또는 `security.disableYoloMode: false` (기본값)를 확인. 이 값이 `true`이면 YOLO 자체가 비활성화된다.

### agentbox에서의 활용

```yaml
provision:
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      snap install node --classic
      npm install -g @google/gemini-cli

  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail
      mkdir -p ~/.gemini
      cat > ~/.gemini/settings.json << 'SETTINGS'
      {
        "tools": {
          "approvalMode": "auto_edit"
        }
      }
      SETTINGS
```

**런타임 실행 시:**
```bash
gemini --approval-mode=yolo --no-sandbox
```

---

## 4. Kiro CLI

### 설치

Kiro CLI는 npm이 아닌 **전용 설치 스크립트**로 설치한다.

```bash
# 범용 설치 (macOS/Linux)
curl -fsSL https://cli.kiro.dev/install | bash

# ARM Linux (수동)
curl --proto '=https' --tlsv1.2 -sSf \
  'https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-aarch64-linux.zip' \
  -o kirocli.zip
unzip kirocli.zip && bash ./kirocli/install.sh
```

바이너리: `kiro-cli`

### 인증

최초 실행 시 `kiro-cli login`으로 인증. 토큰은 SQLite DB에 저장:
- macOS: `~/Library/Application Support/kiro-cli/data.sqlite3`
- Linux: `~/.local/share/kiro-cli/data.sqlite3`

### 설정 파일

| 스코프 | 경로 | 용도 |
|--------|------|------|
| Global | `~/.kiro/settings.json` (macOS) 또는 `~/.config/kiro/settings.json` (Linux) | 전역 설정 |
| Project | `<project>/.kiro/` | 프로젝트별 설정 |
| Agents | `~/.kiro/agents/` 또는 `<project>/.kiro/agents/` | 커스텀 에이전트 |
| MCP | `~/.kiro/settings/mcp.json` | MCP 서버 설정 |

### Approval-free 설정

#### CLI 플래그

```bash
# 모든 도구 자동 승인 + 비대화형
kiro-cli chat --trust-all-tools --no-interactive
```

| 플래그 | 설명 |
|--------|------|
| `--trust-all-tools` | 모든 도구를 확인 없이 실행 |
| `--no-interactive` | 비대화형 모드 (첫 응답만 stdout에 출력) |

#### 세션 내 명령

```
/tools trust-all       # 모든 도구 신뢰 (세션 내)
/tools trust shell     # 특정 도구만 신뢰
/tools trust read
/tools trust write
```

#### 커스텀 에이전트 설정 (영구 도구 허용)

```json
{
  "name": "agentbox-agent",
  "description": "Full-access agent for Lima VM",
  "tools": ["*"],
  "allowedTools": [
    "@builtin",
    "read",
    "write",
    "shell"
  ]
}
```

**참고:** `allowedTools`에는 `"*"` 와일드카드가 **지원되지 않는다**. 개별 도구 또는 `@builtin`, `@server_name` 패턴으로 지정해야 한다.

#### 기본 도구 신뢰 상태

| 도구 | 기본 | 설명 |
|------|------|------|
| `read` | 신뢰됨 | 파일/디렉토리 읽기 |
| `write` | 미신뢰 | 파일 생성/수정 |
| `shell` | 미신뢰 | bash 명령 실행 |
| `aws` | 미신뢰 | AWS CLI |
| `report` | 미신뢰 | 버그 리포트 |

### agentbox에서의 활용

Kiro CLI는 설정 파일로 영구적인 전체 도구 신뢰를 설정하기 어렵다 (커스텀 에이전트 `allowedTools`가 `*` 미지원). CLI 플래그 `--trust-all-tools`가 가장 확실한 방법.

```yaml
provision:
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      apt-get update && apt-get install -y curl unzip
      curl -fsSL https://cli.kiro.dev/install | bash

  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail
      mkdir -p ~/.kiro/agents
      cat > ~/.kiro/agents/agentbox.json << 'AGENT'
      {
        "name": "agentbox",
        "description": "Full-access agent for agentbox Lima VM",
        "tools": ["*"],
        "allowedTools": ["@builtin", "read", "write", "shell"]
      }
      AGENT
```

**런타임 실행 시:**
```bash
kiro-cli chat --trust-all-tools
```

---

## 5. GitHub Copilot CLI

### 설치

```bash
# npm
npm install -g @github/copilot

# Homebrew (macOS/Linux)
brew install copilot-cli

# 스크립트 설치 (macOS/Linux)
curl -fsSL https://gh.io/copilot-install | bash
```

바이너리: `copilot`

### 인증

| 방법 | 설명 |
|------|------|
| 대화형 | `/login` 명령으로 GitHub 인증 |
| PAT | Fine-grained PAT ("Copilot Requests" 권한) |
| 환경변수 | `GH_TOKEN` 또는 `GITHUB_TOKEN` |

### 설정 파일

| 스코프 | 경로 | 용도 |
|--------|------|------|
| User config | `~/.copilot/config` (JSON) | 전역 설정 |
| MCP config | `~/.copilot/mcp-config.json` | MCP 서버 설정 |
| Agents | `~/.copilot/agents/` | 커스텀 에이전트 |
| Repo instructions | `.github/copilot-instructions.md` | 프로젝트 지시 |
| Repo agents | `.github/agents/` | 프로젝트 에이전트 |

`XDG_CONFIG_HOME` 환경변수로 `~/.copilot` 위치를 변경할 수 있다.

### Approval-free 설정

#### CLI 플래그

```bash
# 모든 권한 허용 (YOLO 모드)
copilot --allow-all
# 또는
copilot --yolo

# 개별 도구 허용
copilot --allow-tool shell --allow-tool write

# 경로 제한 해제
copilot --allow-all-paths

# URL 제한 해제
copilot --allow-all-urls

# 특정 도메인 허용
copilot --allow-url github.com --allow-url npmjs.org
```

| 플래그 | 설명 |
|--------|------|
| `--allow-all` / `--yolo` | 모든 권한 허용 |
| `--allow-tool <name>` | 특정 도구 자동 승인 (shell, write 등) |
| `--allow-all-paths` | 경로 검증 비활성화 |
| `--allow-all-urls` | URL 검증 비활성화 |
| `--allow-url <domain>` | 특정 도메인 허용 |
| `--experimental` | 실험적 기능 활성화 (autopilot 모드 포함) |

#### Autopilot 모드

실험적 기능. `Shift+Tab`으로 모드 전환하여 에이전트가 작업 완료까지 자율적으로 동작.
`--experimental` 플래그 또는 `/experimental` 슬래시 명령으로 활성화.

#### 설정 파일 (`~/.copilot/config`)

```json
{
  "log_level": "default",
  "show_banner": true
}
```

**참고:** Copilot CLI의 config 파일에는 도구 자동 승인 관련 영구 설정 필드가 제한적이다. `--allow-all` 등은 CLI 플래그로 전달하는 것이 가장 확실하다.

### agentbox에서의 활용

```yaml
provision:
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      snap install node --classic
      npm install -g @github/copilot

  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail
      mkdir -p ~/.copilot
```

**런타임 실행 시:**
```bash
copilot --yolo --experimental
```

---

## 6. Docker (Lima VM 내부 설치)

### 설치 방법

Lima VM (Ubuntu) 안에서 Docker를 사용하는 두 가지 방법:

#### 방법 1: docker.io 패키지 (간편, 약간 구버전)

```bash
apt-get update
apt-get install -y docker.io
```

#### 방법 2: Docker CE 공식 저장소 (최신 버전)

```bash
# 의존성
apt-get update
apt-get install -y ca-certificates curl gnupg

# Docker GPG 키
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Docker 저장소 추가
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# 설치
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### docker 그룹 권한

기본적으로 Docker 데몬은 root 소켓(`/var/run/docker.sock`)을 사용한다. 일반 사용자가 sudo 없이 Docker를 쓰려면:

```bash
# docker 그룹에 사용자 추가
sudo usermod -aG docker $USER

# 그룹 변경 적용 (재로그인 또는)
newgrp docker
```

**보안 참고:** docker 그룹에 추가하면 사실상 root 수준 접근 권한을 부여하는 것이다. Lima VM 격리 환경에서는 문제 없음.

### Lima VM에서의 Docker 특이사항

Lima VM은 일반 VM이므로 Docker가 **네이티브로 동작**한다. Docker Sandbox와 달리 Docker-in-Docker가 아니며, VM 안에서 컨테이너를 자유롭게 실행할 수 있다. 이는 Testcontainers 등 컨테이너 기반 테스트를 정상적으로 실행할 수 있음을 의미한다.

### Provision 스크립트 예시

```yaml
provision:
  # Docker CE 설치 (system)
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      export DEBIAN_FRONTEND=noninteractive

      # Docker 공식 저장소
      apt-get update
      apt-get install -y ca-certificates curl gnupg
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
        https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list

      # 설치
      apt-get update
      apt-get install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

      # 기본 사용자를 docker 그룹에 추가
      usermod -aG docker "${LIMA_CIDATA_USER:-$(id -un 1000)}"

      # Docker 시작
      systemctl enable docker
      systemctl start docker
```

`LIMA_CIDATA_USER` 환경변수는 Lima가 cloud-init에서 제공하는 게스트 사용자 이름이다.

---

## 7. 통합 Provision 스크립트 예시

아래는 모든 에이전트를 한 번에 설치하는 완전한 Lima YAML provision 블록이다.

```yaml
provision:
  #--------------------------------------------------
  # Phase 1: 시스템 패키지 (root)
  #--------------------------------------------------
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      export DEBIAN_FRONTEND=noninteractive

      # 기본 도구
      apt-get update
      apt-get install -y curl git build-essential unzip jq

      # Node.js (snap)
      snap install node --classic

      # gh CLI
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
        https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list
      apt-get update
      apt-get install -y gh

      # Docker CE
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
        https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update
      apt-get install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

      # docker 그룹에 사용자 추가
      usermod -aG docker "${LIMA_CIDATA_USER:-$(id -un 1000)}"
      systemctl enable docker
      systemctl start docker

  #--------------------------------------------------
  # Phase 2: Kiro CLI (시스템 — curl 설치 스크립트)
  #--------------------------------------------------
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      curl -fsSL https://cli.kiro.dev/install | bash

  #--------------------------------------------------
  # Phase 3: 에이전트 CLI 설치 (사용자)
  #--------------------------------------------------
  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail

      # npm 글로벌 에이전트 설치
      npm install -g @anthropic-ai/claude-code
      npm install -g @openai/codex
      npm install -g @google/gemini-cli
      npm install -g @github/copilot

  #--------------------------------------------------
  # Phase 4: Approval-free 설정 (사용자)
  #--------------------------------------------------
  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail

      # Claude Code — bypassPermissions
      mkdir -p ~/.claude
      cat > ~/.claude/settings.json << 'EOF'
      {
        "permissions": {
          "defaultMode": "bypassPermissions",
          "allow": ["Bash", "Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "WebFetch"]
        }
      }
      EOF

      # Codex — approval_policy=never, sandbox_mode=danger-full-access
      mkdir -p ~/.codex
      cat > ~/.codex/config.toml << 'EOF'
      approval_policy = "never"
      sandbox_mode = "danger-full-access"
      EOF

      # Gemini — auto_edit (yolo는 settings.json 미지원, CLI 플래그로)
      mkdir -p ~/.gemini
      cat > ~/.gemini/settings.json << 'EOF'
      {
        "tools": {
          "approvalMode": "auto_edit"
        }
      }
      EOF

      # Kiro — 커스텀 에이전트 (allowedTools)
      mkdir -p ~/.kiro/agents
      cat > ~/.kiro/agents/agentbox.json << 'EOF'
      {
        "name": "agentbox",
        "description": "Full-access agent for agentbox Lima VM",
        "tools": ["*"],
        "allowedTools": ["@builtin", "read", "write", "shell"]
      }
      EOF

      # Copilot — 설정 디렉토리 준비 (approval은 CLI 플래그로)
      mkdir -p ~/.copilot
```

---

## 8. 에이전트별 defaultArgs 매핑

agentbox가 에이전트 실행 시 자동으로 추가하는 CLI 플래그:

| 에이전트 | 현재 defaultArgs | Lima 전환 후 (예상) |
|----------|-----------------|-------------------|
| Claude | `--dangerously-skip-permissions` | 동일 (또는 settings.json으로 대체하면 불필요) |
| Codex | `--approval-mode full-auto` | `--ask-for-approval never --sandbox danger-full-access` (또는 config.toml로 대체하면 불필요) |
| Kiro | `chat --trust-all-tools` | 동일 |
| Gemini | `-y` | `--approval-mode=yolo --no-sandbox` |
| Copilot | (없음) | `--yolo` 또는 `--allow-all` |

**설정 파일 vs CLI 플래그:**
- 설정 파일로 approval-free를 구성하면 defaultArgs에서 해당 플래그를 제거할 수 있다.
- 설정 파일이 VM에 마운트되거나 provision으로 생성되므로, CLI 플래그 없이도 approval-free 동작.
- 단, Gemini의 yolo 모드와 Copilot의 --yolo는 설정 파일로 완전히 대체 불가 → CLI 플래그 유지 필요.

---

## 9. 인증 파일 요약 (마운트 대상)

Lima에서 read-only 마운트할 credential 파일/디렉토리:

| 에이전트 | 호스트 경로 | 설명 |
|----------|------------|------|
| Claude | `~/.claude/` | `.credentials.json` 포함 |
| Codex | `~/.codex/` | `auth.json`, `config.toml` |
| Gemini | `~/.gemini/` | `oauth_creds.json`, `settings.json`, `google_account_id`, `google_accounts.json` |
| Kiro | `~/Library/Application Support/kiro-cli/` (macOS) | `data.sqlite3` (인증 토큰 DB) |
| Copilot | `~/.copilot/` | `config`, 세션 상태 |
| GitHub | `~/.config/gh/` | `gh auth` 토큰 |
| Git | `~/.gitconfig` | git 전역 설정 |
| 범용 | `~/.netrc` | API 인증 토큰 |

**Kiro 주의:** macOS 호스트 경로(`~/Library/Application Support/kiro-cli/`)와 Linux 게스트 경로(`~/.local/share/kiro-cli/`)가 다르다. mountPoint를 다르게 지정하거나 `limactl copy`로 복사해야 한다.

---

## 참고 자료

- Claude Code 설정: https://code.claude.com/docs/en/settings
- Codex 설정 레퍼런스: https://developers.openai.com/codex/config-reference/
- Codex CLI 레퍼런스: https://developers.openai.com/codex/cli/reference/
- Gemini CLI 설정: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/configuration.md
- Kiro CLI 명령어: https://kiro.dev/docs/cli/reference/cli-commands/
- Kiro 권한 관리: https://kiro.dev/docs/cli/chat/permissions/
- Kiro 에이전트 설정: https://kiro.dev/docs/cli/custom-agents/configuration-reference/
- GitHub Copilot CLI: https://github.com/github/copilot-cli
- GitHub Copilot CLI 사용법: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli
- Docker Ubuntu 설치: https://docs.docker.com/engine/install/ubuntu/
