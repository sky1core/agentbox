# agentbox Lima 전환 스펙

## 현재 agentbox가 하는 일 (Docker Sandbox 기준)

### 1. VM 라이프사이클
- sandbox 상태 확인 (`docker sandbox ls` 파싱 — `--format` 미지원이라 공백 split)
- 없으면 생성 (`docker sandbox create --name <name> <agent> <workspace>`)
- 꺼져있으면 시작 (`docker sandbox run <name>` background)
- 정지 (`docker sandbox stop`)
- `startupWaitSec` 만큼 sleep 후 다음 단계 진행

### 2. 파일/설정 주입 (매 시작마다)
- `sync.files`: 호스트 파일 → sandbox로 stdin 파이핑 (`docker sandbox exec -i ... sh -c 'cat > file'`)
- 에이전트별 credential 자동 주입:
  - **Codex**: `~/.codex/auth.json` 복사 + `config.toml` 누락 시 복구
  - **Claude**: `CLAUDE_CODE_OAUTH_TOKEN` → `~/.claude/.credentials.json` 생성 + onboarding 완료 처리
  - **Kiro**: `~/Library/Application Support/kiro-cli/data.sqlite3` → `~/.local/share/kiro-cli/data.sqlite3`
  - **Gemini**: `~/.gemini/` 하위 4개 파일 복사
- GitHub 토큰: `gh auth token` → `/run/secrets/gh_token` + `gh auth login --with-token`
- 환경변수: `docker sandbox exec -e KEY=VALUE`로 주입
- `/etc/sandbox-persistent.sh`에 env 기록 (shell에서 접근용)

### 3. 네트워크
- `host.docker.internal` /etc/hosts 고정 (DNS 불안정 우회)
- proxy connectivity 검증 (curl example.com)
- `docker sandbox network proxy` 옵션 적용 (allow/block hosts/cidrs)

### 4. 보안 (readonly-remote)
- git wrapper: `~/.local/bin/git` — push/send-pack/receive-pack 차단
- gh wrapper: `~/.local/bin/gh` — whitelist 방식 (pr create/view/list 등만 허용)
- pre-push hook: `~/.git-hooks/pre-push`

### 5. Bootstrap 스크립트
- `onCreateScript`: VM 최초 생성 시 1회
- `onStartScript`: 매 시작 시
- 상대경로 → workspace 기준, `~/` 또는 절대경로 → 호스트에서 읽어 주입 후 실행
- global → local 순서로 concat

### 6. 에이전트 실행
- exec 모드 (codex, gemini): `docker sandbox exec -it -w <workspace> <name> <binary> <args>`
- run 모드 (claude, kiro): `docker sandbox run <name> [-- <args>]`
- run 모드 + env → exec 모드로 자동 전환 (`docker sandbox run`에 `-e` 없으므로)
- model 플래그 자동 주입 (`--model <model>`)
- defaultArgs 주입 (`--dangerously-skip-permissions`, `--ask-for-approval never` 등)

---

## Docker Sandbox의 근본적 한계

1. **execMode 이원화**: run vs exec가 에이전트마다 다르고, run에는 `-e` 미지원 → 분기 로직이 복잡
2. **네트워크 프록시 강제**: 모든 트래픽이 host.docker.internal:3128 경유. DNS 불안정 시 전체 네트워크 마비. 사설 IP 기본 차단
3. **에이전트 타입 고정**: codex sandbox에 claude를 넣을 수 없음. 에이전트별 별도 VM 강제
4. **CLI 미성숙**: `--format` 미지원, `-e` 미지원(run), stdout 파싱 필요
5. **Docker Desktop 종속**: 유료. Docker Desktop 없으면 사용 불가
6. **tmpfs 경로**: `/run/secrets` 등 재시작마다 소실 → 매번 재주입
7. **이미지 내부 설정에 의존**: approval-free 설정이 이미지에 하드코딩. 사용자가 제어 불가
8. **제한된 확장성**: VM 내부에서 할 수 있는 것이 제한적 (네트워크, 디스크, 패키지 관리 등)

---

## Lima 전환 시 달라지는 것

### VM 라이프사이클
| 현재 (Docker Sandbox) | Lima |
|---|---|
| `docker sandbox create --name X agent workspace` | `limactl create --name X template.yaml` |
| `docker sandbox run X` (background) | `limactl start X` |
| `docker sandbox stop X` | `limactl stop X` |
| `docker sandbox ls` (파싱) | `limactl list --json` (JSON 출력 지원) |
| `docker sandbox exec -it X cmd` | `limactl shell X cmd` 또는 SSH |
| `docker sandbox exec -i X sh -c 'cat > file'` | `limactl copy host:file X:dest` 또는 SSH/SCP |

### 에이전트 타입 고정 → 범용 VM
- Docker Sandbox: 에이전트별 전용 이미지 (codex sandbox, claude sandbox 각각 생성)
- Lima: 범용 Ubuntu VM 하나에 여러 에이전트 설치 가능
- VM 이름을 프로젝트 단위로 생성하고, 에이전트는 그 안에서 실행

### 네트워크
- Docker Sandbox: HTTP 프록시 강제, DNS 불안정, 사설 IP 차단
- Lima: VM이 직접 네트워크 스택 보유. 프록시 없음. 호스트 네트워크 직접 접근 가능 (설정에 따라)

### 파일 마운트
- Docker Sandbox: workspace만 양방향 동기화 (동일 절대경로)
- Lima: virtiofs/9p/reverse-sshfs로 마운트. 마운트 포인트 자유롭게 지정 가능

### 에이전트 실행 방식
- Docker Sandbox: run/exec 이원화 → Lima: 전부 `limactl shell` 또는 SSH로 통일
- `-e` 문제 없음: 환경변수는 SSH 세션에서 직접 전달하거나 `.bashrc`에 기록
- 에이전트 바이너리는 VM 안에 설치 (cloud-init 또는 bootstrap으로)

### Credential/설정 파일
- Docker Sandbox: 마운트 불가 → 매 시작마다 stdin 파이핑으로 복사/재주입
- Lima: 호스트 디렉토리를 read-only 마운트 → 복사/주입 자체가 불필요
  - 호스트에서 재인증하면 VM에서도 즉시 반영
  - `sync.files` 개념 자체가 불필요해짐 (마운트로 대체)

### approval-free 설정
- Docker Sandbox: 이미지에 하드코딩
- Lima: agentbox가 직접 설정 파일 생성/관리
  - Codex: `~/.codex/config.toml` (approval_policy=never, sandbox_mode=danger-full-access)
  - Claude: `~/.claude/settings.json` (dangerously-skip-permissions)
  - 등

---

## 새 설계

### VM 템플릿

Lima YAML 템플릿으로 VM 스펙을 정의한다. agentbox가 내장 템플릿을 제공하고, 사용자가 오버라이드 가능.

```yaml
# agentbox 내장 템플릿 (예시)
arch: default
images:
  - location: "https://cloud-images.ubuntu.com/releases/24.04/..."
    arch: aarch64
cpus: 4
memory: 8GiB
disk: 50GiB
mounts:
  # workspace — writable
  - location: "/Users/sky1core/work/my-project"
    mountPoint: "/Users/sky1core/work/my-project"
    writable: true
  # credential/설정 — read-only 마운트 (호스트 변경 즉시 반영)
  - location: "~/.codex"
    writable: false
  - location: "~/.claude"
    writable: false
  - location: "~/.gemini"
    writable: false
  - location: "~/.config/gh"
    writable: false
  - location: "~/.netrc"
    writable: false
  - location: "~/.gitconfig"
    writable: false
provision:
  - mode: system
    script: |
      apt-get update && apt-get install -y curl git gh nodejs npm docker.io
  - mode: user
    script: |
      # 에이전트 CLI 설치
      npm install -g @anthropic-ai/claude-code
      npm install -g @openai/codex
      # ...
```

### VM 이름 규칙

기존: `<agent>-<project>` (예: codex-myproject, claude-myproject)
변경: `<project>` (예: myproject) — 하나의 VM에서 여러 에이전트 실행

### 설정 스키마 변경

```yaml
# 제거되는 필드
agents.<name>.execMode          # 삭제 (모두 limactl shell로 통일)
sync.files                      # 삭제 (마운트로 대체)

# 추가되는 필드
vm:
  cpus: 4
  memory: 8GiB
  disk: 50GiB
  template: default             # 내장 템플릿 이름 또는 커스텀 YAML 경로
mounts:                         # 추가 마운트 (credential 외 사용자 지정)
  - location: "~/some/path"
    writable: false
```

### 실행 흐름 (변경 후)

1. `agentbox.yml` 로드 (기존과 동일)
2. Lima VM 상태 확인 (`limactl list --json`)
3. 없으면 생성 (`limactl create` + 내장 템플릿 — workspace/credential 마운트 포함)
4. 꺼져있으면 시작 (`limactl start`)
5. **최초 생성 시**: provision (에이전트 설치) + onCreate bootstrap
6. **매 시작 시**: onStart bootstrap + readonly-remote 설치
7. 에이전트 실행: `limactl shell <vm> -- env KEY=VALUE <binary> <args>`

credential/설정 파일은 마운트이므로 주입 단계 자체가 없음.

### 유지되는 것
- 설정 파일 구조 (`~/.config/agentbox/config.yml` + `agentbox.yml`)
- 설정 병합 순서 (기본값 → 글로벌 → 로컬)
- CLI 인터페이스 (`agentbox codex`, `agentbox claude shell` 등)
- readonly-remote (git/gh wrapper)
- bootstrap 스크립트 (onCreate/onStart)
- env 주입 (실행 시점에 전달)

### 제거되는 것
- `execMode` (run/exec 구분 불필요)
- `sync.files` (마운트로 대체)
- credential 복사/주입 로직 전체 (마운트로 대체)
- `host.docker.internal` /etc/hosts 패치
- proxy connectivity 검증
- `docker sandbox network proxy` 관련 전체
- `docker sandbox ls` 파싱 hack
- run 모드 + env → exec 전환 로직
- stdin 파이핑 (`docker sandbox exec -i ... cat > file`)

### 새로 필요한 것
- Lima YAML 템플릿 생성/관리 (workspace + credential 마운트 동적 구성)
- 에이전트 CLI 설치 프로비저닝 (provision 스크립트)
- approval-free 설정 파일 직접 생성
- `limactl` 래퍼 (create/start/stop/shell/list)
- VM 리소스 설정 (cpu/memory/disk)

---

## 마이그레이션 단계

### Phase 1: Lima 런타임 구현
- `src/docker/` → `src/runtime/` 리팩토링
- `src/runtime/lima.ts`: limactl 래퍼 (create/start/stop/shell/list/copy)
- Lima YAML 템플릿 내장
- VM 라이프사이클 관리

### Phase 2: 마운트/env 전환
- credential/설정 파일 → Lima mount (read-only)로 대체. 복사/주입 로직 제거
- sync.files → mount 설정으로 대체
- env → `limactl shell` 실행 시 env 인자로 전달

### Phase 3: 에이전트 프로비저닝
- 에이전트 CLI 설치 스크립트 (provision 단계)
- approval-free 설정 자동 생성
- 에이전트별 설정 관리

### Phase 4: 정리
- Docker Sandbox 관련 코드 제거
- execMode 로직 제거
- 네트워크 hack 제거
- 테스트 업데이트
- 문서 업데이트
