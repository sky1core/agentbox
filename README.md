# @sky1core/agentbox

Docker Sandbox 통합 런처. AI 코딩 에이전트(Codex, Claude, Kiro, Gemini, Copilot, Cagent)를 격리된 microVM에서 실행한다.

## 주요 기능

- **통합 CLI**: `agentbox codex`, `agentbox claude` 한 줄로 sandbox 생성부터 에이전트 실행까지
- **자격증명 자동 주입**: Codex, Claude, Kiro, Gemini, GitHub 인증을 호스트에서 sandbox로 자동 복사
- **승인 없이 자율 동작**: 격리된 microVM이므로 에이전트에게 무제한 권한 부여 가능
- **readonly-remote**: sandbox에서 git push, PR merge 등 원격 쓰기를 기본 차단 (프로젝트별 해제 가능)
- **bootstrap 스크립트**: sandbox 생성/시작 시 MCP 서버 빌드, 패키지 설치 등 자동 실행
- **Docker-in-Docker**: 일반 Docker 컨테이너와 달리 microVM 내부에서 컨테이너 실행 가능 (Testcontainers 등)

## 요구사항

- **Docker Desktop 4.50+** (docker sandbox 기능 필요)
- Node.js 18+

## 설치

```bash
npm install -g @sky1core/agentbox
```

또는 로컬에서 빌드:

```bash
git clone <repo-url> ~/work/ai-sandbox
cd ~/work/ai-sandbox
npm install && npm run build
npm link
```

## 사용법

프로젝트 디렉토리에서 실행. `agentbox.yml`이 없으면 `$PWD`를 workspace로 사용한다.

```bash
cd ~/work/my-project

# Codex
agentbox codex                  # 인터랙티브
agentbox codex resume           # 이전 대화 이어가기
agentbox codex exec "프롬프트"    # 1회 실행
agentbox codex review           # 코드 리뷰

# Claude
agentbox claude                 # 인터랙티브
agentbox claude continue        # 이전 대화 이어가기
agentbox claude prompt "프롬프트"  # 1회 실행

# Kiro / Gemini / Copilot / Cagent
agentbox kiro
agentbox gemini
agentbox copilot
agentbox cagent

# 공통
agentbox ls                     # 전체 sandbox 목록
agentbox codex shell            # bash 쉘
agentbox codex ls               # sandbox 목록
agentbox codex stop             # 정지
```

## 설정

### 글로벌: `~/.config/agentbox/config.yml`

모든 프로젝트에 적용되는 기본 설정.

```yaml
sync:
  files:
    - ~/.netrc
    - ~/.gitconfig

defaults:
  startupWaitSec: 5

env:
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."   # Claude Code 인증 토큰

agents:
  codex:
    execMode: exec     # exec(독립 바이너리) vs run(엔트리포인트)
    binary: codex
    model: o3          # 기본 모델 지정
  claude:
    execMode: run
    model: sonnet
  gemini:
    execMode: exec
    binary: gemini
```

### 로컬: `agentbox.yml` (프로젝트 루트)

프로젝트별 설정. `$PWD`에서 상위로 올라가며 자동 탐색한다. 없으면 `$PWD`를 workspace로 사용.

```yaml
workspace: /Users/sky1core/work/my-project   # 생략 시 agentbox.yml 위치에서 자동 추론

sync:
  files:                       # 로컬이 글로벌을 완전히 대체 (병합 아님)
    - ~/.netrc
  remoteWrite: true            # 이 프로젝트에서는 push 허용

network:
  allowHosts:
    - host.docker.internal
    - 192.168.0.110
  allowCidrs:
    - 192.168.0.0/16

startupWaitSec: 3

env:                            # 로컬 env는 글로벌을 키 단위로 오버라이드
  MY_PROJECT_KEY: "value"

agents:
  codex:
    sandboxName: codex-myproj   # 자동생성 이름 오버라이드
    model: o4-mini              # 프로젝트별 모델 오버라이드
```

### 설정 우선순위

**로컬 설정이 항상 최우선.** 같은 필드가 여러 곳에 있으면 아래쪽이 위를 덮어쓴다:

1. 하드코딩 기본값 (가장 낮음)
2. 글로벌 config (`~/.config/agentbox/config.yml`)
3. **로컬 config (`agentbox.yml`)** (가장 높음)

예시: 글로벌에서 `startupWaitSec: 10`으로 설정해도, 로컬 `agentbox.yml`에서 `startupWaitSec: 3`이면 **3이 적용**된다.

| 필드 | 설명 | 기본값 |
|------|------|--------|
| `workspace` | 프로젝트 경로. 미지정 시 `agentbox.yml` 위치 또는 `$PWD` | `$PWD` |
| `env` | sandbox에 주입할 환경변수. 글로벌/로컬 모두 지원, 키 단위 머지 | `{}` |
| `sync.files` | 호스트→sandbox 동기화할 파일 목록. 로컬이 글로벌을 완전히 대체 | `[]` |
| `sync.remoteWrite` | `true`면 git push/merge 허용. `false`면 차단 (readonly-remote) | `false` |
| `network.*` | `docker sandbox network proxy` 옵션 (`policy`, `allowHosts`, `blockHosts`, `allowCidrs`, `blockCidrs`, `bypassHosts`, `bypassCidrs`) | 비활성 |
| `startupWaitSec` | sandbox 시작 대기 시간(초) | `5` |
| `bootstrap.onCreateScript` | sandbox 최초 생성 시 1회 실행할 스크립트 | - |
| `bootstrap.onStartScript` | sandbox 시작 시마다 실행할 스크립트 | - |
| `agents.<name>.sandboxName` | sandbox 이름 오버라이드 | `<agent>-<디렉토리명>` |
| `agents.<name>.model` | 에이전트 기본 모델 (글로벌/로컬) | - |
| `agents.<name>.credentials.enabled` | 자격증명 자동 주입 on/off | `true` |

### 인증 자동 주입

sandbox를 새로 만들면 호스트의 로그인 세션이 없으므로 에이전트마다 재인증해야 한다. agentbox는 에이전트별로 호스트의 자격증명을 자동으로 sandbox에 주입한다.

| 에이전트 | 자동 주입 대상 | 조건 |
|---------|--------------|------|
| **Codex** | `~/.codex/auth.json`, `~/.codex/config.toml` 자동 복구 | 호스트에 파일 존재 시 |
| **Claude** | `~/.claude/.credentials.json` + onboarding 완료 처리 | `CLAUDE_CODE_OAUTH_TOKEN` env 설정 시 |
| **Kiro** | `~/.local/share/kiro-cli/data.sqlite3` | 호스트에 파일 존재 시 |
| **Gemini** | `~/.gemini/oauth_creds.json` 등 4개 파일 | 호스트에 파일 존재 시 |
| **GitHub** | `gh auth token` → `/run/secrets/gh_token` + `gh auth login` | 호스트에 `gh` 인증 시 |

자동 주입을 끄려면:

```yaml
agents:
  codex:
    credentials:
      enabled: false
```

### 수동 파일 동기화

`sync.files`에 등록하면 sandbox 시작 시 자동으로 복사된다.

```yaml
# ~/.config/agentbox/config.yml
sync:
  files:
    - ~/.netrc                  # GitHub/Gitea 등 git credential
    - ~/.gitconfig
```

sandbox 삭제(`docker sandbox rm`) 후 재생성해도 자동으로 복사된다.

### 환경변수 주입

`env` 필드로 sandbox에 환경변수를 주입할 수 있다. 글로벌/로컬 모두 지원하며 로컬이 글로벌을 **키 단위로 오버라이드**한다 (`sync.files`와 다르게 병합됨).

```yaml
# ~/.config/agentbox/config.yml
env:
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."
```

주입 방식은 execMode에 따라 다르다:

- **exec 모드** (codex, gemini): `docker sandbox exec -e KEY=VALUE`로 프로세스에 직접 전달
- **run 모드** (claude, kiro): env가 있으면 자동으로 `exec -e` 방식으로 전환하여 전달

#### Claude Code 인증

`CLAUDE_CODE_OAUTH_TOKEN` 환경변수를 설정하면 브라우저 로그인 없이 자동 인증된다. 환경변수 외에 `~/.claude/.credentials.json` 생성과 onboarding 완료 처리까지 자동으로 수행한다.

```yaml
# ~/.config/agentbox/config.yml
env:
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."
```

토큰은 `claude setup-token` 명령으로 발급받을 수 있다.

### Sandbox 네트워크 허용/차단

`network` 설정을 쓰면 `docker sandbox network proxy <sandbox>`에 옵션을 자동 적용한다.

```yaml
network:
  policy: deny
  allowHosts:
    - host.docker.internal
    - github.com
  allowCidrs:
    - 192.168.0.0/16
```

> 참고: sandbox 안의 `localhost`는 sandbox 자신이다. 호스트 접근은 보통 `host.docker.internal` 또는 호스트 IP를 허용해야 한다.

### Bootstrap 스크립트

sandbox 시작 전에 사용자 지정 스크립트를 실행할 수 있다. MCP 서버 빌드(`go install`), 패키지 설치 등 초기 준비에 사용한다.

```yaml
bootstrap:
  onCreateScript: ./scripts/setup.sh       # sandbox 최초 생성 시 1회
  onStartScript:                           # 매 시작 시마다
    - ./scripts/ensure-deps.sh
    - ./scripts/start-mcp.sh
```

- 상대경로는 workspace 기준으로 실행
- `~/...` 또는 workspace 밖 절대경로는 호스트에서 읽어 sandbox에 주입 후 실행
- 글로벌/로컬 모두 지원하며 순서는 global → local

## sandbox 이름 규칙

`<agent>-<프로젝트 디렉토리명>` 자동 생성. 예: `codex-my-project`, `claude-my-project`.

## 동작 원리

1. `$PWD`부터 상위로 올라가며 `agentbox.yml`을 찾아 로드 (없으면 `$PWD`를 workspace로 사용)
2. sandbox가 없으면 자동 생성, 꺼져있으면 자동 시작
3. bootstrap 스크립트 실행 (설정된 경우)
4. 에이전트별 자격증명 자동 주입 + `sync.files` 동기화
5. `sync.remoteWrite`가 `false`(기본)면 readonly-remote 설치 → git push, 브랜치 삭제, PR 병합 등 차단
6. 에이전트 CLI 실행 (승인 프롬프트 없이 자율 동작)

## readonly-remote

기본적으로 sandbox 내에서 원격 저장소를 직접 수정하는 행위를 차단한다:

- **차단**: `git push`, `gh pr merge/close/edit`, `gh repo create/delete/fork`, `gh api -X POST/PATCH/DELETE`, `gh release`
- **허용**: `git commit/pull/fetch`, `gh pr create/view/list/checks/diff/status`, `gh issue` (전체), `gh project` (delete 제외), `gh repo view/clone`, `gh api` (GET), `gh search/auth/help`

특정 프로젝트에서 push가 필요하면 해당 `agentbox.yml`에서 해제:

```yaml
sync:
  remoteWrite: true
```
