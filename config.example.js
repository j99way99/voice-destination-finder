/**
 * 설정 예시 파일.
 *
 * 이 파일을 config.js 로 복사한 뒤 실제 키를 넣어주세요.
 *   cp config.example.js config.js
 *
 * config.js 는 .gitignore 에 등록되어 있어 커밋되지 않습니다.
 */
window.APP_CONFIG = {
  // ── Google Maps ────────────────────────────────────────
  // Google Cloud Console 에서 발급받은 Maps JavaScript API 키
  GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY',

  // 지도 초기 중심 좌표 (기본: 서울시청)
  DEFAULT_CENTER: { lat: 37.5663, lng: 126.9779 },

  // 장소 검색 후보 최대 개수 (1~5 권장)
  MAX_RESULTS: 3,

  // ── Firebase ───────────────────────────────────────────
  // Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) 에서 복사한 설정 객체
  FIREBASE: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:xxxxxxxxxxxxxxxx',
  },
};
