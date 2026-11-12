# 온라인 MCP

AirDesk 서버가 네이티브 stdio 프로세스가 아니라 온라인 게이트웨이일 때는 첫 도구 호출 전에 이
문서를 읽으세요. [SKILL.md](../SKILL.md)의 모든 내용은 그대로 적용되며, 이 문서는 온라인에서
달라지는 점을 더합니다.

## 온라인 모드의 동작 방식

- 엔드포인트: `https://mcp.airdesk.co.kr/mcp`, 상태 없는(stateless) Streamable HTTP.
- 호출은 그것을 보낸 휴대폰, 브라우저, 클라우드 에이전트에서 실행되지 않습니다. 게이트웨이가 각
  호출을 같은 계정의 **브리지 PC**로 전달합니다. 브리지 PC가 *컨트롤러*입니다. 소유자는 AirDesk에
  로그인하고 현재 AI 추가약관에 동의한 뒤 **AI가 원격 컴퓨터 사용(MCP)**과 **온라인 MCP**를 켭니다.
- Windows에 설치한 AirDesk 1.0.71 이상에서는 활성 Windows 콘솔 세션에 사용자가 로그인한 동안
  `AirdeskService`가 브리지를 실행합니다. AirDesk 창을 닫아도 브리지는 유지됩니다. Windows에서
  로그아웃하거나 서비스를 중지하면 브리지가 종료됩니다.
- macOS, Windows 포터블 및 이전 Windows용 AirDesk에서는 앱이 브리지를 실행하므로 AirDesk를 켜 둡니다.
- 도구 목록에 `local_*` 도구가 없거나 `initialize` 안내문이 온라인 게이트웨이를 설명하면 온라인
  모드입니다. 클라이언트 이름으로 모드를 짐작하지 마세요.

## 로그인

- **OAuth**(권장): Claude와 ChatGPT 커넥터, Claude Code, Codex(`codex mcp login airdesk`),
  VS Code, Cursor, OpenCode, Gemini CLI는 AirDesk 동의 페이지를 엽니다. AirDesk 계정에
  로그인하고 계정 설정에 따라 필요한 2단계 인증을 완료하세요. 권한 범위, 만료, 허용할 컴퓨터와
  필요할 경우 브리지 PC를 선택한 뒤 브라우저에서 승인하세요.
- **API 키**: 계정 소유자가 마이페이지 → API 키에서 `amk_...` 키를 만들고(2단계 인증 필요),
  환경 변수 `AIRDESK_MCP_KEY`나 클라이언트의 비밀 입력란으로 전달합니다.
- 채팅으로 키, 비밀번호, 2단계 인증 코드를 요청하지 마세요. 출력, 저장, 기록, 전달하지 마세요.
  서버가 `MCP_KEY_INVALID`를 반환하면 사용자에게 다시 로그인하거나 클라이언트의 키를 바꾸도록
  요청하고, 반복 재시도하지 마세요.

## 권한 범위(scope)

| 범위 | 허용되는 작업 |
| --- | --- |
| `observe` | 탐색, 상태, `hostId`로 연결, 스크린샷, 스냅샷, find/get/is, `remote_desktop_safari_list_controls`를 포함한 목록, wait, `remote_performance_diagnostics` |
| `input` | 그 밖의 모든 `remote_desktop_*` 작업(클릭, 입력, 키, 드래그, 스크롤, 앱 이름만으로 실행, 클립보드, 권한, 트레이스 내보내기, 세션 도구, 커서 오버레이), `remote_debug_mode`, 9자리 원격 ID로 연결 |
| `terminal` | `terminal_*`, 셸이나 스크립트 호스트 실행 또는 `args`가 있는 실행 |

`tools/list`에는 현재 권한으로 쓸 수 있는 도구가 나옵니다. 갱신된 온라인 도구 목록은
`observe` 권한에도 `remote_desktop_batch`를 표시합니다. 게이트웨이는 배치에 담긴 각
명령의 범위를 검사합니다. 관찰만 묶은 배치에는 `observe`가 필요하고, 입력이나 터미널
명령이 포함된 배치에는 해당 범위도 필요합니다. 현재 게이트웨이에서 배치가 표시되지
않으면 목록에 나온 개별 도구를 호출하세요. `MCP_SCOPE_REQUIRED`는 부족한 범위를
알려줍니다. 작업에 필요한 범위를 사용자에게 알리고 다시 승인하거나 새 키를 만들게
하세요. 낮은 범위의 도구로 같은 효과를 내지 마세요. 예를 들어 `input`만 있을 때
GUI 터미널에 명령을 입력하지 마세요.

## 브리지 PC 추가 확인

첫 `remote_connect` 전에 `remote_status`에서 SKILL의 컨트롤러 불리언이 true여야 합니다. 이 값은
**브리지 PC**를 나타냅니다. 그다음:

- `BRIDGE_OFFLINE`: 게이트웨이가 브리지에 연결하지 못했습니다. 소유자에게 PC의 절전 상태와 위 실행
  조건을 확인해 달라고 요청하세요. Windows 서비스 설치본에서는 콘솔 로그인과 `AirdeskService` 상태를,
  앱이 브리지를 실행하는 환경에서는 AirDesk 실행 상태를 확인합니다. 과금되지 않습니다. 반복해서
  확인하지 말고 소유자가 준비를 확인한 뒤에 다시 시도하세요.
- `BRIDGE_AMBIGUOUS`: 브리지 PC가 여러 대 온라인이고 권한이 한 대로 고정되어 있지 않습니다.
  동의 화면이나 키 생성 화면에서 PC를 지정하도록 요청하세요.
- `MCP_MODE_DISABLED` / `MCP_ONLINE_DISABLED`: MCP 모드나 온라인 MCP가 꺼져 있거나, 계정에서 아직
  온라인 MCP를 쓸 수 없습니다. 소유자에게 요청하고, 직접 켜지 마세요.
- 브리지 PC 소유자는 온라인 호출에 쓸 수 없는 도구를 지정할 수 있습니다. 기본값은
  `remote_desktop_launch`라서 앱 실행은 보통 `BRIDGE_REJECTED` "This tool is turned off on this
  PC for online MCP."로 응답합니다. 시작 메뉴, 실행 대화상자, 단축키 같은 다른 입력으로 그 도구를
  흉내 내지 말고 소유자에게 요청하세요.
- 대상의 호스트 승인과 원격 터미널은 로컬 모드와 똑같이 대상 소유자의
  설정입니다. 게이트웨이는 이를 증명하지 않습니다.

## 온라인 제한 사항

- **강제 단축키.** 온라인에서 `remote_desktop_press`와 `remote_desktop_key_down`에
  `force:true`를 쓰면 `BRIDGE_REJECTED`가 반환됩니다. `remote_desktop_batch` 내부와
  `terminal` 권한에도 같은 규칙이 적용됩니다.

- **창 필수.** `remote_connect`는 `video:true`와 `showWindow:true`를 유지해야 하며, `false`면
  `WINDOW_REQUIRED`가 반환됩니다. 온라인에서는 헤드리스 작업을 쓸 수 없습니다. 원격 창은 사용자의
  휴대폰이 아니라 **브리지 PC**에 열립니다. 사용자가 브리지 PC 앞에 없으면, 그 자리에 있는 사람이
  창을 보고 조작할 수 있다는 점을 알리고, 내 관찰은 스크린샷과 스냅샷에 의존하세요.
- **금지된 인자.** 갱신된 온라인 도구 스키마에서 `output_path`, `out`, `image`, `file_url`,
  `pointer_image`, `cwd`, `env`, `cdp`가 제외됩니다. 게이트웨이는 배치 내부를 포함해
  모든 범위에서 이 인자를 계속 거부합니다(`MCP_ARGUMENT_NOT_ALLOWED`). 결과를 응답으로
  받고, 파일을 쓰는 다른 방법을 찾지 마세요.
- **기기 제한.** 사용자는 허용 대상 컴퓨터와 고정할 브리지 PC를 각각 지정할 수 있습니다. 대상 목록을
  지정한 경우 `remote_list_computers`에 표시된 허용 대상의 정확한 `hostId`를 사용하세요. 9자리 원격 ID나
  목록에 없는 대상은 `MCP_HOST_NOT_ALLOWED`로 거부됩니다. 기존 세션이나 그 세션의 터미널에 대한 요청은
  기록된 대상과 브리지를 권한에 설정된 제한과 대조합니다. 필요한 기기 정보가 없거나 일치하지 않으면
  `MCP_SESSION_NOT_OWNED`가 반환됩니다. 권한이나 네트워크 범위 밖의 세션은 상태와 탐색 결과에 표시되지 않습니다.
- **네트워크 변경 후 재연결.** 브리지 PC마다 활성 원격 세션은 하나입니다. 처음 연결한 네트워크를 확인할 수
  있으면 세션 ID가 그 네트워크에 묶입니다.
  Wi-Fi와 모바일 데이터를 전환한 뒤 `MCP_SESSION_NOT_OWNED`가 반환되면 `remote_status`를 확인하고
  승인된 대상을 다시 찾으세요. 기기 제한이 있는 권한으로 다른 네트워크에서 다시 연결할 때는, 이전 세션의
  확인된 대상이 요청한 정확한 `hostId`와 일치하고 이전 세션에 기록된 브리지가 이번 재연결에서 확인된
  브리지와 일치하는 경우에만 이전 세션이 자동 정리될 수 있습니다. 기기 제한이 없는 권한은 계정의 다른
  네트워크 세션도 정리할 수 있습니다. 소유권이 불분명하거나 다른 클라이언트가 세션을 사용 중이면 소유자가
  처리할 때까지 기다리세요. 새 `sessionId`를 사용하고 터미널 ID와 요소 참조를 다시 확인하세요.

## 시간, 크기, 비용

- 호출당 약 55초가 주어집니다. `BRIDGE_TIMEOUT`과 `REGION_UNAVAILABLE`은 아무 일도 없었다는
  증거가 아닙니다. 변경 작업을 반복하기 전에 관찰하세요.
- 약 5 MiB까지의 결과는 응답에 바로 담깁니다. 스크린샷보다 `remote_desktop_snapshot`과 `find`를
  먼저 쓰고, 스크린샷은 필요한 만큼만 작게 요청하세요.
- `remote_list_computers`, `remote_status`, `remote_disconnect`, `tools/list`를 제외한 호출은
  과금됩니다. 배치는 명령마다 셉니다. Free는 월 500회, Pro는 5,000회, Teams는 좌석당 5,000회가
  포함됩니다.
- `RATE_LIMITED`, `QUOTA_EXHAUSTED`, `MCP_BUSY`에는 재시도 시간이 있습니다. 최소 그만큼 기다리고,
  몇 번만 재시도하세요. 월 사용량이나 `MCP_SPEND_CAP` 때문에 작업이 멈추면 사용자에게 알리세요.
- `MCP_RESULT_DELIVERED`는 같은 요청의 결과가 이미 한 번 반환되었다는 뜻입니다. 현재 상태를 다시
  관찰하세요.

## 오류 코드

| 코드 | 의미 | 할 일 |
| --- | --- | --- |
| `MCP_KEY_INVALID` (401) | 로그인 없음, 만료, 폐기 | 다시 로그인하도록 요청 |
| `MCP_SCOPE_REQUIRED` (403) | 권한에 `scope`가 없음 | 표시된 범위를 요청 |
| `MCP_ONLINE_DISABLED` (403) | 계정에서 온라인 MCP를 쓸 수 없음 | 멈추고 설명 |
| `BRIDGE_OFFLINE` / `BRIDGE_AMBIGUOUS` | 브리지 PC 없음 / 여러 대인데 미지정 | 브리지 PC 확인 참고 |
| `WINDOW_REQUIRED` | 헤드리스 연결 시도 | 창을 켠 채 다시 연결 |
| `MCP_ARGUMENT_NOT_ALLOWED` | 금지된 인자 | 인자를 빼고 응답으로 받기 |
| `MCP_HOST_NOT_ALLOWED` | 권한 밖의 컴퓨터 | 사용자에게 확인 |
| `MCP_SESSION_NOT_OWNED` | 세션 종료, 네트워크 변경 또는 권한 제한 | 상태·대상·브리지를 확인한 뒤 승인된 재연결 진행 |
| `already_connected` | 선택한 브리지가 이미 세션을 사용 중 | 직접 열지 않은 세션은 소유자에게 처리 요청 |
| `BRIDGE_REJECTED` | 브리지 PC가 거부(차단 목록, 인자, 계정) | 메시지를 전하고 소유자에게 요청 |
| `BRIDGE_TIMEOUT` / `REGION_UNAVAILABLE` | 제시간에 응답 없음 | 재시도 전에 관찰 |
| `RATE_LIMITED` / `QUOTA_EXHAUSTED` / `MCP_BUSY` / `MCP_SPEND_CAP` | 한도 | 위 설명대로 기다리거나 멈춤 |
