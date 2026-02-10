# AGENTS.md — agentbox 프로젝트 지침

## 프로젝트 개요

Lima VM 통합 런처. AI 코딩 에이전트(Codex, Claude Code, Kiro, Gemini)를 격리된 Lima VM에서 실행하는 npm CLI 도구.

## 프로젝트 목적(배경)

이 프로젝트(agentbox)는 AI 코딩 에이전트를 격리 환경에서 실행할 때 발생하는 실용적 불편함을 해소하기 위해 시작되었다.

- 에이전트 CLI마다 **관련 설정을 사용자가 일일이 직접 지정**해야 하는 불편함이 크다.
- **로그인/인증 유지**를 사용자가 직접 관리해야 한다.
- VM이 삭제되면 **workspace 마운트 외의 모든 상태가 소실**되는데, 이를 보완하는 대안을 기본으로 제공하지 않는다.

## 왜 격리된 VM이 필요한가

격리 환경이 필요한 핵심 이유는, 개발 위임 흐름에서 LLM이 지속적으로 요구하는 승인(prompt for approval)을 **처음부터 풀어(또는 최소화해) 운영**할 수 있기 때문이다. 즉, "무제한 권한"을 줄 수 있는 전제 조건으로서 격리가 필요하다.

### 왜 DinD(Docker-in-Docker)가 아닌 Lima VM인가

DinD는 Docker 컨테이너 안에서 Docker를 실행하는 방식인데, agentbox 용도에는 부적합하다:

- **`--privileged` 필수**: DinD는 호스트 커널에 특권 접근이 필요하다. 격리 목적인데 특권 컨테이너를 쓰면 격리 의미가 없다.
- **스토리지/cgroup 문제**: 중첩 Docker는 스토리지 드라이버 충돌, cgroup 계층 문제가 발생한다.
- **불완전한 환경**: 컨테이너는 init 시스템(systemd)이 없어 서비스 관리가 제한적이다.

Lima VM은 **전체 Linux 커널을 실행하는 경량 VM**이므로:

- Docker가 네이티브로 동작한다 (Testcontainers, docker compose 등 완전 지원).
- systemd, cgroup, 네트워크 스택이 완전하다.
- `--privileged` 없이도 완전한 격리 + 무제한 권한을 동시에 달성한다.
- macOS의 Virtualization.Framework(VZ)로 오버헤드가 매우 낮다.

## 핵심 목표(설계 원칙)

- Lima VM의 격리 기능을 활용해 **최대한 자동화**한다.
- 내가 호스트 PC에서 개발할 때 사용하는 것과 **최대한 동일한** VM 개발 환경을 제공한다.
- "무제한 권한(승인 요구 최소/해제)"을 목표로 하되, 이는 **격리 환경(VM)** 을 전제로 한다.
- LLM/에이전트 설정은 **영속성 유지**가 가능해야 하며, 글로벌 설정을 개별 VM에 **매번 수동으로 넣게 강요하지 않는다**.
- 프로젝트별(local)로 둘지, 사용자 전역(global)으로 둘지 같은 **설정 위치/운영 방식은 사용자 필요에 따라 알아서 선택할 일**이다.
  - 특정 위치/방식을 "정답/정석"처럼 강요하거나, 사용자에게 불필요한 결정을 떠넘기는 설계는 잘못된 설계다.
  - agentbox는 사용자가 어떤 방식을 선택하든 동작하도록 **메커니즘(병합/주입/마운트)만 제공**하고, 강제하지 않는다.
- VM 실행 후 사용자가 "직접 들어가서 뭘 실행해서 세팅" 같은 **수동 절차를 강요하지 않는다**.
  - 가능한 범위에서 agentbox가 설정/자격증명/환경변수 등을 **자동 마운트/주입**한다.

### 파일 구조

```
package.json
tsconfig.json
src/
  index.ts                  # #!/usr/bin/env node 엔트리
  cli.ts                    # argv 파싱 & 디스패치
  config/
    schema.ts               # 글로벌/로컬 config 타입 (VmConfig, MountConfig 등)
    loader.ts               # YAML 탐색, 파싱, 병합
    defaults.ts             # 기본값 (에이전트별 binary/defaultArgs)
  runtime/
    lima.ts                 # limactl CLI 래퍼 (create/start/stop/shell/list/copy)
  agents/
    types.ts                # COMMON_COMMANDS 정의
    base.ts                 # ensureRunning (VM 상태 확인/생성/시작)
  sync/
    presets.ts              # env 주입 (injectEnvVars), readonly-remote 설치
    bootstrap.ts            # 부트스트랩 스크립트 실행 (limactl copy + shell)
  utils/
    process.ts              # spawn 헬퍼 (inherit/capture)
    logger.ts               # [agentbox] 접두사 로거
docs/
  spec-lima.md              # Lima 전환 스펙
  agent-provisioning.md     # 에이전트별 설치/설정 레퍼런스
  lima-cli-reference.md     # Lima CLI 레퍼런스
README.md
AGENTS.md                   # 이 파일
```

## 코드 수정 시 반드시 알아야 할 것

### CLI 흐름

1. **에이전트 파싱** -> 2. **agentbox.yml 상위 탐색/로드** -> 3. **설정 병합 (기본->글로벌->로컬)** -> 4. **ensureRunning** -> 5. **커맨드 디스패치**

VM 이름: `agentbox-<basename of workspace>` (예: `agentbox-my-project`)

하나의 VM에서 여러 에이전트를 실행할 수 있다.

### 에이전트 실행 방식

모든 에이전트가 `limactl shell`로 통일된다. 에이전트별 execMode 구분이 없다.

```bash
limactl shell --workdir <workspace> <vmName> -- env K=V <binary> <args>
```

에이전트별 기본 설정:

| 에이전트 | binary | defaultArgs |
|---------|--------|-------------|
| codex   | `codex` | `--dangerously-bypass-approvals-and-sandbox` |
| claude  | `claude` | `--dangerously-skip-permissions` |
| kiro    | `kiro-cli` | `chat --trust-all-tools` |
| gemini  | `gemini` | `--approval-mode=yolo --no-sandbox` |

기본값은 `src/config/defaults.ts`의 `AGENT_DEFAULTS`에서 관리. 글로벌 config에서 오버라이드 가능.

### 환경변수 주입 (`env`)

`src/config/schema.ts`에 `env?: Record<string, string>` 필드. 글로벌/로컬 모두 지원.

- **병합 방식**: `{ ...global.env, ...local.env }` -- 키 단위 오버라이드
- **실행 시 전달**: `limactl shell -- env K=V cmd` 패턴으로 프로세스에 직접 전달
- **persistent.sh 주입**: `src/sync/presets.ts`의 `injectEnvVars()`가 `/etc/sandbox-persistent.sh`에도 기록 (shell 세션에서 접근용)

### VM 라이프사이클 (`src/runtime/lima.ts`)

| 함수 | limactl 명령 | 설명 |
|------|-------------|------|
| `getState()` | `limactl list --json` | VM 상태 조회 (Running/Stopped/Broken/"") |
| `create()` | `limactl create --name X --yes template.yaml` | YAML 템플릿으로 VM 생성 |
| `start()` | `limactl start X` | VM 시작 |
| `stop()` | `limactl stop X` | VM 정지 |
| `remove()` | `limactl delete --force X` | VM 삭제 |
| `shellInteractive()` | `limactl shell --workdir W X -- env K=V cmd` | 인터랙티브 명령 실행 |
| `shellNonInteractive()` | 동일 | 비인터랙티브 명령 실행 |
| `shellCapture()` | 동일 | 명령 실행 + stdout 캡처 |
| `copyToVm()` | `limactl copy host:file X:dest` | 호스트 -> VM 파일 복사 |

### VM 템플릿 생성 (`buildTemplate()`)

`src/runtime/lima.ts`의 `buildTemplate()`이 ResolvedConfig에서 Lima YAML 템플릿을 동적 생성한다:

- vmType: `vz` (macOS Virtualization.Framework)
- 이미지: Ubuntu 24.04 LTS (arm64 + amd64)
- Rosetta: 활성화 (Apple Silicon x86 호환)
- 마운트: workspace (writable) + `~` (read-only) + 사용자 추가 마운트
- provision: 시스템 패키지(git, docker, Node.js, gh) 자동 설치

### 자격증명 마운트

호스트의 `~`가 VM에 read-only로 마운트되므로, 에이전트별 자격증명 파일(`~/.codex/`, `~/.claude/`, `~/.gemini/`, `~/.config/gh/`, `~/.netrc`, `~/.gitconfig` 등)이 별도 복사 없이 VM에서 바로 사용 가능하다. 호스트에서 재인증하면 VM에서도 즉시 반영.

### 부트스트랩 스크립트 (`bootstrap`) -- entrypoint 역할

VM이 만들어지거나(1회) 시작될 때마다, 에이전트 CLI를 띄우기 전에 **사용자 지정 스크립트**를 실행할 수 있다.
Go 기반 MCP 서버를 위해 `go install` 같은 "초기 준비"를 자동화할 때 사용한다.

설정은 글로벌/로컬 모두 지원하며, agentbox는 특정 위치/방식을 강요하지 않는다(둘 다 실행).

- `bootstrap.onCreateScript`: VM 최초 생성 시 1회 실행
- `bootstrap.onStartScript`: `ensureRunning()` 시점마다 실행(생성 직후 포함)
- **병합/실행 순서**: global -> local
- **실행 방식**: `bash -euo pipefail <script>` (exec bit 불필요)
- **경로 규칙**
  - 상대경로(`./...` 또는 `scripts/...`)는 **workspace 기준**으로 실행 (workspace는 VM에서 동일 절대경로로 마운트됨)
  - `~/...` 또는 workspace 밖의 절대경로는 **호스트에서 `limactl copy`로 VM에 복사 후 실행**

### 에이전트 추가 방법

1. `src/config/schema.ts`의 `AgentName` 타입에 추가
2. `src/config/defaults.ts`의 `AGENT_DEFAULTS`에 binary/defaultArgs 추가
3. `src/cli.ts`의 `agentDescription`에 설명 추가
4. 에이전트 고유 커맨드가 있으면 `src/agents/types.ts`의 `COMMON_COMMANDS`에 추가, `src/cli.ts`의 dispatch에 case 추가
5. README.md 업데이트

## 설정 스키마

### 글로벌: `~/.config/agentbox/config.yml`

```yaml
sync:
  remoteWrite: false
vm:
  cpus: 4
  memory: "8GiB"
  disk: "50GiB"
defaults:
  startupWaitSec: 5
env:
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-xxx..."
agents:
  codex:
    binary: codex
```

### 로컬: `agentbox.yml` (프로젝트 루트)

```yaml
workspace: /path/to/project   # 생략 시 agentbox.yml 위치에서 자동 추론
vm:
  cpus: 2
  memory: "4GiB"
mounts:
  - location: "~/extra-data"
    writable: false
startupWaitSec: 3
env:
  MY_VAR: "value"             # 로컬이 글로벌을 키 단위로 오버라이드
agents:
  codex:
    vmName: my-custom-vm
```

### 병합 순서

1. 하드코딩 기본값 -> 2. 글로벌 config -> 3. 로컬 config

### 병합 규칙

| 필드 | 병합 방식 |
|------|----------|
| `env` | 키 단위 머지 (global -> local override) |
| `mounts` | 로컬이 글로벌을 완전히 대체 |
| `bootstrap` scripts | concat (global then local) |
| 그 외 | 로컬 우선 |

## 이슈 관리

이슈는 GitHub이 아닌 Gitea dev 레포에 등록한다:
- **URL**: http://sky1nas.taildfa1e6.ts.net:3000/sky1core/agentbox-dev
- **API**: `http://192.168.0.110:3000/api/v1/repos/sky1core/agentbox-dev/issues`

### 이슈 라벨 분류

이슈 등록 시 반드시 라벨로 긴급도를 구분한다:
- **`critical`**: 정상 사용 시 발생하는 버그. 즉시 수정.
- **`bug`**: 엣지 케이스 버그. 정상 사용에는 영향 없음. 모아서 수정.
- **`feature`**: 새 기능 요청.
- **`improvement`**: 기존 기능 개선, 리팩토링.

## 테스트

```bash
npm test                         # vitest 실행
npm run build                    # TypeScript 빌드

# 수동 검증
agentbox --help
agentbox ls                      # VM 목록
agentbox shell                   # bash 쉘
agentbox codex
agentbox codex --help            # 에이전트 CLI 패스스루 (codex --help)
agentbox claude prompt "hello"
agentbox rm                      # VM 삭제
```
