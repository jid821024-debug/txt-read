# 이어읽기 v3 — TXT·EPUB 개인용 음성 책읽기

PC, 모바일, 태블릿에서 같은 계정으로 로그인하여 TXT와 EPUB 문서를 읽고, 마지막 위치부터 이어 보거나 기기 내장 음성으로 들을 수 있는 개인용 PWA입니다.

## v3 주요 기능

- TXT 및 DRM 없는 EPUB 업로드
- EPUB 제목·저자·표지 자동 추출
- EPUB 목차 표시와 장별 이동
- 다음 문단·다음 장 연속 음성 읽기
- 문단 번호와 문단 안 글자 위치 저장
- PC·모바일·태블릿 읽기 위치 동기화
- 재생·일시정지·정지·약 15초 앞뒤 이동
- 0.6배~2.0배 속도 조절 및 기기 음성 선택
- 읽는 문단 자동 강조와 화면 이동
- 문서 검색, 글자 크기, 줄 간격, 본문 폭, 화면 모드
- 최근 열어본 문서 5개 오프라인 캐시
- 화면 켜짐 유지 선택과 백그라운드 재생 보조
- 같은 파일 내용 중복 등록 방지

## 지원 파일

### TXT

- 확장자: `.txt`
- 최대 크기: 20MB
- UTF-8, UTF-8 BOM, EUC-KR, CP949

### EPUB

- 확장자: `.epub`
- 최대 크기: 50MB
- EPUB 2의 NCX 목차와 EPUB 3의 Navigation Document 목차 지원
- 일반적인 XHTML 본문, 제목, 문단, 목록, 인용문, 표의 텍스트 추출
- 표지 이미지가 900KB 이하인 경우 서재 표지로 저장
- DRM 또는 일반 암호화가 적용된 EPUB은 지원하지 않음

교보문고, 리디북스, 밀리의서재 등 전용 앱에서만 열리는 구매 전자책은 대부분 DRM이 적용되어 있어 이 앱에서 열 수 없습니다. 직접 만든 EPUB이나 DRM이 없는 공개 EPUB을 사용해야 합니다.

## 폴더 구성

```text
continue-reader-pwa/
├─ index.html
├─ app.js
├─ styles.css
├─ config.js
├─ config.example.js
├─ manifest.webmanifest
├─ sw.js
├─ vercel.json
├─ audio/
│  └─ silence.wav
├─ vendor/
│  ├─ jszip.min.js
│  └─ JSZip-LICENSE.md
├─ icons/
│  ├─ icon-192.png
│  ├─ icon-512.png
│  └─ maskable-512.png
└─ supabase/
   ├─ schema.sql
   └─ migration_v3_epub.sql
```

# 기존 v2에서 업데이트

업데이트 순서가 중요합니다.

1. Supabase 대시보드에서 **SQL Editor**를 엽니다.
2. `supabase/migration_v3_epub.sql` 전체 내용을 붙여넣습니다.
3. **Run**을 눌러 EPUB용 열을 추가합니다.
4. 덮어쓰기용 압축파일의 내용을 기존 웹앱 폴더에 덮어씁니다.
5. 기존 `config.js`는 그대로 유지합니다.
6. 웹 호스팅에 변경 파일을 다시 배포합니다.
7. 앱을 완전히 종료한 뒤 다시 열거나 브라우저에서 새로고침합니다.

기존 TXT 문서와 읽기 기록은 삭제되지 않습니다.

# 처음 설치

## 1. Supabase 데이터베이스 생성

Supabase **SQL Editor**에서 `supabase/schema.sql` 전체를 실행합니다.

생성되는 주요 테이블은 다음과 같습니다.

- `documents`: 제목, 저자, 파일 형식, 표지, 목차 등
- `document_blocks`: 장과 문단별 본문
- `reading_progress`: 마지막 문단과 글자 위치
- `reader_settings`: 글자 크기 등 읽기 설정

모든 테이블에 RLS가 적용되어 로그인한 본인 데이터만 조회할 수 있습니다.

## 2. 계정 생성

1. Supabase **Authentication → Users**로 이동합니다.
2. 사용할 이메일과 비밀번호 계정을 만듭니다.
3. 가능하면 **Auto Confirm User**를 선택합니다.
4. **Allow new users to sign up**을 꺼서 임의 회원가입을 막습니다.

## 3. config.js 입력

```javascript
window.APP_CONFIG = {
  SUPABASE_URL: "https://프로젝트.supabase.co",
  SUPABASE_ANON_KEY: "공개 publishable 또는 anon 키"
};
```

`service_role` 키는 브라우저 파일에 넣으면 안 됩니다.

## 4. PC에서 시험

`index.html`을 직접 더블클릭하지 말고 간단한 웹서버로 실행합니다.

```powershell
python -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다.

## 5. 배포

폴더 전체를 Vercel, Netlify, Cloudflare Pages, GitHub Pages 또는 사내 HTTPS 웹서버에 배포할 수 있습니다. 별도 빌드 과정은 없습니다.

# EPUB 처리 방식

EPUB 업로드 시 앱은 다음 순서로 처리합니다.

1. ZIP 구조와 `META-INF/container.xml` 확인
2. OPF에서 제목, 저자, 표지, 본문 순서 확인
3. EPUB 3 Navigation Document 또는 EPUB 2 NCX 목차 분석
4. spine 순서대로 XHTML 본문 추출
5. 장 제목과 문단을 약 1,200자 단위로 분리
6. 목차 항목과 첫 문단 위치 연결
7. Supabase에 저장하고 최근 문서는 오프라인 캐시에 보관

이미지 중심 만화책, 고정 레이아웃 EPUB, 수식, 세로쓰기, 복잡한 각주·표는 원본 모양이 유지되지 않을 수 있습니다. 이 앱은 텍스트 읽기와 음성 듣기에 맞춰 본문을 단순화합니다.

# 문제 해결

## EPUB 등록 시 데이터베이스 항목이 없다는 메시지

`supabase/migration_v3_epub.sql`을 실행하지 않은 상태입니다. SQL을 먼저 실행한 뒤 앱을 다시 엽니다.

## EPUB이 손상되었다는 메시지

확장자만 EPUB으로 바꾼 파일이거나 필수 OPF/container 파일이 없는 경우입니다. 다른 EPUB 뷰어에서도 열리는지 확인합니다.

## DRM 또는 암호화 메시지

앱에서 해제할 수 없는 보호 파일입니다. DRM 없는 EPUB 원본이 필요합니다.

## 수정 파일이 반영되지 않음

v3에서는 서비스 워커 캐시 이름이 `continue-reader-v3`으로 변경되었습니다. 그래도 이전 화면이 보이면 다음 순서로 삭제합니다.

1. 개발자 도구 → Application → Service Workers → Unregister
2. Storage → Clear site data
3. 앱 또는 페이지 다시 실행

## 화면을 끄면 음성이 멈춤

브라우저 TTS는 운영체제 정책에 따라 백그라운드에서 중단될 수 있습니다. Android에서는 Chrome으로 PWA 설치 후 사용하는 방식이 상대적으로 적합합니다. 계속 멈추면 읽기 설정의 **읽는 동안 화면 켜기**를 사용합니다.

# 보안

- 공개용 publishable 또는 anon 키만 사용
- `service_role` 키 사용 금지
- Supabase RLS 정책 유지
- 신규 회원가입 비활성화
- HTTPS 주소에 배포
- 공용 PC에서는 사용 후 로그아웃
