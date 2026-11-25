/* =============================================================================
   한투 ETF 자동매매 - Service Worker
   · 앱 화면(HTML/CSS/JS/아이콘)을 기기에 저장해 두어, 지하철처럼 인터넷이 약한
     곳에서도 앱이 열리게 합니다.
   · GitHub API(계좌 데이터)는 절대 캐시하지 않습니다. 항상 새로 받아옵니다.
   ============================================================================= */
var CACHE_NAME = 'kis-etf-dashboard-v1';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return Promise.all(SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () { /* 없는 파일은 넘어감 */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE_NAME ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // 계좌 데이터(GitHub API)는 캐시하지 않고 항상 새로 받는다
  if (url.hostname === 'api.github.com') return;

  // 우리 앱 파일: 캐시 먼저, 없으면 네트워크
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
          return response;
        }).catch(function () {
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 그 밖(Chart.js CDN 등): 캐시 먼저, 없으면 네트워크 후 저장
  event.respondWith(
    caches.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
        return response;
      });
    })
  );
});
