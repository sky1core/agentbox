# Lima CLI Reference

> limactl 명령어, YAML 템플릿 문법, 마운트/네트워크/프로비저닝 동작을 정리한 레퍼런스.
> agentbox Lima 전환 구현 시 참고용.

---

## 1. VM 라이프사이클 명령어

### 1.1 `limactl create`

인스턴스를 생성만 한다 (시작하지 않음).

```
limactl create [FILE.yaml|URL|template://NAME] [flags]
```

**주요 플래그:**

| 플래그 | 타입 | 설명 |
|--------|------|------|
| `--name` | string | 인스턴스 이름 지정 |
| `--cpus` | int | CPU 수 |
| `--memory` | float32 | 메모리 (GiB) |
| `--disk` | float32 | 디스크 (GiB) |
| `--arch` | string | 아키텍처 (x86_64, aarch64, riscv64, armv7l, s390x, ppc64le) |
| `--vm-type` | string | VM 타입 (qemu, vz) |
| `--mount` | strings | 마운트 디렉토리. `:w` 접미사로 writable 지정 |
| `--mount-only` | strings | 기존 마운트를 덮어쓰고 지정된 것만 마운트 |
| `--mount-type` | string | 마운트 타입 (reverse-sshfs, 9p, virtiofs) |
| `--mount-writable` | bool | 모든 마운트를 writable로 |
| `--mount-inotify` | bool | inotify 활성화 |
| `--mount-none` | bool | 모든 마운트 제거 |
| `--network` | strings | 네트워크 추가 (vzNAT, lima:shared 등) |
| `--port-forward` | stringArray | 포트포워딩 (host:guest) |
| `--rosetta` | bool | Rosetta 활성화 (vz 전용) |
| `--containerd` | string | containerd 모드 (user, system, user+system, none) |
| `--dns` | ipSlice | 커스텀 DNS |
| `--ssh-port` | uint16 | SSH 포트 (0=random) |
| `--plain` | bool | 마운트/포트포워딩/containerd 비활성화 |
| `--set` | stringArray | yq 문법으로 템플릿 인라인 수정 |
| `--video` | bool | 비디오 출력 (성능 영향 있음) |
| `-y, --yes` | bool | 대화형 프롬프트 비활성화 |

**예시:**

```bash
# 기본 생성
limactl create --name myvm template://default

# 커스텀 YAML로 생성
limactl create --name myvm ./my-template.yaml

# 플래그로 리소스 지정
limactl create --name myvm --cpus 4 --memory 8 --disk 50 template://default

# 마운트 제한 (워크스페이스만)
limactl create --name myvm --mount-only "$(pwd):w" template://default

# yq로 인라인 수정
limactl create --name myvm --set '.cpus = 4 | .memory = "8GiB"' template://default
```

### 1.2 `limactl start`

인스턴스를 시작한다. 존재하지 않으면 생성도 한다 (create + start).

```
limactl start [NAME|FILE.yaml|URL] [flags]
```

`limactl create`와 동일한 플래그를 대부분 공유하며, 추가로:

| 플래그 | 타입 | 기본값 | 설명 |
|--------|------|--------|------|
| `--foreground` | bool | false | HostAgent를 포그라운드로 실행 |
| `--timeout` | duration | 10m | 시작 완료 대기 타임아웃 |
| `--progress` | bool | false | 프로비저닝 진행상황 표시 |

**동작:**
1. 인스턴스가 없으면 생성
2. 이미지 다운로드, 디스크 생성 등 준비
3. HostAgent 프로세스 시작
4. cloud-init으로 프로비저닝 실행
5. 완료될 때까지 이벤트 스트리밍 (또는 타임아웃)

**이미 Running인 경우:** 별도 에러 없이 종료 (no-op).

### 1.3 `limactl stop`

```
limactl stop INSTANCE [flags]
```

| 플래그 | 설명 |
|--------|------|
| `-f, --force` | SIGKILL로 강제 종료 (기본은 SIGINT + graceful) |

### 1.4 `limactl delete`

```
limactl delete INSTANCE [flags]
```

별칭: `remove`, `rm`

| 플래그 | 설명 |
|--------|------|
| `-f, --force` | 실행 중이면 강제 종료 후 삭제 |

`~/.lima/<instance-name>/` 디렉토리 전체를 삭제한다.

### 1.5 `limactl restart`

```
limactl restart INSTANCE [flags]
```

stop + start를 순차 실행.

### 1.6 기타

| 명령 | 설명 |
|------|------|
| `limactl clone SRC DEST` | 인스턴스 복제 |
| `limactl rename OLD NEW` | 이름 변경 |
| `limactl factory-reset INSTANCE` | 팩토리 리셋 |
| `limactl protect INSTANCE` | 삭제 방지 |
| `limactl unprotect INSTANCE` | 삭제 방지 해제 |
| `limactl prune` | 미사용 오브젝트 정리 |
| `limactl edit INSTANCE` | 설정 편집 |

---

## 2. VM 상태 조회 (`limactl list`)

```
limactl list [INSTANCE...] [flags]
```

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `-f, --format` | 출력 형식: json, yaml, table, go-template (기본: table) |
| `--json` | `--format=json`과 동일 |
| `-q, --quiet` | 이름만 출력 |
| `--all-fields` | 모든 필드 표시 |
| `--list-fields` | 사용 가능한 필드 목록 출력 |
| `--yq` | yq 표현식 적용 |

### JSON 출력 포맷

`limactl list --json`은 **newline-delimited JSON** (JSON Lines) 형식으로 출력한다. 각 인스턴스가 별도의 JSON 객체.

**주요 필드 (Instance struct):**

| 필드 | 타입 | 설명 |
|------|------|------|
| `Name` | string | 인스턴스 이름 |
| `Status` | string | 상태 (아래 참조) |
| `Dir` | string | 인스턴스 디렉토리 (`~/.lima/<name>/`) |
| `VMType` | string | VM 타입 (qemu, vz) |
| `Arch` | string | 아키텍처 |
| `CPUs` | int | CPU 수 |
| `Memory` | int64 | 메모리 (bytes) |
| `Disk` | int64 | 디스크 (bytes) |
| `SSHLocalPort` | int | SSH 로컬 포트 |
| `SSHAddress` | string | SSH 주소 |
| `Hostname` | string | 호스트네임 |
| `Config` | object | 전체 lima.yaml 설정 |
| `Message` | string | 상태 메시지 |
| `Errors` | []string | 에러 목록 |

### 상태값

| 상태 | 의미 |
|------|------|
| `Running` | HostAgent PID 존재 + 프로세스 alive |
| `Stopped` | HostAgent PID 파일 없음 |
| `Broken` | 설정/상태 불일치 |

**agentbox에서의 활용:**
```bash
# JSON으로 특정 인스턴스 상태 확인
limactl list --json myvm

# 이름만 조회
limactl list -q

# go-template으로 상태만 추출
limactl list --format '{{.Name}} {{.Status}}'
```

### 인스턴스 디렉토리 구조

`~/.lima/<instance-name>/` 하위:

| 파일 | 설명 |
|------|------|
| `lima.yaml` | 최종 병합된 설정 |
| `ha.pid` | HostAgent PID |
| `ha.sock` | HostAgent 소켓 |
| `ha.stdout.log` | HostAgent stdout 로그 |
| `ha.stderr.log` | HostAgent stderr 로그 |
| `basedisk` | 베이스 디스크 이미지 |
| `diffdisk` | 차분 디스크 |
| `cidata.iso` | cloud-init 프로비저닝 ISO |
| `ssh.sock` | SSH 컨트롤 소켓 |

---

## 3. 명령 실행 (`limactl shell`)

```
limactl shell [flags] INSTANCE [COMMAND...]
```

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--preserve-env` | 호스트 환경변수를 게스트로 전달 |
| `--workdir` | 작업 디렉토리 지정 |
| `--shell` | 셸 인터프리터 (예: /bin/bash) |
| `--start` | 인스턴스가 꺼져있으면 자동 시작 |
| `--reconnect` | SSH 세션 재연결 |
| `--sync` | 호스트 디렉토리와 게스트 간 동기화 (v2.1+) |

### Interactive vs Non-interactive

**Interactive (COMMAND 없음):**
```bash
limactl shell myvm
# → exec /bin/bash --login
```

**Non-interactive (COMMAND 있음):**
```bash
limactl shell myvm -- echo hello
# → /bin/bash --login -c "echo hello"
```

### 환경변수 전달

Lima는 `docker sandbox exec -e KEY=VALUE` 같은 직접적인 `-e` 플래그가 **없다**.
대신 다음 방법을 사용한다:

#### 방법 1: `--preserve-env` + 필터링

```bash
# 모든 허용 환경변수 전달
limactl shell --preserve-env myvm -- cmd

# 특정 변수만 허용
LIMA_SHELLENV_ALLOW="MY_VAR,ANOTHER_*" limactl shell --preserve-env myvm -- cmd

# 특정 변수 차단 (기본 차단 목록에 추가)
LIMA_SHELLENV_BLOCK="+SECRET_*" limactl shell --preserve-env myvm -- cmd
```

**기본 차단 목록:** `BASH*`, `ZSH*`, 시스템 경로, 사용자 정보, SSH/보안 변수, 동적 링커 변수 등.

#### 방법 2: env 명령어 래핑

```bash
limactl shell myvm -- env KEY1=VALUE1 KEY2=VALUE2 /path/to/binary args...
```

이 방법이 agentbox에서 가장 실용적이다. `docker sandbox exec -e`와 유사한 패턴.

#### 방법 3: lima.yaml의 `env:` 섹션 (정적)

```yaml
env:
  MY_VAR: "value"
  http_proxy: "http://proxy:3128"
```

VM 시작 시 `/etc/environment`에 기록된다. 정적 설정에 적합.

`propagateProxyEnv: true` (기본값)이면 호스트의 프록시 환경변수가 자동 전달되며, `localhost`/`127.0.0.1`이 호스트 게이트웨이 주소로 치환된다.

#### 방법 4: provision 스크립트에서 .bashrc/.bash_profile에 기록

```yaml
provision:
  - mode: user
    script: |
      echo 'export MY_VAR="value"' >> ~/.bash_profile
```

### --workdir 동작

| 상황 | 동작 |
|------|------|
| `--workdir` 명시 | 해당 경로로 cd. 실패 시 exit 1 |
| `--workdir` 없음 + 마운트 있음 | 호스트의 현재 디렉토리로 cd 시도 → 실패 시 홈 디렉토리 |
| Windows | WSL2 경로 변환 자동 적용 |

**agentbox 활용:**
```bash
limactl shell --workdir /path/to/workspace myvm -- env KEY=VALUE agent-binary args
```

---

## 4. 파일 복사 (`limactl copy`)

```
limactl copy [flags] SOURCE... TARGET
```

`<INSTANCE>:<PATH>` 형식으로 호스트/게스트를 구분한다.

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--backend` | scp, rsync, auto (기본: auto) |
| `-r, --recursive` | 디렉토리 재귀 복사 |
| `-v, --verbose` | 상세 출력 |

**예시:**
```bash
# 호스트 → 게스트
limactl copy ./local-file myvm:/home/user/dest

# 게스트 → 호스트
limactl copy myvm:/etc/os-release ./

# 디렉토리 재귀 복사
limactl copy -r ./scripts myvm:/tmp/scripts
```

**agentbox 활용 시나리오:**
마운트로 해결되지 않는 경우 (예: 동적 생성 파일, 런타임 주입)에 `limactl copy`로 대체 가능. `docker sandbox exec -i ... cat > file` 패턴을 대체한다.

---

## 5. Lima YAML 템플릿 문법

### 5.1 기본 구조

```yaml
# VM 타입 & 아키텍처
vmType: "vz"        # "qemu", "vz", "default"
arch: "default"      # "default", "x86_64", "aarch64"

# 리소스
cpus: 4              # 기본: min(4, host CPU cores)
memory: "8GiB"       # 기본: min("4GiB", half of host memory)
disk: "50GiB"        # 기본: "100GiB"

# 이미지
images:
  - location: "https://cloud-images.ubuntu.com/releases/24.04/..."
    arch: "aarch64"
    digest: "sha256:..."
  - location: "https://cloud-images.ubuntu.com/releases/24.04/..."
    arch: "x86_64"

# 마운트
mounts:
  - location: "~"
    writable: false
  - location: "/tmp/lima"
    writable: true

# 프로비저닝
provision:
  - mode: system
    script: |
      apt-get update && apt-get install -y git curl

# 환경변수
env:
  MY_VAR: "value"

# 포트포워딩
portForwards:
  - guestPort: 8080
    hostPort: 8080

# Rosetta (Apple Silicon, vz 전용)
rosetta:
  enabled: true
  binfmt: true

# 네트워크
networks: []

# SSH
ssh:
  localPort: 0       # 0 = random
```

### 5.2 템플릿 변수

마운트 경로 등에서 사용 가능한 변수:

| 변수 | 설명 |
|------|------|
| `{{.Home}}` | 호스트 홈 디렉토리 |
| `{{.Dir}}` | 인스턴스 디렉토리 |
| `{{.Name}}` | 인스턴스 이름 |
| `{{.UID}}` | 사용자 UID |
| `{{.User}}` | 사용자 이름 |
| `{{.Hostname}}` | 호스트네임 |
| `{{.Param.Key}}` | 사용자 정의 파라미터 |
| `{{.GlobalTempDir}}` | 글로벌 임시 디렉토리 |
| `{{.TempDir}}` | 인스턴스 임시 디렉토리 |

### 5.3 Base 템플릿 (상속)

```yaml
base:
  - template:_images/ubuntu
  - template:_default/mounts
```

부모 템플릿의 설정을 재귀적으로 병합한 후 현재 템플릿의 값을 적용한다.

### 5.4 vmType 상세

#### VZ (macOS 기본, v1.0+)

- macOS 13.0+ 필요
- Apple Virtualization.Framework 기반
- **virtiofs 마운트** 기본 지원 (가장 빠름)
- 크로스 아키텍처 불가 (ARM에서 Intel 불가, 반대도 불가)
- `legacyBIOS: true` 미지원

```yaml
vmType: "vz"
```

#### QEMU

- 모든 플랫폼 지원
- 크로스 아키텍처 가능 (느림)
- 9p, reverse-sshfs 마운트

```yaml
vmType: "qemu"
```

### 5.5 Rosetta (Apple Silicon x86 에뮬레이션)

VZ + aarch64 VM에서 x86_64 바이너리를 실행할 수 있게 한다.

```yaml
vmType: "vz"
arch: "aarch64"      # 반드시 aarch64 (VM 자체는 ARM)
rosetta:
  enabled: true
  binfmt: true       # /proc/sys/fs/binfmt_misc에 rosetta 등록
```

**제약:** VM의 `arch`는 `aarch64`여야 한다. Rosetta는 ARM VM 안에서 x86 바이너리 변환을 제공하는 것이지, x86 VM을 만드는 것이 아니다.

---

## 6. 마운트 상세

### 6.1 마운트 타입

| 타입 | 설명 | 기본 대상 |
|------|------|-----------|
| `virtiofs` | Apple Virtualization Framework | macOS VZ (가장 빠름) |
| `9p` | QEMU virtio-9p-pci | QEMU (v1.0+) |
| `reverse-sshfs` | SFTP over SSH | 레거시 호환 |

VZ를 사용하면 virtiofs가 기본이므로 별도 지정 불필요.

### 6.2 마운트 설정 필드

```yaml
mounts:
  - location: "~/work/project"    # 호스트 경로 (~, 템플릿 변수 지원)
    mountPoint: "/home/user/work" # 게스트 경로 (생략 시 location과 동일)
    writable: false               # 기본: false (read-only)
    # virtiofs 옵션 (없음 - 별도 옵션 불필요)
    # 9p 옵션
    9p:
      securityModel: "none"       # passthrough, mapped-xattr, mapped-file, none
      protocolVersion: "9p2000.L" # 9p2000, 9p2000.u, 9p2000.L
      msize: "128KiB"             # 패킷 크기 (최소 4KiB)
      cache: "mmap"               # none, loose, fscache, mmap
    # sshfs 옵션
    sshfs:
      cache: true
      followSymlinks: false
      sftpDriver: "builtin"       # builtin, openssh-sftp-server
```

### 6.3 개별 파일 마운트

Lima의 마운트는 **디렉토리 단위**가 기본이다.

개별 파일(`~/.netrc` 등)을 직접 마운트할 수 있는지는 마운트 타입에 따라 다르다:

- **virtiofs/9p**: 파일 시스템 레벨 마운트이므로 디렉토리 단위가 기본. 개별 파일 경로를 `location`에 지정할 수는 있으나, 마운트 타입의 구현에 따라 동작이 다를 수 있다.
- **실용적 해결책**: 개별 파일이 필요한 경우, 해당 파일이 속한 디렉토리를 read-only로 마운트하거나 `limactl copy`로 복사한다.

**agentbox에서의 전략:**

```yaml
mounts:
  # 디렉토리 단위 마운트 (안전)
  - location: "~/.codex"
    writable: false
  - location: "~/.claude"
    writable: false
  - location: "~/.config/gh"
    writable: false

  # 개별 파일이 포함된 디렉토리 마운트 또는 홈 전체 RO 마운트
  # ~/.netrc, ~/.gitconfig 등은 홈 디렉토리 RO 마운트로 커버 가능
  - location: "~"
    writable: false
```

또는 `--mount-only` 플래그로 최소한의 마운트만 지정:

```bash
limactl create --name myvm \
  --mount-only "$(pwd):w" \
  --mount "$HOME/.codex" \
  --mount "$HOME/.netrc" \
  template://default
```

### 6.4 마운트 경로 매핑

기본적으로 호스트 경로 = 게스트 경로.

`~` (홈) 마운트 시:
- macOS 호스트: `/Users/username` → 게스트에서도 `/Users/username`
- `mountPoint`를 명시하면 다른 경로로 매핑 가능

```yaml
mounts:
  - location: "/Users/sky1core/work/project"
    mountPoint: "/Users/sky1core/work/project"   # 동일 경로 유지
    writable: true
```

**중요:** workspace를 동일 절대경로로 마운트하면, 에이전트가 보는 경로와 호스트 경로가 동일하여 경로 변환 없이 동작한다. 이는 Docker Sandbox와 동일한 패턴.

### 6.5 마운트 inotify (v0.21.0+)

```yaml
mountInotify: true
```

모든 마운트 타입에서 파일 시스템 이벤트 모니터링을 활성화한다. 실험적 기능.

### 6.6 virtiofs vs 9p vs reverse-sshfs 비교

| 항목 | virtiofs | 9p | reverse-sshfs |
|------|----------|-----|---------------|
| 성능 | 최고 | 중간 | 낮음 |
| 플랫폼 | macOS VZ, Linux (실험적) | QEMU | 모든 플랫폼 |
| inotify | 네이티브 지원 | 중첩 파일 미지원 | 미지원 |
| 설정 복잡도 | 없음 (VZ 기본) | 보안모델/캐시 설정 가능 | SFTP 설정 |
| CentOS/Rocky | 지원 | 미지원 | 지원 |
| 보안 | VM 격리 | securityModel 설정 | SSH 터널 |

**agentbox 권장:** macOS에서는 VZ + virtiofs가 기본. 별도 설정 불필요.

---

## 7. 프로비저닝

### 7.1 프로비저닝 모드

| 모드 | 실행 권한 | 실행 시점 | 용도 |
|------|-----------|-----------|------|
| `boot` | root | cloud-init init 단계 (최초) | 초기 시스템 설정 |
| `dependency` | root | boot 스크립트 후, 패키지 설치 전 | 커스텀 패키지 소스/의존성 |
| `system` | root | dependency 후 | 패키지 설치, 시스템 설정 |
| `user` | 일반 사용자 | system 후 | 사용자 환경 설정 |
| `data` | - | 파일 쓰기 | 설정 파일 배포 |
| `yq` | - | YAML 변환 | 설정 파일 수정 |
| `ansible` | - | (deprecated) | Ansible 플레이북 |

### 7.2 실행 순서

```
boot → dependency → system → user
```

각 단계 내에서는 provision 배열의 순서대로 실행. `base` 템플릿의 provision이 먼저 실행된 후 현재 템플릿의 provision이 concat된다.

### 7.3 예시

```yaml
provision:
  # 시스템 패키지 설치
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      apt-get install -y curl git build-essential

  # Node.js 설치 (snap)
  - mode: system
    script: |
      #!/bin/bash
      set -eux -o pipefail
      snap install node --classic

  # 에이전트 CLI 설치 (사용자 권한)
  - mode: user
    script: |
      #!/bin/bash
      set -eux -o pipefail
      npm install -g @anthropic-ai/claude-code
      npm install -g @openai/codex
      npm install -g @google/gemini-cli

  # 환경 설정
  - mode: user
    script: |
      #!/bin/bash
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bash_profile
```

### 7.4 프로비저닝은 VM 생성 시 1회 실행

provision 스크립트는 `limactl create` (또는 최초 `limactl start`) 시 cloud-init을 통해 **1회만** 실행된다. 이후 start/stop에서는 재실행되지 않는다.

이는 agentbox의 `bootstrap.onCreateScript`와 유사하다. `onStartScript`에 해당하는 것은 Lima에는 없으므로, 매 시작 시 실행이 필요한 작업은 `limactl shell`로 별도 실행해야 한다.

### 7.5 파라미터 (param)

provision 스크립트에서 사용자 정의 파라미터를 참조할 수 있다:

```yaml
param:
  agent: codex

provision:
  - mode: user
    script: |
      echo "Agent: {{.Param.agent}}"
```

`param.env` 파일을 통해 환경변수로도 접근 가능: `PARAM_agent=codex`

---

## 8. 네트워크

### 8.1 기본 동작

Lima VM은 기본적으로 **user-mode 네트워킹**을 사용한다.

| 항목 | 동작 |
|------|------|
| 인터넷 접근 | 가능 (NAT) |
| 호스트 → VM | localhost:{SSH포트}로 SSH 접근 |
| VM → 호스트 | 호스트 게이트웨이 주소 (192.168.5.2 등) |
| VM → VM | 불가 (user-v2로 가능) |
| 외부 → VM | 불가 (bridged network로 가능) |

### 8.2 네트워크 모드

| 모드 | 설명 |
|------|------|
| Default (user-mode) | localhost 기반. 포트포워딩으로 서비스 노출 |
| user-v2 | VM간 통신 가능 |
| vzNAT | VZ 전용. 호스트에서 IP로 VM 접근 가능 |
| socket_vmnet (shared) | QEMU. IP 기반 접근 |
| socket_vmnet (bridged) | 외부 호스트에서 접근 가능 |

### 8.3 포트포워딩

```yaml
portForwards:
  - guestPort: 8080
    hostPort: 8080
    hostIP: "127.0.0.1"   # 기본
  - guestPort: 3000
    hostPort: 13000
  - guestSocket: "/run/docker.sock"
    hostSocket: "/tmp/lima-docker.sock"
```

기본 동작: 명시적 포트포워딩 규칙이 없으면, 게스트의 비특권 포트(1024+)가 loopback에서 자동 포워딩된다.

포워딩 방식:
- **SSH 포워더**: TCP만 (구버전 기본)
- **GRPC 포워더**: TCP + UDP (v1.1+ 기본)

### 8.4 Docker Sandbox 대비 차이점

| Docker Sandbox | Lima |
|----------------|------|
| 모든 트래픽이 host.docker.internal:3128 프록시 경유 | VM이 직접 네트워크 스택 보유. 프록시 없음 |
| DNS 불안정 → 전체 네트워크 마비 위험 | 표준 DNS 동작 |
| 사설 IP 기본 차단 | 제한 없음 (NAS 등 내부 서비스 접근 가능) |
| /etc/hosts 수동 패치 필요 | 불필요 |
| `docker sandbox network proxy` 명시 필요 | 불필요 |

---

## 9. Lima v2.0 AI 에이전트 지원

### 9.1 두 가지 모드

1. **AI Inside Lima**: 에이전트를 VM 안에서 실행 (agentbox가 사용하는 방식)
2. **AI Outside Lima (MCP)**: 외부 에이전트가 Lima의 MCP 도구로 샌드박스 파일 조작

### 9.2 AI Inside Lima 권장 설정

```bash
# 현재 디렉토리만 writable로 마운트 (v2.0+)
limactl start --mount-only .:w

# v1.x 호환
limactl start --set '.mounts=[{"location":"'$(pwd)'", "writable":true}]'
```

### 9.3 공식 지원 에이전트

| 에이전트 | 설치 방법 | 인증 |
|----------|-----------|------|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `ANTHROPIC_API_KEY` 또는 OAuth |
| Codex | `npm install -g @openai/codex` | `OPENAI_API_KEY` |
| Gemini | `npm install -g @google/gemini-cli` | `GEMINI_API_KEY` |
| GitHub Copilot | `npm install -g @github/copilot` | `/login` 또는 `GH_TOKEN` |
| Aider | `pipx install aider-install && aider-install` | 인터랙티브 또는 env |
| OpenCode | `npm install -g opencode-ai` | `/connect` |

### 9.4 --sync 플래그 (v2.1+)

```bash
limactl shell --sync . default claude "Add error handling"
```

VM 안에서 에이전트가 수정한 파일을 호스트로 동기화하기 전에 인터랙티브하게 검토할 수 있다. **마운트를 사용하지 않는** 시나리오에서 유용 (mount-none + sync).

---

## 10. agentbox 전환 시 매핑 요약

### 명령어 매핑

| agentbox 현재 (Docker Sandbox) | Lima 대응 |
|-------------------------------|-----------|
| `docker sandbox ls` (파싱) | `limactl list --json` |
| `docker sandbox create --name X agent ws` | `limactl create --name X template.yaml` |
| `docker sandbox run X` | `limactl start X` |
| `docker sandbox stop X` | `limactl stop X` |
| `docker sandbox exec -it -w ws X cmd` | `limactl shell --workdir ws X -- cmd` |
| `docker sandbox exec -e K=V X cmd` | `limactl shell X -- env K=V cmd` |
| `docker sandbox exec -i X sh -c 'cat > f'` | `limactl copy file X:dest` |

### 핵심 차이

1. **`--format` 지원**: JSON 출력을 파싱할 필요 없이 구조화된 데이터 제공
2. **env 전달**: `-e` 플래그 대신 `env K=V` 명령어 래핑 또는 `--preserve-env`
3. **파일 주입**: stdin 파이핑 대신 `limactl copy` 또는 마운트로 대체
4. **실행 모드 통일**: run/exec 이원화 없이 `limactl shell`로 통일
5. **마운트 기반 credential**: 매 시작마다 복사할 필요 없이 read-only 마운트로 해결

---

## 참고 자료

- Lima 공식 문서: https://lima-vm.io/docs/
- Lima GitHub: https://github.com/lima-vm/lima
- default.yaml 템플릿: https://github.com/lima-vm/lima/blob/master/templates/default.yaml
- limactl 명령어 레퍼런스: https://lima-vm.io/docs/reference/limactl/
- Lima v2.0 AI 워크플로우: https://www.cncf.io/blog/2025/12/11/lima-v2-0-new-features-for-secure-ai-workflows/
- AI 에이전트 예제: https://lima-vm.io/docs/examples/ai/
