# 음성 목적지 검색 (Voice Destination Finder)

이메일로 회원가입해 자주 가는 곳을 `딸내미집` 같은 이름으로 저장해두고,
음성으로 그 이름만 말하면 주소를 불러오는 단일 페이지 데모입니다.

빌드 도구 없이 정적 파일만으로 동작합니다.

## 동작 흐름

```
이메일 회원가입 / 로그인  (Firebase Auth)
   │
   ├─ [목적지 관리] 탭
   │     이름 입력 + Google 지도 검색으로 주소 선택 → Firestore 저장
   │       { name: '딸내미집', mapName, address, lat, lng }
   │
   └─ [음성 검색] 탭 → 두 가지 모드 중 선택
         ├─ 등록된 주소로 찾기 : "딸내미집" → 저장된 목적지 이름 매칭
         └─ 새 주소로 찾기     : "강남역 2번 출구" → Google Places 검색
                    │
                    ▼
         지도 마커 + 최종 목적지 주소(Google 지도 주소) 표시
                    │
              "맞아요" 선택 → TTS로 주소 읽기
```

두 모드 모두 **최종 결과 텍스트는 Google 지도의 주소(`formattedAddress`)** 로 통일됩니다.
등록된 목적지의 주소도 저장 시점에 Places 검색으로 받아온 값이라 동일한 형식입니다.

### 이름 매칭 규칙

발화에서 이동 표현("~로 가주세요")을 걷어낸 뒤, 저장된 이름과 비교합니다.

1. 정규화(공백·문장부호 제거) 후 완전 일치 → 1.0
2. 포함 관계 (`딸내미 집` ↔ `딸내미집`) → 0.9
3. 2-gram Dice 유사도

점수 0.5 이상인 후보를 높은 순으로 보여줍니다. 일치하는 것이 없으면 등록된 목적지 목록을 안내합니다.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 마크업/스타일 | 순수 HTML + CSS |
| 스크립트 | Vanilla JavaScript (ES Module) |
| 인증 | Firebase Authentication (이메일/비밀번호) |
| 데이터 | Cloud Firestore |
| STT | Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) |
| 지도/검색 | Google Maps JavaScript API + Places API (New) `Place.searchByText` |
| TTS | `SpeechSynthesisUtterance` |
| 배포 | GitHub Pages 등 정적 호스팅 |

Firebase SDK는 CDN에서 ES Module로 직접 불러오므로 npm 설치나 번들링이 필요 없습니다.

## 1. Google Maps API 키 발급

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 생성합니다.
2. **API 및 서비스 → 라이브러리**에서 다음 두 가지를 활성화합니다.
   - **Maps JavaScript API**
   - **Places API (New)**
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**로 키를 발급합니다.
4. 발급한 키의 **애플리케이션 제한사항**을 `웹사이트(HTTP 리퍼러)`로 설정하고 도메인을 등록합니다.
   ```
   http://localhost:8000/*
   https://<사용자명>.github.io/*
   ```
5. **API 제한사항**에서 위 두 API만 선택합니다.

> Maps JavaScript API 키는 클라이언트에 노출되는 것이 정상적인 사용 방식입니다. 보호는 HTTP 리퍼러 제한으로 합니다.

## 2. Firebase 설정

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트를 생성합니다.
2. **Authentication → Sign-in method** 에서 **이메일/비밀번호** 를 활성화합니다.
3. **Firestore Database** 를 생성합니다. (프로덕션 모드 선택)
4. **Firestore → 규칙** 에 이 저장소의 [`firestore.rules`](firestore.rules) 내용을 붙여넣고 게시합니다.
   본인 데이터만 읽고 쓸 수 있도록 제한하는 규칙입니다.
5. **프로젝트 설정 → 내 앱 → 웹 앱 추가** 후 표시되는 `firebaseConfig` 객체를 복사합니다.
6. **Authentication → Settings → 승인된 도메인** 에 배포 도메인(`<사용자명>.github.io`)을 추가합니다.

## 3. 로컬 실행

```bash
cp config.example.js config.js
# config.js 를 열어 GOOGLE_MAPS_API_KEY 와 FIREBASE 값을 실제 값으로 교체

python3 -m http.server 8000
# 또는: npx serve .
```

브라우저에서 `http://localhost:8000` 접속.

- `file://` 로 직접 열면 마이크 권한과 ES Module 로딩이 모두 실패합니다. 반드시 HTTP 서버로 띄우세요.
- 마이크 접근은 `localhost` 또는 HTTPS 환경에서만 허용됩니다.
- 음성 인식은 **Chrome / Edge** 에서 동작합니다. Firefox는 미지원입니다.

## 4. GitHub Pages 배포

1. 저장소에 푸시합니다. (`config.js` 는 `.gitignore` 에 있어 커밋되지 않습니다.)
2. 배포용 `config.js` 를 별도로 포함시키거나, GitHub Actions 에서 시크릿으로 생성해 배포합니다.
3. **Settings → Pages** 에서 브랜치를 선택해 게시합니다.
4. Google API 키의 리퍼러 제한 목록과 Firebase 승인된 도메인에 게시 도메인을 추가합니다.

## 설정 값 (`config.js`)

| 키 | 설명 | 기본값 |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Maps JavaScript API 키 | — |
| `DEFAULT_CENTER` | 지도 초기 중심 좌표 | 서울시청 |
| `MAX_RESULTS` | 장소 검색 후보 최대 개수 | 3 |
| `FIREBASE` | Firebase 웹 앱 설정 객체 | — |

## 파일 구조

```
voice-destination-finder/
├── index.html          로그인 / 음성 검색 / 목적지 관리 화면
├── style.css           상태별 컬러, 마이크 파동 애니메이션, 다크·라이트 대응
├── script.js           인증 · 목적지 CRUD · STT · 이름 매칭 · Places 검색 · 지도 · TTS
├── config.example.js   API 키 설정 예시
├── firestore.rules     Firestore 보안 규칙
└── README.md
```

## 데이터 구조 (Firestore)

```
users/{uid}/places/{placeId}
  name       : '딸내미집'            사용자가 붙인 이름 (음성 매칭 대상)
  mapName    : '○○아파트 101동'      Google 지도상의 장소명
  address    : '서울특별시 ...'       Google 지도상의 주소 (최종 결과 텍스트)
  lat, lng   : 좌표
  createdAt  : 서버 타임스탬프
```

## 알려진 제약

- `mapId` 로 `DEMO_MAP_ID` 를 사용합니다. 프로덕션에서는 Cloud Console 에서 발급한 실제 Map ID 로 교체하세요.
- 브라우저 내장 STT 특성상 고유명사의 인식 정확도가 낮을 수 있습니다. 등록 이름은 짧고 발음이 또렷한 단어를 권장합니다.

## 향후 확장 (이번 범위 아님)

- 확인된 좌표를 카카오T 딥링크(`https://t.kakao.com/launch?type=taxi&dest_lat=...&dest_lng=...`)로 넘겨 택시 호출 연동
- STT 정확도 개선이 필요할 경우 Whisper API / Naver Clova Speech 로 교체 검토
