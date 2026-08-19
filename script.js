/**
 * 음성 목적지 검색 (MVP)
 *
 * 이메일 로그인(Firebase Auth) → 목적지 등록(Firestore) →
 * 음성으로 [등록된 주소로 찾기 / 새 주소로 찾기] 중 선택 →
 * STT → 매칭/검색 → 지도 확인 → TTS
 */
'use strict';

const CONFIG = Object.assign(
  {
    GOOGLE_MAPS_API_KEY: '',
    DEFAULT_CENTER: { lat: 37.5663, lng: 126.9779 },
    MAX_RESULTS: 3,
    FIREBASE: null,
  },
  window.APP_CONFIG || {}
);

const FIREBASE_VERSION = '11.0.2';
const LISTEN_TIMEOUT_MS = 10000;
const MATCH_THRESHOLD = 0.5; // 유사도 매칭 최소 점수

const $ = (id) => document.getElementById(id);

const el = {
  authView: $('authView'),
  authForm: $('authForm'),
  email: $('email'),
  password: $('password'),
  authSubmit: $('authSubmit'),
  authToggle: $('authToggle'),
  authToggleText: $('authToggleText'),
  authError: $('authError'),

  appView: $('appView'),
  userEmail: $('userEmail'),
  logout: $('logoutBtn'),
  bootError: $('bootError'),

  modePicker: $('modePicker'),
  modeSavedCount: $('modeSavedCount'),
  voiceStage: $('voiceStage'),
  back: $('backBtn'),
  modeLabel: $('modeLabel'),

  mic: $('micBtn'),
  status: $('status'),
  transcript: $('transcript'),
  query: $('query'),
  map: $('map'),
  mapFallback: $('mapFallback'),
  confirm: $('confirmCard'),
  candidates: $('candidates'),
  resultAddress: $('resultAddress'),
  resultName: $('resultName'),
  yes: $('yesBtn'),
  retry: $('retryBtn'),
  error: $('error'),

  placeForm: $('placeForm'),
  placeName: $('placeName'),
  placeSearch: $('placeSearch'),
  placeSearchBtn: $('placeSearchBtn'),
  searchResults: $('searchResults'),
  pickedAddress: $('pickedAddress'),
  save: $('saveBtn'),
  placeError: $('placeError'),
  savedList: $('savedList'),
  savedEmpty: $('savedEmpty'),
};

const STATES = {
  idle:      { color: 'var(--accent)',    text: '마이크를 눌러 말해주세요' },
  listening: { color: 'var(--listening)', text: '듣고 있어요…' },
  working:   { color: 'var(--working)',   text: '처리 중…' },
  confirm:   { color: 'var(--done)',      text: '이 장소가 맞나요?' },
  done:      { color: 'var(--done)',      text: '목적지를 확정했어요' },
  error:     { color: 'var(--danger)',    text: '오류가 발생했어요' },
};

// ── 앱 상태 ────────────────────────────────────────────────
let fb = null;             // { auth, db, api }
let currentUser = null;
let unsubscribePlaces = null;
let savedPlaces = [];      // [{ id, name, address, lat, lng }]

let map = null;
let marker = null;
let recognition = null;
let listenTimer = null;

let mode = null;           // 'saved' | 'new'
let candidates = [];       // 확인 카드에 표시 중인 후보
let selectedIndex = 0;
let pickedPlace = null;    // 목적지 등록 폼에서 고른 장소

// ─────────────────────────────────────────────────────────
// 공통 UI 헬퍼
// ─────────────────────────────────────────────────────────
function setState(name, message) {
  const s = STATES[name] || STATES.idle;
  document.body.dataset.state = name;
  document.body.style.setProperty('--state-color', s.color);
  el.status.textContent = message || s.text;
}

function showMsg(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function hideMsg(node) {
  node.hidden = true;
  node.textContent = '';
}

// ─────────────────────────────────────────────────────────
// Firebase
// ─────────────────────────────────────────────────────────
async function initFirebase() {
  const cfg = CONFIG.FIREBASE;
  if (!cfg || !cfg.apiKey || cfg.apiKey === 'YOUR_FIREBASE_API_KEY') {
    throw new Error('Firebase 설정이 없습니다.\nconfig.example.js 를 config.js 로 복사하고 FIREBASE 설정을 채워주세요.');
  }

  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [appMod, authMod, storeMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = appMod.initializeApp(cfg);
  fb = {
    auth: authMod.getAuth(app),
    db: storeMod.getFirestore(app),
    api: { ...authMod, ...storeMod },
  };
  return fb;
}

/** Firebase 오류 코드를 사용자용 한국어 문구로 */
function authErrorText(code) {
  switch (code) {
    case 'auth/invalid-email': return '이메일 형식이 올바르지 않습니다.';
    case 'auth/missing-password':
    case 'auth/weak-password': return '비밀번호는 6자 이상이어야 합니다.';
    case 'auth/email-already-in-use': return '이미 가입된 이메일입니다. 로그인해주세요.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return '이메일 또는 비밀번호가 올바르지 않습니다.';
    case 'auth/too-many-requests': return '시도가 너무 잦습니다. 잠시 후 다시 시도해주세요.';
    case 'auth/operation-not-allowed': return 'Firebase 콘솔에서 이메일/비밀번호 로그인을 활성화해주세요.';
    case 'auth/network-request-failed': return '네트워크 연결을 확인해주세요.';
    default: return `로그인에 실패했습니다. (${code})`;
  }
}

// ─────────────────────────────────────────────────────────
// 인증 화면
// ─────────────────────────────────────────────────────────
let authMode = 'login'; // 'login' | 'signup'

function renderAuthMode() {
  const isLogin = authMode === 'login';
  el.authSubmit.textContent = isLogin ? '로그인' : '회원가입';
  el.authToggleText.textContent = isLogin ? '아직 계정이 없으신가요?' : '이미 계정이 있으신가요?';
  el.authToggle.textContent = isLogin ? '회원가입' : '로그인';
  el.password.autocomplete = isLogin ? 'current-password' : 'new-password';
  hideMsg(el.authError);
}

el.authToggle.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  renderAuthMode();
});

el.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg(el.authError);

  const email = el.email.value.trim();
  const password = el.password.value;
  if (!email || password.length < 6) {
    showMsg(el.authError, '이메일과 6자 이상의 비밀번호를 입력해주세요.');
    return;
  }

  el.authSubmit.disabled = true;
  try {
    const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = fb.api;
    if (authMode === 'signup') await createUserWithEmailAndPassword(fb.auth, email, password);
    else await signInWithEmailAndPassword(fb.auth, email, password);
  } catch (err) {
    showMsg(el.authError, authErrorText(err.code || err.message));
  } finally {
    el.authSubmit.disabled = false;
  }
});

el.logout.addEventListener('click', () => fb && fb.api.signOut(fb.auth));

function onSignedIn(user) {
  currentUser = user;
  el.userEmail.textContent = user.email;
  el.authView.hidden = true;
  el.appView.hidden = false;
  el.password.value = '';
  watchPlaces();
  initMap();
}

function onSignedOut() {
  currentUser = null;
  if (unsubscribePlaces) { unsubscribePlaces(); unsubscribePlaces = null; }
  savedPlaces = [];
  el.appView.hidden = true;
  el.authView.hidden = false;
  goToModePicker();
}

// ─────────────────────────────────────────────────────────
// 저장된 목적지 (Firestore)
// ─────────────────────────────────────────────────────────
function placesCollection() {
  const { collection } = fb.api;
  return collection(fb.db, 'users', currentUser.uid, 'places');
}

function watchPlaces() {
  const { onSnapshot, query, orderBy } = fb.api;
  const q = query(placesCollection(), orderBy('createdAt', 'desc'));
  unsubscribePlaces = onSnapshot(
    q,
    (snap) => {
      savedPlaces = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderSavedList();
    },
    (err) => {
      console.error(err);
      showMsg(el.placeError, '목적지 목록을 불러오지 못했습니다. Firestore 보안 규칙을 확인해주세요.');
    }
  );
}

function renderSavedList() {
  el.savedList.innerHTML = '';
  el.savedEmpty.hidden = savedPlaces.length > 0;
  el.modeSavedCount.textContent = savedPlaces.length ? `${savedPlaces.length}곳` : '';

  savedPlaces.forEach((place) => {
    const li = document.createElement('li');
    li.className = 'saved__item';

    const body = document.createElement('div');
    body.className = 'saved__body';
    const name = document.createElement('span');
    name.className = 'saved__name';
    name.textContent = place.name;
    const addr = document.createElement('span');
    addr.className = 'saved__addr';
    addr.textContent = place.address;
    body.append(name, addr);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'saved__del';
    del.textContent = '삭제';
    del.addEventListener('click', () => removePlace(place));

    li.append(body, del);
    el.savedList.appendChild(li);
  });
}

async function removePlace(place) {
  if (!confirm(`"${place.name}" 목적지를 삭제할까요?`)) return;
  const { deleteDoc, doc } = fb.api;
  try {
    await deleteDoc(doc(fb.db, 'users', currentUser.uid, 'places', place.id));
  } catch (err) {
    console.error(err);
    showMsg(el.placeError, '삭제에 실패했습니다.');
  }
}

// ─────────────────────────────────────────────────────────
// 지도
// ─────────────────────────────────────────────────────────
let mapsLoader = null;

function loadMapsApi() {
  if (mapsLoader) return mapsLoader;
  mapsLoader = new Promise((resolve, reject) => {
    if (!CONFIG.GOOGLE_MAPS_API_KEY || CONFIG.GOOGLE_MAPS_API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY') {
      reject(new Error('NO_KEY'));
      return;
    }
    const params = new URLSearchParams({
      key: CONFIG.GOOGLE_MAPS_API_KEY,
      v: 'weekly',
      libraries: 'places,marker',
      language: 'ko',
      region: 'KR',
      loading: 'async',
      callback: '__onMapsReady',
    });
    window.__onMapsReady = resolve;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => reject(new Error('LOAD_FAILED'));
    document.head.appendChild(script);
  });
  return mapsLoader;
}

async function initMap() {
  if (map) return;
  try {
    await loadMapsApi();
  } catch (err) {
    el.mapFallback.textContent =
      err.message === 'NO_KEY'
        ? 'Google Maps API 키가 설정되지 않았습니다.\nconfig.js 의 GOOGLE_MAPS_API_KEY 를 확인해주세요.'
        : '지도를 불러오지 못했습니다.\nAPI 키와 네트워크 상태를 확인해주세요.';
    return;
  }

  const { Map } = await google.maps.importLibrary('maps');
  map = new Map(el.map, {
    center: CONFIG.DEFAULT_CENTER,
    zoom: 14,
    mapId: 'DEMO_MAP_ID',
    disableDefaultUI: true,
    zoomControl: true,
  });
  el.mapFallback.hidden = true;
}

async function showOnMap(lat, lng, title) {
  if (!map || typeof lat !== 'number' || typeof lng !== 'number') return;
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
  if (marker) marker.map = null;
  marker = new AdvancedMarkerElement({ map, position: { lat, lng }, title });
  map.panTo({ lat, lng });
  map.setZoom(16);
}

function clearMarker() {
  if (marker) { marker.map = null; marker = null; }
}

/** Places 검색 결과를 앱 공통 형태로 변환 */
function toEntry(place, isSaved = false) {
  const loc = place.location;
  return {
    name: place.displayName || place.name || '(이름 없음)',
    address: place.formattedAddress || place.address || '',
    lat: typeof loc?.lat === 'function' ? loc.lat() : loc?.lat,
    lng: typeof loc?.lng === 'function' ? loc.lng() : loc?.lng,
    saved: isSaved,
  };
}

async function searchPlaces(queryText) {
  const { Place } = await google.maps.importLibrary('places');
  const result = await Place.searchByText({
    textQuery: queryText,
    fields: ['displayName', 'formattedAddress', 'location'],
    language: 'ko',
    region: 'kr',
    maxResultCount: CONFIG.MAX_RESULTS,
    locationBias: map ? { center: map.getCenter(), radius: 30000 } : undefined,
  });
  return (result.places || []).map((p) => toEntry(p));
}

// ─────────────────────────────────────────────────────────
// 검색어 정제 / 이름 매칭
// ─────────────────────────────────────────────────────────
/** "강남역 2번 출구로 가주세요" → "강남역 2번 출구" */
function toSearchQuery(raw) {
  let q = raw.trim();

  const tailPatterns = [
    // "로" 는 지명 일부일 수 있어(종로, 대학로) 조사 목록에서 제외한다.
    /\s*(으로|에|까지)?\s*(좀\s*)?(가|가자|가줘|가주세요|가 주세요|갈래|갈게|갑시다|데려다\s*줘|데려다\s*주세요|부탁해|부탁드려요)\s*(요|줘|주세요|줄래|주실래요)?\s*$/,
    /\s*(해\s*줘|해주세요|해줘요)\s*$/,
    /[.,!?~]+$/,
  ];
  let prev;
  do {
    prev = q;
    for (const re of tailPatterns) q = q.replace(re, '').trim();
  } while (q !== prev && q.length > 0);

  q = q.replace(/(으로|까지)$/, '').trim();
  q = q.replace(/^(음+|어+|저기|그|아)\s+/, '').trim();

  return q || raw.trim();
}

/** 공백/문장부호 제거 + 소문자화 */
function normalize(s) {
  return String(s).toLowerCase().replace(/[\s.,!?~'"·]/g, '');
}

/** 2-gram Dice 계수로 문자열 유사도 계산 (0~1) */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      map.set(g, (map.get(g) || 0) + 1);
    }
    return map;
  };

  const ga = bigrams(a);
  const gb = bigrams(b);
  let hits = 0;
  for (const [g, count] of ga) {
    if (gb.has(g)) hits += Math.min(count, gb.get(g));
  }
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

/**
 * Places 검색 결과를 발화 텍스트와의 유사도 순으로 재정렬한다.
 *
 * Google Places Text Search 의 기본 순위는 관련도·평점 등 자체 기준을 따르는데,
 * 한국 지하철 출구처럼 이름이 지저분한 POI(예: "봉은사역3번출구·삼성1파출소")가
 * 실제로 더 정확한 후보(예: "삼성역7번출구")보다 앞에 오는 경우가 있다.
 * 이름 앞부분(역명)이 발화와 일치할수록 가산점을 줘 역명이 다른 후보끼리의
 * 동점을 갈라준다.
 */
function rankByQuerySimilarity(list, spokenQuery) {
  const q = normalize(spokenQuery);
  const prefixBonus = (name) => {
    const n = normalize(name);
    let k = 0;
    while (k < Math.min(q.length, n.length, 3) && q[k] === n[k]) k++;
    return (k / 3) * 0.15;
  };
  return [...list]
    .map((entry) => ({ entry, score: similarity(q, normalize(entry.name)) + prefixBonus(entry.name) }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.entry);
}

/**
 * 발화에서 저장된 목적지를 찾는다.
 * 완전 일치 → 포함 관계 → 유사도 순으로 점수를 매겨 정렬한다.
 */
function matchSavedPlaces(spoken) {
  const said = normalize(spoken);
  if (!said) return [];

  return savedPlaces
    .map((place) => {
      const name = normalize(place.name);
      let score;
      if (name === said) score = 1;
      else if (said.includes(name) || name.includes(said)) score = 0.9;
      else score = similarity(name, said);
      return { place, score };
    })
    .filter((r) => r.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((r) => ({ ...r.place, saved: true }));
}

// ─────────────────────────────────────────────────────────
// 음성 인식 (STT)
// ─────────────────────────────────────────────────────────
function createRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'ko-KR';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.continuous = false;
  return r;
}

function startListening() {
  hideMsg(el.error);
  el.confirm.hidden = true;
  el.query.hidden = true;
  clearMarker();

  recognition = createRecognition();
  if (!recognition) {
    setState('error');
    showMsg(el.error, '이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge에서 열어주세요.');
    return;
  }

  let resultText = '';

  recognition.onstart = () => {
    setState('listening');
    el.transcript.textContent = '…';
    el.transcript.classList.remove('is-empty');
    el.mic.setAttribute('aria-label', '음성 입력 중지');
    listenTimer = setTimeout(() => recognition && recognition.stop(), LISTEN_TIMEOUT_MS);
  };

  recognition.onresult = (event) => {
    resultText = event.results[0][0].transcript.trim();
  };

  recognition.onerror = (event) => {
    clearTimeout(listenTimer);
    setState('error');
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showMsg(el.error, '마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정에서 마이크를 허용해주세요.');
    } else if (event.error === 'no-speech') {
      showMsg(el.error, '음성이 감지되지 않았습니다. 마이크를 다시 누르고 또렷하게 말해주세요.');
    } else if (event.error === 'audio-capture') {
      showMsg(el.error, '마이크 장치를 찾을 수 없습니다. 연결 상태를 확인해주세요.');
    } else if (event.error !== 'aborted') {
      showMsg(el.error, `음성 인식에 실패했습니다. (${event.error}) 다시 시도해주세요.`);
    }
  };

  recognition.onend = () => {
    clearTimeout(listenTimer);
    el.mic.setAttribute('aria-label', '음성 입력 시작');
    recognition = null;
    if (resultText) {
      handleTranscript(resultText);
    } else if (el.error.hidden) {
      setState('idle', '잘 못 들었어요. 다시 말씀해주세요');
      el.transcript.textContent = '— 아직 인식된 음성이 없습니다 —';
      el.transcript.classList.add('is-empty');
    }
  };

  try {
    recognition.start();
  } catch (err) {
    setState('error');
    showMsg(el.error, '음성 인식을 시작하지 못했습니다. 페이지를 새로고침 후 다시 시도해주세요.');
  }
}

function stopListening() {
  if (recognition) recognition.stop();
}

// ─────────────────────────────────────────────────────────
// 발화 처리
// ─────────────────────────────────────────────────────────
async function handleTranscript(text) {
  el.transcript.textContent = text;
  el.transcript.classList.remove('is-empty');

  const spoken = toSearchQuery(text);

  if (mode === 'saved') {
    el.query.textContent = `→ 등록된 목적지에서 "${spoken}" 찾는 중`;
    el.query.hidden = false;

    const matched = matchSavedPlaces(spoken);
    if (matched.length === 0) {
      setState('idle', '등록된 목적지에 없어요');
      const names = savedPlaces.map((p) => p.name).join(', ');
      showMsg(
        el.error,
        savedPlaces.length
          ? `"${spoken}" 과(와) 일치하는 목적지가 없습니다.\n등록된 목적지: ${names}`
          : '아직 등록된 목적지가 없습니다. [목적지 관리] 탭에서 먼저 등록해주세요.'
      );
      return;
    }
    showCandidates(matched);
    return;
  }

  // mode === 'new'
  el.query.textContent = `→ 검색어: "${spoken}"`;
  el.query.hidden = false;

  if (!map) {
    setState('error');
    showMsg(el.error, '지도가 준비되지 않아 검색할 수 없습니다. API 키 설정을 확인해주세요.');
    return;
  }

  setState('working', '장소를 검색하는 중…');
  try {
    const found = await searchPlaces(spoken);
    if (found.length === 0) {
      setState('idle', '검색 결과가 없어요');
      showMsg(el.error, `"${spoken}" 에 해당하는 장소를 찾지 못했습니다. 다시 말씀해주세요.`);
      return;
    }
    showCandidates(rankByQuerySimilarity(found, spoken));
  } catch (err) {
    console.error(err);
    setState('error');
    showMsg(el.error, '장소 검색에 실패했습니다. API 키의 Places API 활성화 여부를 확인해주세요.');
  }
}

function showCandidates(list) {
  candidates = list;
  selectedIndex = 0;
  el.candidates.innerHTML = '';

  list.forEach((entry, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate';

    const name = document.createElement('span');
    name.className = 'candidate__name';
    name.textContent = entry.name;
    if (entry.saved) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '등록됨';
      name.appendChild(badge);
    }

    const addr = document.createElement('span');
    addr.className = 'candidate__addr';
    addr.textContent = entry.address;

    btn.append(name, addr);
    btn.addEventListener('click', () => selectCandidate(i));
    li.appendChild(btn);
    el.candidates.appendChild(li);
  });

  // 후보가 하나뿐이면 최종 결과 카드와 내용이 겹치므로 목록을 숨긴다
  el.candidates.hidden = list.length < 2;
  el.confirm.hidden = false;
  selectCandidate(0);
  setState('confirm');
}

function selectCandidate(index) {
  selectedIndex = index;
  [...el.candidates.querySelectorAll('.candidate')].forEach((btn, i) => {
    btn.classList.toggle('is-selected', i === index);
  });
  const entry = candidates[index];
  if (!entry) return;

  // 두 모드 모두 최종 결과 텍스트는 Google 지도 기준 주소로 통일한다.
  // (등록된 목적지의 주소도 저장 시점에 Places 검색으로 받아온 formattedAddress)
  el.resultAddress.textContent = entry.address || '(주소 정보 없음)';
  el.resultName.textContent = entry.saved
    ? `등록 이름: ${entry.name} · 지도 표기: ${entry.mapName || entry.name}`
    : `장소명: ${entry.name}`;

  showOnMap(entry.lat, entry.lng, entry.name);
}

// ─────────────────────────────────────────────────────────
// 음성 출력 (TTS)
// ─────────────────────────────────────────────────────────
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ko-KR';
  utter.rate = 1.0;
  window.speechSynthesis.speak(utter);
}

function confirmDestination() {
  const entry = candidates[selectedIndex];
  if (!entry) return;
  setState('done');
  speak(`목적지 주소는 ${entry.address} 입니다.`);
}

// ─────────────────────────────────────────────────────────
// 모드 전환 / 화면 이동
// ─────────────────────────────────────────────────────────
const MODE_LABEL = { saved: '등록된 주소로 찾기', new: '새 주소로 찾기' };

function goToModePicker() {
  mode = null;
  if (recognition) recognition.abort();
  window.speechSynthesis && window.speechSynthesis.cancel();
  candidates = [];
  clearMarker();
  el.confirm.hidden = true;
  el.query.hidden = true;
  hideMsg(el.error);
  el.transcript.textContent = '— 아직 인식된 음성이 없습니다 —';
  el.transcript.classList.add('is-empty');
  el.voiceStage.hidden = true;
  el.modePicker.hidden = false;
  setState('idle');
}

function enterMode(next) {
  mode = next;
  el.modeLabel.textContent = MODE_LABEL[next];
  el.modePicker.hidden = true;
  el.voiceStage.hidden = false;
  setState(
    'idle',
    next === 'saved' ? '등록한 이름을 말해주세요' : '가고 싶은 곳을 말해주세요'
  );
}

document.querySelectorAll('.mode__card').forEach((card) => {
  card.addEventListener('click', () => enterMode(card.dataset.mode));
});
el.back.addEventListener('click', goToModePicker);

el.mic.addEventListener('click', () => {
  if (document.body.dataset.state === 'listening') stopListening();
  else startListening();
});
el.yes.addEventListener('click', confirmDestination);
el.retry.addEventListener('click', () => {
  window.speechSynthesis && window.speechSynthesis.cancel();
  el.confirm.hidden = true;
  candidates = [];
  clearMarker();
  startListening();
});

// 탭
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => {
      p.hidden = p.id !== `panel-${tab.dataset.tab}`;
    });
  });
});

// ─────────────────────────────────────────────────────────
// 목적지 등록
// ─────────────────────────────────────────────────────────
function setPicked(entry) {
  pickedPlace = entry;
  el.pickedAddress.textContent = `${entry.name} · ${entry.address}`;
  el.pickedAddress.hidden = false;
  el.save.disabled = false;
  if (!el.placeName.value.trim()) el.placeName.placeholder = `예: 우리집 (${entry.name})`;
}

async function runPlaceSearch() {
  const text = el.placeSearch.value.trim();
  hideMsg(el.placeError);
  if (!text) {
    showMsg(el.placeError, '검색어를 입력해주세요.');
    el.placeSearch.focus();
    return;
  }

  if (!map) {
    await initMap();
    if (!map) {
      showMsg(el.placeError, '지도가 준비되지 않아 검색할 수 없습니다. API 키 설정을 확인해주세요.');
      return;
    }
  }

  el.placeSearchBtn.disabled = true;
  el.placeSearchBtn.textContent = '검색 중';
  try {
    const found = await searchPlaces(text);
    el.searchResults.innerHTML = '';
    if (found.length === 0) {
      el.searchResults.hidden = true;
      showMsg(el.placeError, `"${text}" 검색 결과가 없습니다.`);
      return;
    }
    found.forEach((entry) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'candidate';
      const name = document.createElement('span');
      name.className = 'candidate__name';
      name.textContent = entry.name;
      const addr = document.createElement('span');
      addr.className = 'candidate__addr';
      addr.textContent = entry.address;
      btn.append(name, addr);
      btn.addEventListener('click', () => {
        [...el.searchResults.querySelectorAll('.candidate')].forEach((b) =>
          b.classList.toggle('is-selected', b === btn)
        );
        setPicked(entry);
      });
      li.appendChild(btn);
      el.searchResults.appendChild(li);
    });
    el.searchResults.hidden = false;
  } catch (err) {
    console.error(err);
    showMsg(el.placeError, '장소 검색에 실패했습니다. Places API 활성화 여부를 확인해주세요.');
  } finally {
    el.placeSearchBtn.disabled = false;
    el.placeSearchBtn.textContent = '검색';
  }
}

el.placeSearchBtn.addEventListener('click', runPlaceSearch);
el.placeSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runPlaceSearch(); }
});

el.placeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg(el.placeError);

  const name = el.placeName.value.trim();
  if (!name) { showMsg(el.placeError, '목적지 이름을 입력해주세요.'); return; }
  if (!pickedPlace) { showMsg(el.placeError, '주소를 검색해서 선택해주세요.'); return; }

  const duplicate = savedPlaces.some((p) => normalize(p.name) === normalize(name));
  if (duplicate) { showMsg(el.placeError, `"${name}" 은(는) 이미 등록된 이름입니다.`); return; }

  el.save.disabled = true;
  try {
    const { addDoc, serverTimestamp } = fb.api;
    await addDoc(placesCollection(), {
      name,                          // 사용자가 붙인 이름 (예: 우리집)
      mapName: pickedPlace.name,     // Google 지도상의 장소명
      address: pickedPlace.address,  // Google 지도상의 주소 (formattedAddress)
      lat: pickedPlace.lat,
      lng: pickedPlace.lng,
      createdAt: serverTimestamp(),
    });
    // 폼 초기화
    el.placeForm.reset();
    el.placeName.placeholder = '예: 우리집';
    el.searchResults.innerHTML = '';
    el.searchResults.hidden = true;
    el.pickedAddress.hidden = true;
    pickedPlace = null;
  } catch (err) {
    console.error(err);
    showMsg(el.placeError, '저장에 실패했습니다. Firestore 보안 규칙을 확인해주세요.');
    el.save.disabled = false;
  }
});

// ─────────────────────────────────────────────────────────
// 부팅
// ─────────────────────────────────────────────────────────
(async function boot() {
  renderAuthMode();
  setState('idle');
  goToModePicker();

  if (window.__configMissing) {
    showMsg(el.bootError, 'config.js 파일이 없습니다.\nconfig.example.js 를 복사해 config.js 를 만들고 API 키를 입력해주세요.');
    return;
  }

  try {
    await initFirebase();
  } catch (err) {
    console.error(err);
    showMsg(el.bootError, err.message || 'Firebase 초기화에 실패했습니다.');
    return;
  }

  fb.api.onAuthStateChanged(fb.auth, (user) => {
    if (user) onSignedIn(user);
    else onSignedOut();
  });
})();
