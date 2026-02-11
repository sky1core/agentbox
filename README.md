# @sky1core/agentbox

AI 코딩 에이전트(Codex, Claude, Kiro, Gemini)를 격리된 Lima VM에서 실행하는 통합 런처.

## 주요 기능

- **통합 CLI**: `agentbox codex`, `agentbox claude` 한 줄로 VM 생성부터 에이전트 실행까지
- **최소 권한 크리덴셜 주입**: 에이전트에 필요한 인증 파일만 개별 복사 (`~/.ssh` 등 민감 파일 노출 없음)
- **승인 없이 자율 동작**: 격리된 VM이므로 에이전트에게 무제한 권한 부여 가능
- **readonly-remote**: VM에서 git push, PR merge 등 원격 쓰기를 기본 차단 (프로젝트별 해제 가능)
- **bootstrap 스크립트**: VM 생성/시작 시 MCP 서버 빌드, 패키지 설치 등 자동 실행
- **Docker-in-Docker**: Lima VM 내부에서 Docker 컨테이너 네이티브 실행 가능 (Testcontainers 등)

## 요구사항

- **Lima** (`brew install lima`)
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

# Kiro / Gemini
agentbox kiro
agentbox gemini

# VM 관리 (에이전트 지정 불필요 — VM은 워크스페이스당 하나)
agentbox ls                     # 전체 VM 목록
agentbox shell                  # bash 쉘
agentbox stop                   # 정지
agentbox rm                     # VM 삭제
```

## 설정

### 글로벌: `~/.config/agentbox/config.yml`

모든 프로젝트에 적용되는 기본 설정.

```yaml
sync:
  remoteWrite: false          # git push 차단 (기본)

vm:
  cpus: 4
  memory: "8GiB"
  disk: "20GiB"

defaults:
  startupWaitSec: 30

env:
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."   # Claude Code 인증 토큰

agents:
  codex:
    binary: codex
    model: o3
  claude:
    model: sonnet
  gemini:
    binary: gemini
```

### 로컬: `agentbox.yml` (프로젝트 루트)

프로젝트별 설정. `$PWD`에서 상위로 올라가며 자동 탐색한다. 없으면 `$PWD`를 workspace로 사용.

```yaml
workspace: /Users/sky1core/work/my-project   # 생략 시 agentbox.yml 위치에서 자동 추론

sync:
  remoteWrite: true            # 이 프로젝트에서는 push 허용

vm:
  cpus: 2
  memory: "4GiB"

mounts:
  - location: "~/extra-data"
    mountPoint: "/home/user/data"
    writable: false

startupWaitSec: 10

env:                            # 로컬 env는 글로벌을 키 단위로 오버라이드
  MY_PROJECT_KEY: "value"

agents:
  codex:
    vmName: codex-myproj       # 자동생성 이름 오버라이드
    model: o4-mini              # 프로젝트별 모델 오버라이드
```

### 설정 우선순위

**로컬 설정이 항상 최우선.** 같은 필드가 여러 곳에 있으면 아래쪽이 위를 덮어쓴다:

1. 하드코딩 기본값 (가장 낮음)
2. 글로벌 config (`~/.config/agentbox/config.yml`)
3. **로컬 config (`agentbox.yml`)** (가장 높음)

예시: 글로벌에서 `startupWaitSec: 30`으로 설정해도, 로컬 `agentbox.yml`에서 `startupWaitSec: 10`이면 **10이 적용**된다.

| 필드 | 설명 | 기본값 |
|------|------|--------|
| `workspace` | 프로젝트 경로. 미지정 시 `agentbox.yml` 위치 또는 `$PWD` | `$PWD` |
| `env` | VM에 주입할 환경변수. 글로벌/로컬 모두 지원, 키 단위 머지 | `{}` |
| `vm.cpus` | VM CPU 수 | `4` |
| `vm.memory` | VM 메모리 | `"8GiB"` |
| `vm.disk` | VM 디스크 | `"20GiB"` |
| `mounts` | 추가 볼륨 마운트 (아래 참고). 로컬이 글로벌을 완전히 대체 | `[]` |
| `sync.remoteWrite` | `true`면 git push/merge 허용. `false`면 차단 (readonly-remote) | `false` |
| `startupWaitSec` | SSH readiness timeout(초). polling 방식으로 즉시 반환 | `30` |
| `caCert` | 커스텀 CA 인증서 PEM 파일 경로 (회사 프록시용) | - |
| `bootstrap.onCreateScript` | VM 최초 생성 시 1회 실행할 스크립트 | - |
| `bootstrap.onStartScript` | VM 시작 시마다 실행할 스크립트 | - |
| `agents.<name>.vmName` | VM 이름 오버라이드 | `agentbox-<디렉토리명>` |
| `agents.<name>.model` | 에이전트 기본 모델 (글로벌/로컬) | - |

### 추가 볼륨 마운트

`mounts`로 호스트 디렉토리를 VM에 마운트할 수 있다. 읽기/쓰기 모두 지원하며, `mountPoint`로 VM 내부 경로를 별도 지정할 수 있다.

```yaml
mounts:
  - location: "~/datasets"           # 호스트 경로
    mountPoint: "/mnt/datasets"      # VM 내부 경로 (생략 시 호스트와 동일)
    writable: false                  # 읽기 전용

  - location: "/opt/shared-tools"
    mountPoint: "/tools"
    writable: true                   # 쓰기 가능
```

| 필드 | 설명 | 필수 |
|------|------|------|
| `location` | 호스트 경로 (`~` 사용 가능) | O |
| `mountPoint` | VM 내부 마운트 경로. 생략 시 `location`과 동일 | X |
| `writable` | `true`: 읽기/쓰기, `false`: 읽기 전용 | X (기본 `false`) |

workspace는 자동으로 writable 마운트되므로 별도 설정 불필요.

### 자격증명 주입

호스트의 에이전트별 자격증명 파일만 `limactl copy`로 VM에 개별 복사한다. `~/.ssh`, `~/.aws` 등 불필요한 민감 파일은 노출되지 않는다.

| 에이전트 | 자격증명 경로 |
|---------|-------------|
| **Codex** | `~/.codex/auth.json` |
| **Claude** | `~/.claude/.credentials.json` |
| **Kiro** | `~/Library/Application Support/kiro-cli/data.sqlite3` |
| **Gemini** | `~/.gemini/oauth_creds.json` 등 |
| **GitHub** | `~/.config/gh/` |
| **Git** | `~/.gitconfig`, `~/.netrc` |

VM 시작 시 호스트에서 최신 자격증명이 복사된다.

### 환경변수 주입

`env` 필드로 VM에 환경변수를 주입할 수 있다. 글로벌/로컬 모두 지원하며 로컬이 글로벌을 **키 단위로 오버라이드**한다.

```yaml
# ~/.config/agentbox/config.yml
env:
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."
```

환경변수는 에이전트 실행 시 `limactl shell -- env K=V cmd` 패턴으로 전달된다. 또한 `/etc/sandbox-persistent.sh`에도 기록되어 shell 세션에서 사용 가능하다.

#### Claude Code 인증

`CLAUDE_CODE_OAUTH_TOKEN` 환경변수를 설정하면 브라우저 로그인 없이 자동 인증된다.

```yaml
# ~/.config/agentbox/config.yml
env:
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."
```

토큰은 `claude setup-token` 명령으로 발급받을 수 있다.

### Bootstrap 스크립트

VM 시작 전에 사용자 지정 스크립트를 실행할 수 있다. MCP 서버 빌드(`go install`), 패키지 설치 등 초기 준비에 사용한다.

```yaml
bootstrap:
  onCreateScript: ./scripts/setup.sh       # VM 최초 생성 시 1회
  onStartScript:                           # 매 시작 시마다
    - ./scripts/ensure-deps.sh
    - ./scripts/start-mcp.sh
```

- 상대경로는 workspace 기준으로 실행
- `~/...` 또는 workspace 밖 절대경로는 호스트에서 읽어 `limactl copy`로 VM에 복사 후 실행
- 글로벌/로컬 모두 지원하며 순서는 global -> local

## VM 이름 규칙

`agentbox-<프로젝트 디렉토리명>` 자동 생성. 예: `agentbox-my-project`.

하나의 VM에 여러 에이전트를 실행할 수 있다 (에이전트별 별도 VM이 아님).

## 동작 원리

1. `$PWD`부터 상위로 올라가며 `agentbox.yml`을 찾아 로드 (없으면 `$PWD`를 workspace로 사용)
2. VM이 없으면 자동 생성 (`limactl create`), 꺼져있으면 자동 시작 (`limactl start`)
3. bootstrap 스크립트 실행 (설정된 경우)
4. `sync.remoteWrite`가 `false`(기본)면 readonly-remote 설치 -> git push, 브랜치 삭제, PR 병합 등 차단
5. 에이전트 CLI 실행: `limactl shell -- env K=V <binary> <args>` (승인 프롬프트 없이 자율 동작)

## readonly-remote

기본적으로 VM 내에서 원격 저장소를 직접 수정하는 행위를 차단한다:

- **차단**: `git push`, `gh pr merge/close/edit`, `gh repo create/delete/fork`, `gh api -X POST/PATCH/DELETE`, `gh release`
- **허용**: `git commit/pull/fetch`, `gh pr create/view/list/checks/diff/status`, `gh issue` (전체), `gh project` (delete 제외), `gh repo view/clone`, `gh api` (GET), `gh search/auth/help`

특정 프로젝트에서 push가 필요하면 해당 `agentbox.yml`에서 해제:

```yaml
sync:
  remoteWrite: true
```
