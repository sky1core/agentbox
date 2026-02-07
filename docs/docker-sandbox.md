# Docker Sandbox 핵심 지식

이 문서는 Docker Sandbox를 다루는 AI 에이전트가 반드시 알아야 할 기술적 사실을 정리한다.

## 아키텍처

```
호스트 macOS
 └─ Docker Desktop (sandboxd 데몬)
     └─ microVM (전용 Linux 커널, Ubuntu 25.10)
         └─ 에이전트 컨테이너
             ├─ 이미지 내 config로 approval-free
             ├─ 워크스페이스: 호스트와 동일 경로로 양방향 동기화
             ├─ 유저: agent (uid 1000, sudo/docker 권한)
             └─ 네트워크: HTTP/HTTPS 프록시 경유
```

- **microVM이다, 컨테이너가 아니다.** 전용 Linux 커널을 가진 가상머신.
- Docker Desktop 4.58+, sandbox 플러그인 v0.11.0+ 필요.

## 승인 프롬프트 없는 자율 동작 원리

**Docker가 자동으로 `--dangerously-skip-permissions` 플래그를 붙여주는 것이 아니다.**

sandbox 이미지 안에 에이전트 설정 파일이 미리 들어있다:

- **Codex**: `~/.codex/config.toml` → `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`
- **Claude Code**: 이미지 내 settings에 해당 설정 포함

이미지 자체가 격리된 환경 전제로 만들어져 있어서 별도 플래그 없이 자율 동작한다.

## 인증 모델

**API 키(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)는 사용하지 않는다.**

| 에이전트 | 인증 방식 | 명령 |
|---------|----------|------|
| Claude Code | 구독(Pro) + setup-token | `docker sandbox run <name> -- --setup-token <TOKEN>` |
| Codex | 구독(Plus) + 내부 로그인 | `docker sandbox exec -it <name> codex` → 로그인 진행 |
| Kiro | 구독 + 내부 로그인 | `docker sandbox run <name>` → 로그인 진행 |
| Gemini | Google 계정 로그인 | `docker sandbox exec -it <name> gemini` → 로그인 진행 |

- 인증 세션은 microVM 디스크에 저장. sandbox를 **삭제하지 않는 한** 유지.
- `stop` → 재시작해도 인증 유지.
- `docker sandbox rm`하면 인증 소실 → 재인증 필요.

## 동기화 범위

| 영역 | 동기화 | 비고 |
|------|--------|------|
| 워크스페이스 (WORKSPACE 경로) | 양방향 실시간 | 호스트와 동일 절대 경로 |
| 홈 디렉토리 (`/home/agent/`) | X | sandbox 내부에만 존재 |
| 설치한 패키지 | X | sandbox 삭제 시 소실 |
| 에이전트 대화 기록 | X | sandbox 삭제 시 소실 |

**핵심**: `~/.netrc`, `~/.config/` 같은 홈 디렉토리 파일은 동기화 안 됨 → 스크립트에서 명시적으로 복사해야 함.

## 네트워크

- 기본 정책: `allow` (대부분 허용)
- **사설 IP 대역 (`192.168.0.0/16` 등) 기본 차단**
- NAS, Tailscale 등 사설 네트워크 접근이 필요하면 명시적 허용:

```bash
docker sandbox network proxy <name> \
  --allow-host <private-ip> \
  --allow-host <hostname>
```

- 정책 파일: `~/.docker/sandboxes/vm/<name>/proxy-config.json`
- 로그 확인: `docker sandbox network log <name>`

## docker sandbox CLI 레퍼런스

```bash
# 생성 + 실행
docker sandbox run --name <name> <agent> <workspace>

# 기존 sandbox 실행
docker sandbox run <name>

# 에이전트에 인자 전달 (-- 뒤에)
docker sandbox run <name> -- --continue
docker sandbox run <name> -- -p "프롬프트"

# sandbox 안에서 명령 실행
docker sandbox exec -it -w <workspace> <name> <command>
docker sandbox exec -i <name> sh -c 'cat > file' < input   # stdin 파이핑

# 관리
docker sandbox ls                    # 목록
docker sandbox stop <name>           # 정지 (상태 유지)
docker sandbox rm <name>             # 삭제 (전부 소실)
docker sandbox reset                 # 전체 리셋
```

## 알려진 함정

1. **`docker sandbox ls --format` 미지원**: Go template 포맷 플래그 없음. awk 파싱 필요.
2. **`docker sandbox exec` stdin**: `-i` 플래그 없으면 stdin이 연결 안 됨 → 파이프 데이터가 0바이트.
3. **에이전트 타입 고정**: codex로 만든 sandbox에 claude를 넣을 수 없음. 에이전트별 별도 sandbox.
4. **동시 편집 충돌**: 호스트와 sandbox에서 동시에 같은 파일 수정 시 충돌 가능.
5. **sandbox 디스크**: 각 microVM의 `Docker.raw`가 ~1TB sparse file. 실제 사용량은 적음.
6. **Codex resume 명령어**: `codex exec resume --last` (X) → `codex resume --last` (O). resume은 top-level 서브커맨드.

## 설정 파일 위치

| 파일 | 용도 |
|------|------|
| `~/.sandboxd/proxy-config.json` | 전역 기본 네트워크 정책 |
| `~/.docker/sandboxes/vm/<name>/proxy-config.json` | 개별 sandbox 네트워크 정책 |
| `~/.docker/sandboxes/vm/<name>/metadata.json` | sandbox 메타데이터 |
| `~/.docker/sandboxes/vm/<name>/Docker.raw` | microVM 디스크 이미지 |

## 참고 링크

- [Docker Sandboxes 공식 문서](https://docs.docker.com/ai/sandboxes/)
- [시작 가이드](https://docs.docker.com/ai/sandboxes/get-started/)
- [Claude Code 설정](https://docs.docker.com/ai/sandboxes/claude-code/)
- [지원 에이전트 목록](https://docs.docker.com/ai/sandboxes/agents/)
- [네트워크 정책](https://docs.docker.com/ai/sandboxes/network-policies/)
- [Docker 블로그: Sandboxes 소개 (2026-01-30)](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
