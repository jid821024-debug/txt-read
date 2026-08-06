# 이어읽기 — 개인용 TXT 뷰어

PC, 모바일, 태블릿에서 같은 계정으로 로그인하여 TXT 문서를 읽고, 마지막 읽은 위치부터 이어서 볼 수 있는 개인용 PWA입니다.

초기 버전은 별도의 빌드 과정이 없는 **정적 웹앱 + Supabase** 방식입니다. 파일을 수정한 뒤 정적 웹 호스팅에 올리면 바로 사용할 수 있습니다.

## 포함 기능

- 이메일 + 비밀번호 로그인
- 신규 회원가입 화면 없음
- TXT 업로드
- UTF-8 / EUC-KR / CP949 자동 감지 및 직접 선택
- 문서를 문단 단위로 분리해 저장
- 문단 번호 + 문단 안의 글자 위치 저장
- PC·모바일·태블릿 읽기 위치 동기화
- 글자 크기, 줄 간격, 본문 폭, 화면 모드 동기화
- 문서 검색
- 화면 꺼짐 방지 선택
- PWA 홈 화면 설치
- 최근 열어본 문서 5개의 오프라인 캐시
- 오프라인 중 읽기 위치 기기 저장 및 재연결 시 동기화
- 같은 내용의 문서 중복 등록 방지

## 폴더 구성

```text
continue-reader-pwa/
├─ index.html
├─ app.js
├─ styles.css
├─ config.js                 ← Supabase 주소와 공개키 입력
├─ config.example.js
├─ manifest.webmanifest
├─ sw.js
├─ vercel.json
├─ icons/
│  ├─ icon-192.png
│  ├─ icon-512.png
│  └─ maskable-512.png
└─ supabase/
   └─ schema.sql             ← Supabase SQL Editor에서 실행
```

---

# 1. Supabase 프로젝트 만들기

1. Supabase에 로그인합니다.
2. 새 프로젝트를 생성합니다.
3. 프로젝트가 준비되면 왼쪽 메뉴에서 **SQL Editor**를 엽니다.
4. `supabase/schema.sql` 파일의 전체 내용을 복사합니다.
5. SQL Editor에 붙여넣고 **Run**을 누릅니다.

다음 테이블이 생성됩니다.

- `documents`: 문서 정보
- `document_blocks`: 문서 본문
- `reading_progress`: 마지막 읽은 위치
- `reader_settings`: 글자 크기 등 읽기 설정

모든 테이블에 RLS가 적용되어 로그인한 본인 데이터만 조회할 수 있습니다.

---

# 2. 본인 계정 하나 만들기

Supabase 대시보드에서 다음 순서로 생성합니다.

1. **Authentication → Users**로 이동합니다.
2. **Add user**를 누릅니다.
3. 사용할 이메일과 비밀번호를 입력합니다.
4. 가능하면 **Auto Confirm User**를 선택해 바로 로그인 가능하게 만듭니다.

그다음 신규 가입을 막습니다.

1. **Authentication → Settings 또는 Providers → Email**로 이동합니다.
2. **Allow new users to sign up**을 끕니다.

앱 자체에는 회원가입 기능이 없으므로 Supabase에서 만든 계정만 로그인할 수 있습니다.

---

# 3. config.js 설정

Supabase 대시보드에서 프로젝트 주소와 공개키를 확인합니다.

일반적으로 다음 메뉴에 있습니다.

- **Project Settings → API**
- Project URL
- Publishable key 또는 anon public key

`config.js`를 메모장이나 Visual Studio Code로 열고 다음처럼 변경합니다.

```javascript
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "여기에_publishable_또는_anon_공개키"
};
```

## 주의

- `service_role` 키는 절대 넣지 마십시오.
- 웹 브라우저에는 공개용 `publishable` 또는 `anon` 키만 사용합니다.
- 실제 데이터 보호는 `schema.sql`에 포함된 RLS 정책으로 처리합니다.

---

# 4. PC에서 먼저 시험하기

`index.html`을 더블클릭하지 말고 간단한 웹서버로 실행해야 합니다. 서비스 워커와 PWA 기능은 `file://` 주소에서 정상 작동하지 않습니다.

## Windows에서 Python이 설치된 경우

PowerShell 또는 명령 프롬프트에서 프로젝트 폴더로 이동한 뒤 실행합니다.

```powershell
python -m http.server 8080
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:8080
```

Supabase에서 만든 이메일과 비밀번호로 로그인합니다.

## 시험 순서

1. TXT 파일을 등록합니다.
2. 문서를 열고 중간까지 읽습니다.
3. 브라우저를 닫았다 다시 열어 이어 읽기가 되는지 확인합니다.
4. 다른 브라우저 또는 휴대폰에서 같은 계정으로 로그인합니다.
5. 같은 위치로 이동하는지 확인합니다.

---

# 5. 인터넷에 배포하기

모바일과 태블릿에서 사용하려면 HTTPS 주소에 배포하는 것이 좋습니다. PWA 설치와 서비스 워커는 HTTPS 환경에서 정상 동작합니다. `localhost`는 개발용 예외입니다.

## Vercel 사용 방법

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 **Add New Project**를 선택합니다.
3. 해당 GitHub 저장소를 연결합니다.
4. Framework Preset은 **Other** 또는 자동 감지를 사용합니다.
5. 별도 Build Command 없이 배포합니다.
6. 생성된 `https://...vercel.app` 주소로 접속합니다.

`vercel.json`이 포함되어 있어 정적 파일로 배포할 수 있습니다.

## 다른 정적 호스팅도 가능

- Netlify
- Cloudflare Pages
- GitHub Pages
- 사내 HTTPS 웹서버

정적 파일 전체가 같은 폴더 구조로 올라가면 됩니다.

---

# 6. 모바일·태블릿에 앱처럼 설치하기

## Android Chrome

1. 배포 주소로 접속합니다.
2. 브라우저 메뉴를 누릅니다.
3. **앱 설치** 또는 **홈 화면에 추가**를 누릅니다.

설치 조건이 충족되면 서재 화면 위쪽에 `앱 설치` 버튼도 표시될 수 있습니다.

## iPhone / iPad Safari

1. Safari에서 배포 주소를 엽니다.
2. 공유 버튼을 누릅니다.
3. **홈 화면에 추가**를 선택합니다.

---

# 읽기 위치 저장 방식

스크롤 높이만 저장하면 PC와 모바일의 화면 크기가 달라 위치가 어긋납니다. 이 앱은 다음 값을 저장합니다.

```text
문서 ID
문단 번호
문단 안의 글자 위치
전체 진행률
저장 시간
기기 ID
```

현재 화면 위쪽에 표시되는 글자를 브라우저의 caret 위치 API로 찾아 저장합니다. 지원하지 않는 브라우저에서는 문단 안의 상대 위치를 계산하는 방식으로 보완합니다.

읽기 위치는 다음 시점에 저장됩니다.

- 스크롤이 멈춘 약 1.1초 후
- 15초마다
- 서재로 돌아갈 때
- 탭이나 앱이 백그라운드로 전환될 때
- 브라우저가 닫히기 직전 기기 내부 저장

---

# 오프라인 동작

문서를 한 번 온라인에서 열면 본문을 IndexedDB에 저장하며, 최근에 열어본 문서 5개를 유지합니다.

- 인터넷이 끊겨도 최근에 열었던 문서를 읽을 수 있습니다.
- 오프라인 중 읽은 위치는 기기 내부에 저장됩니다.
- 인터넷이 다시 연결되면 서버에 최신 위치를 동기화합니다.
- 처음 한 번도 열지 않은 문서는 오프라인에서 열 수 없습니다.

서비스 워커가 앱 화면 파일과 Supabase 브라우저 SDK를 캐시합니다. 앱을 처음 설치한 뒤 한 번 새로고침하면 오프라인 준비가 더 안정적입니다.

---

# TXT 파일 제한

- 파일 확장자: `.txt`
- 최대 크기: 20MB
- 지원 인코딩: UTF-8, UTF-8 BOM, EUC-KR, CP949
- 긴 문단은 약 1,200자 단위로 자동 분리
- 동일한 내용은 중복 등록 불가

매우 큰 TXT 파일은 모바일 메모리와 업로드 속도에 영향을 줄 수 있으므로 가능하면 5MB 이하로 나누는 것을 권장합니다.

---

# 문제 해결

## 초기 설정 화면만 표시되는 경우

`config.js`의 아래 두 값을 확인합니다.

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

따옴표, 쉼표 또는 주소 오타도 확인합니다.

## 로그인할 수 없는 경우

- Supabase **Authentication → Users**에 계정이 있는지 확인합니다.
- 이메일이 Confirmed 상태인지 확인합니다.
- 비밀번호를 다시 설정합니다.
- 브라우저 개발자 도구 Console에서 오류를 확인합니다.

## 문서 목록이 비어 있는 경우

`schema.sql` 실행 여부와 RLS 정책을 확인합니다. Supabase SQL Editor에서 다음 테이블이 있는지 확인합니다.

```text
documents
document_blocks
reading_progress
reader_settings
```

## 한글이 깨지는 경우

업로드 화면의 인코딩을 `EUC-KR / CP949`로 직접 선택한 뒤 다시 등록합니다.

## 수정한 config.js가 반영되지 않는 경우

기존 서비스 워커 캐시 때문일 수 있습니다.

1. 브라우저 개발자 도구를 엽니다.
2. Application → Service Workers에서 Unregister합니다.
3. Storage 또는 Clear site data를 실행합니다.
4. 페이지를 다시 엽니다.

또는 배포 후 `sw.js`의 `CACHE_NAME` 값을 `continue-reader-v2`처럼 변경합니다.

---

# 보안 체크

- Supabase `service_role` 키를 브라우저 파일에 넣지 않기
- 신규 회원가입 비활성화
- 본인 계정에 강한 비밀번호 사용
- HTTPS 주소로 배포
- 공용 PC에서는 사용 후 로그아웃
- 민감한 업무 문서는 회사 보안정책 확인 후 등록

---

# 다음 버전에서 추가 가능한 기능

- TTS 음성 읽어주기 및 음성 위치 동기화
- 책갈피와 메모
- 문장 형광펜
- 자동 스크롤
- EPUB 지원
- Word 및 PDF 텍스트 변환
- 문서 폴더 분류
- 학습시간 통계

## 공식 참고 문서

- Supabase Password Auth: https://supabase.com/docs/guides/auth/passwords
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase JavaScript 설치: https://supabase.com/docs/reference/javascript/installing
- PWA 개요: https://developer.mozilla.org/docs/Web/Progressive_web_apps
