#!/usr/bin/env node
/**
 * 배포 시 리포지토리 시크릿으로 config.js 를 생성한다.
 *
 *   GOOGLE_MAPS_API_KEY=... FIREBASE_CONFIG='{"apiKey":...}' \
 *     node .github/scripts/make-config.js _site/config.js
 *
 * 시크릿 값 자체는 절대 로그로 출력하지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_FIREBASE_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

/** GitHub Actions 로그에 오류로 표시되도록 출력하고 종료 */
function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const outPath = process.argv[2];
if (!outPath) fail('출력 경로를 인자로 넘겨주세요. 예: node make-config.js _site/config.js');

const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
const firebaseRaw = process.env.FIREBASE_CONFIG;

if (!mapsKey || !mapsKey.trim()) {
  fail('리포지토리 시크릿 GOOGLE_MAPS_API_KEY 가 설정되지 않았습니다.');
}
if (!firebaseRaw || !firebaseRaw.trim()) {
  fail('리포지토리 시크릿 FIREBASE_CONFIG 가 설정되지 않았습니다.');
}

let firebase;
try {
  firebase = JSON.parse(firebaseRaw);
} catch (err) {
  fail('FIREBASE_CONFIG 가 올바른 JSON 이 아닙니다. Firebase 콘솔의 firebaseConfig 객체를 JSON 형식으로 넣어주세요.');
}
if (typeof firebase !== 'object' || firebase === null || Array.isArray(firebase)) {
  fail('FIREBASE_CONFIG 는 JSON 객체여야 합니다.');
}

const missing = REQUIRED_FIREBASE_KEYS.filter((k) => !firebase[k]);
if (missing.length) {
  fail(`FIREBASE_CONFIG 에 다음 항목이 없습니다: ${missing.join(', ')}`);
}

// JSON.stringify 로 직렬화하므로 따옴표·개행 등이 안전하게 이스케이프된다.
const contents = `// GitHub Actions 가 배포 시 자동 생성한 파일입니다. 직접 수정하지 마세요.
window.APP_CONFIG = {
  GOOGLE_MAPS_API_KEY: ${JSON.stringify(mapsKey.trim())},
  DEFAULT_CENTER: { lat: 37.5663, lng: 126.9779 },
  MAX_RESULTS: 3,
  FIREBASE: ${JSON.stringify(firebase, null, 2).replace(/\n/g, '\n  ')},
};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, contents);

console.log(`${outPath} 생성 완료 (projectId: ${firebase.projectId})`);
