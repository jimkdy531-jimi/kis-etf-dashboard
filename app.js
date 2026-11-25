/* =============================================================================
   한투 ETF 자동매매 - 모바일 현황 앱 (PWA)
   -----------------------------------------------------------------------------
   · 이 파일과 index.html 은 공개 저장소(GitHub Pages)에 올라가는 "화면"입니다.
     계좌 데이터는 들어 있지 않습니다.
   · 사용자가 화면에서 입력한 GitHub Fine-grained 토큰(localStorage)으로
     비공개 저장소 jimkdy531-jimi/kis-etf-rebalancer 의 GitHub API 를 직접 호출합니다.
     토큰이 없으면 데모/안내 화면만 보이고 계좌 정보는 표시되지 않습니다.
   ============================================================================= */
(function () {
  'use strict';

  var OWNER = 'jimkdy531-jimi';
  var REPO = 'kis-etf-rebalancer';
  var WORKFLOW = 'rebalance.yml';
  var BRANCH = 'main';
  var API = 'https://api.github.com';
  var ACTIONS_URL = 'https://github.com/' + OWNER + '/' + REPO + '/actions';

  var TOKEN_KEY = 'kis_etf_pat_v1';
  var CACHE_KEY = 'kis_etf_cache_v1';
  var AUTO_REFRESH_MS = 60 * 1000;

  // ===========================================================================
  // 1. 순수 도우미 (화면 없이도 검증 가능한 함수들)
  // ===========================================================================
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function fmtWon(value) {
    if (value == null || value === '') return '-';
    return Math.round(toNumber(value)).toLocaleString('ko-KR') + '원';
  }

  /** 차트 눈금용: 1,234,567 -> "123.5만" */
  function fmtWonShort(value) {
    var n = toNumber(value);
    var abs = Math.abs(n);
    if (abs >= 100000000) return (n / 100000000).toFixed(1) + '억';
    if (abs >= 10000) return Math.round(n / 10000).toLocaleString('ko-KR') + '만';
    return n.toLocaleString('ko-KR');
  }

  function fmtEokWon(value) {
    // 12,345,678 -> "1,234만원" 처럼 만 단위로 읽기 쉽게
    var n = toNumber(value);
    if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(2) + '억원';
    return Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
  }

  function fmtPct(value, digits) {
    var d = typeof digits === 'number' ? digits : 1;
    if (value == null || value === '') return '-';
    return toNumber(value).toFixed(d) + '%';
  }

  function decodeBase64Utf8(b64) {
    var clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
    if (!clean) return '';
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /** 붙여 넣은 토큰 정리: 줄바꿈·공백 제거, github_pat_/ghp_ 접두사 확인 */
  function normalizeToken(raw) {
    var text = String(raw == null ? '' : raw).replace(/\s+/g, '');
    if (!text) return { ok: false, token: '', reason: 'empty' };
    if (!/^(github_pat_|ghp_|github_pat_11)/.test(text)) {
      return { ok: false, token: text, reason: 'prefix' };
    }
    if (text.length < 20) return { ok: false, token: text, reason: 'short' };
    return { ok: true, token: text, reason: '' };
  }

  function maskToken(token) {
    var t = String(token || '');
    if (t.length <= 12) return t ? '••••' : '';
    return t.slice(0, 11) + '…' + t.slice(-4);
  }

  function kstDateTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso || '');
    var parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return map.year + '-' + map.month + '-' + map.day + ' ' + map.hour + ':' + map.minute;
  }

  function shortDate(value) {
    var text = String(value || '');
    var m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[2] + '/' + m[3] : text;
  }

  function actionLabel(action) {
    switch (String(action || '')) {
      case 'buy': return { text: '매수 예정', cls: 'pill-info' };
      case 'sell': return { text: '매도 예정', cls: 'pill-warn' };
      case 'skip': return { text: '현재가 확인 불가', cls: 'pill-warn' };
      default: return { text: '유지', cls: 'pill-soft' };
    }
  }

  function orderStatusLabel(status) {
    var s = String(status || '');
    if (s === '접수' || s === '전송') return { text: s, cls: 'pill-good' };
    if (s === '실패') return { text: '실패', cls: 'pill-bad' };
    if (s.indexOf('예정') === 0) return { text: '주문 예정', cls: 'pill-info' };
    return { text: s || '-', cls: 'pill-soft' };
  }

  function runState(run) {
    var status = String((run && run.status) || '');
    var conclusion = String((run && run.conclusion) || '');
    if (status === 'in_progress' || status === 'queued' || status === 'waiting' || status === 'requested') {
      return { text: '실행 중', cls: 'pill-info', dot: 'live' };
    }
    if (conclusion === 'success') return { text: '성공', cls: 'pill-good', dot: 'ok' };
    if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure') {
      return { text: '실패', cls: 'pill-bad', dot: 'bad' };
    }
    if (conclusion === 'cancelled') return { text: '취소', cls: 'pill-soft', dot: '' };
    return { text: conclusion || status || '알 수 없음', cls: 'pill-soft', dot: '' };
  }

  function runTitle(run) {
    return (run && run.event === 'workflow_dispatch') ? '수동 실행' : '자동 실행';
  }

  /** 저장소 Variables 로 워크플로 실행 입력값을 만든다 (없으면 null → Variables 값 그대로 사용) */
  function pickWorkflowInputs(vars) {
    var out = {};
    var mode = String((vars && vars.KIS_MODE) || '').trim().toLowerCase();
    var dry = String((vars && vars.KIS_DRY_RUN) || '').trim().toLowerCase();
    if (mode === 'vps' || mode === 'prod') out.mode = mode;
    if (dry === 'true' || dry === 'false') out.dry_run = dry;
    return Object.keys(out).length ? out : null;
  }

  /** 킬 스위치 상태: 'true' | 'false' | null(알 수 없음) */
  function killSwitchValue(vars, readable) {
    if (!readable) return null;
    var raw = String((vars && vars.KIS_KILL_SWITCH) || '').trim().toLowerCase();
    if (raw === 'true') return 'true';
    if (raw === 'false' || raw === '') return 'false';
    return null;
  }

  function buildWeightChartData(holdings) {
    var rows = Array.isArray(holdings) ? holdings : [];
    return {
      labels: rows.map(function (h) { return String(h.name || h.code || ''); }),
      target: rows.map(function (h) { return toNumber(h.target_pct); }),
      current: rows.map(function (h) { return toNumber(h.current_pct); })
    };
  }

  function buildHistoryChartData(history) {
    var rows = (Array.isArray(history) ? history : []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    return {
      labels: rows.map(function (h) { return shortDate(h.date); }),
      total: rows.map(function (h) { return Math.round(toNumber(h.total_eval_krw) / 10000); }),
      ordered: rows.map(function (h) { return Math.round(toNumber(h.ordered_krw) / 10000); }),
      count: rows.length
    };
  }

  // ===========================================================================
  // 2. 상태 저장 (토큰·캐시)
  // ===========================================================================
  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 저장 실패는 무시 */ }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function getToken() { return storageGet(TOKEN_KEY) || ''; }
  function saveToken(token) { storageSet(TOKEN_KEY, token); }
  function clearToken() { storageRemove(TOKEN_KEY); }

  function readCache() {
    try {
      var raw = storageGet(CACHE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : null;
    } catch (e) { return null; }
  }
  function writeCache(payload) {
    try { storageSet(CACHE_KEY, JSON.stringify(payload)); } catch (e) { /* 용량 초과 등 무시 */ }
  }

  // ===========================================================================
  // 3. GitHub API
  // ===========================================================================
  function ApiError(status, message) {
    this.name = 'ApiError';
    this.status = status;
    this.message = message || ('HTTP ' + status);
  }
  ApiError.prototype = Object.create(Error.prototype);

  function gh(path, options) {
    var opts = options || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + getToken(),
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
      cache: 'no-store'
    });
  }

  function apiErrorText(err) {
    if (err && err.name === 'ApiError') {
      if (err.status === 401) return '토큰이 올바르지 않거나 만료됐습니다. 토큰을 다시 만들어 넣어 주세요.';
      if (err.status === 403) return '권한이 부족합니다. 토큰 권한(Contents 읽기, Actions 읽기·쓰기, Variables 읽기·쓰기)을 확인해 주세요.';
      if (err.status === 404) return '저장소나 파일을 찾을 수 없습니다. 토큰의 Repository access 에 kis-etf-rebalancer 가 들어 있는지 확인해 주세요.';
      if (err.status === 422) return '요청 형식이 맞지 않습니다. 잠시 뒤 다시 시도해 주세요.';
      if (err.status === 429) return 'GitHub 요청이 너무 잦습니다. 1분 뒤 다시 시도해 주세요.';
      return 'GitHub 오류가 났습니다 (HTTP ' + err.status + ').';
    }
    if (err && err.name === 'SyntaxError') return '받아온 데이터 형식이 맞지 않습니다. 잠시 뒤 다시 시도해 주세요.';
    return '인터넷 연결을 확인해 주세요. (GitHub 에 연결하지 못했습니다)';
  }

  function fetchStatus() {
    return gh('/repos/' + OWNER + '/' + REPO + '/contents/data/status.json?ref=' + BRANCH)
      .then(function (res) {
        if (res.status === 404) return { status: null, notFound: true };
        if (!res.ok) throw new ApiError(res.status);
        return res.json().then(function (json) {
          var text = decodeBase64Utf8(json && json.content);
          if (!text) return { status: null, notFound: true };
          return { status: JSON.parse(text) };
        });
      });
  }

  function fetchRuns() {
    return gh('/repos/' + OWNER + '/' + REPO + '/actions/runs?per_page=5&branch=' + BRANCH)
      .then(function (res) {
        if (res.status === 404 || res.status === 403) return [];
        if (!res.ok) throw new ApiError(res.status);
        return res.json().then(function (json) { return (json && json.workflow_runs) || []; });
      });
  }

  function fetchVariables() {
    return gh('/repos/' + OWNER + '/' + REPO + '/actions/variables?per_page=100')
      .then(function (res) {
        if (res.status === 403 || res.status === 404) return { vars: {}, readable: false };
        if (!res.ok) throw new ApiError(res.status);
        return res.json().then(function (json) {
          var vars = {};
          ((json && json.variables) || []).forEach(function (v) { vars[v.name] = v.value; });
          return { vars: vars, readable: true };
        });
      });
  }

  function setKillSwitch(on) {
    var value = on ? 'true' : 'false';
    var body = JSON.stringify({ name: 'KIS_KILL_SWITCH', value: value });
    var path = '/repos/' + OWNER + '/' + REPO + '/actions/variables/KIS_KILL_SWITCH';
    return gh(path, { method: 'PATCH', body: body }).then(function (res) {
      if (res.ok) return value;
      if (res.status === 404) {
        return gh('/repos/' + OWNER + '/' + REPO + '/actions/variables', { method: 'POST', body: body })
          .then(function (res2) {
            if (res2.ok) return value;
            throw new ApiError(res2.status);
          });
      }
      throw new ApiError(res.status);
    });
  }

  function dispatchRun(vars) {
    var inputs = pickWorkflowInputs(vars);
    var payload = { ref: BRANCH };
    if (inputs) payload.inputs = inputs;
    var path = '/repos/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches';
    return gh(path, { method: 'POST', body: JSON.stringify(payload) }).then(function (res) {
      if (res.status === 204 || res.status === 200) return true;
      if (res.status === 422 && inputs) {
        // 입력값이 문제였다면 값을 빼고(저장소 Variables 사용) 한 번 더 시도한다
        return gh(path, { method: 'POST', body: JSON.stringify({ ref: BRANCH }) }).then(function (res2) {
          if (res2.status === 204 || res2.status === 200) return true;
          throw new ApiError(res2.status);
        });
      }
      throw new ApiError(res.status);
    });
  }

  // ===========================================================================
  // 4. 화면 그리기
  // ===========================================================================
  var state = {
    status: null,
    statusNotFound: false,
    runs: [],
    vars: {},
    varsReadable: false,
    cachedAt: null,
    loading: false,
    demo: false,
    charts: {}
  };

  // 데모 화면용 가짜 데이터 (실제 계좌 정보가 아님). ?demo=1 로만 볼 수 있다.
  var DEMO_STATUS = {
    updated_at: '2026-11-25 13:01:51 KST (예시)',
    date: '2026-11-25',
    mode: 'vps',
    dry_run: false,
    exit_code: 0,
    status_text: '실제 주문 3건 접수 (231,810원) - 데모',
    account: { total_eval_krw: 10231810, cash_krw: 7681900, etf_eval_krw: 2549910 },
    pockets: [
      { id: 'long', name: '1호 장기 (정적 리밸런싱)', cycle: '매일 점검 · 비중 ±3%p', capital_krw: 3000000, eval_krw: 3032000, return_pct: 1.07, holdings_text: 'KODEX 200 12주 · S&P500 62주 · 국고채3년 9주', signal_reason: '목표 비중(30/50/20) 유지', last_rebal_date: '2026-11-25' },
      { id: 'mid', name: '2호 중기 (2주 듀얼모멘텀)', cycle: '2주(10거래일)마다 교체', capital_krw: 3000000, eval_krw: 3098000, return_pct: 3.27, holdings_text: 'TIGER 미국나스닥100 22주', signal_reason: 'TIGER 미국나스닥100 선택 (1·3개월 평균 +4.8%)', last_rebal_date: '2026-11-25' },
      { id: 'short', name: '3호 단기 (주간 모멘텀 3-A)', cycle: '매주(5거래일)마다 교체', capital_krw: 3000000, eval_krw: 3055000, return_pct: 1.83, holdings_text: 'TIGER 미국나스닥100 22주', signal_reason: 'TIGER 미국나스닥100 선택 (20일선 위 · 20일 +2.4%)', last_rebal_date: '2026-11-25' }
    ],
    holdings: [
      { code: '069500', name: 'KODEX 200', target_pct: 40, current_pct: 7.2, qty: 1, price_krw: 73510, eval_krw: 73510, action: 'buy', order_qty: 1 },
      { code: '360750', name: 'TIGER 미국S&P500', target_pct: 40, current_pct: 9.3, qty: 4, price_krw: 23855, eval_krw: 95420, action: 'buy', order_qty: 4 },
      { code: '114260', name: 'KODEX 국고채3년', target_pct: 20, current_pct: 6.1, qty: 1, price_krw: 62880, eval_krw: 62880, action: 'hold', order_qty: 0 }
    ],
    orders: [
      { side: 'buy', code: '069500', name: 'KODEX 200', qty: 1, price_krw: 73510, amount_krw: 73510, order_no: '0000022623', status: '접수' },
      { side: 'buy', code: '360750', name: 'TIGER 미국S&P500', qty: 4, price_krw: 23855, amount_krw: 95420, order_no: '0000022624', status: '접수' },
      { side: 'buy', code: '114260', name: 'KODEX 국고채3년', qty: 1, price_krw: 62880, amount_krw: 62880, order_no: '0000022626', status: '접수' }
    ],
    rules: {
      tolerance_pct: 3,
      max_order_krw_per_trade: 100000,
      max_daily_order_krw: 300000,
      allow_sell: true,
      trading_window: '09:20~15:00',
      targets: [
        { code: '069500', name: 'KODEX 200', target_pct: 40 },
        { code: '360750', name: 'TIGER 미국S&P500', target_pct: 40 },
        { code: '114260', name: 'KODEX 국고채3년', target_pct: 20 }
      ]
    },
    history: [
      { date: '2026-11-19', total_eval_krw: 10000000, cash_krw: 10000000, etf_eval_krw: 0, ordered_krw: 0, mode: 'vps', dry_run: true },
      { date: '2026-11-20', total_eval_krw: 10000000, cash_krw: 10000000, etf_eval_krw: 0, ordered_krw: 0, mode: 'vps', dry_run: true },
      { date: '2026-11-21', total_eval_krw: 10000000, cash_krw: 10000000, etf_eval_krw: 0, ordered_krw: 0, mode: 'vps', dry_run: true },
      { date: '2026-11-24', total_eval_krw: 10000000, cash_krw: 9770000, etf_eval_krw: 230000, ordered_krw: 231810, mode: 'vps', dry_run: false },
      { date: '2026-11-25', total_eval_krw: 10231810, cash_krw: 7681900, etf_eval_krw: 2549910, ordered_krw: 231810, mode: 'vps', dry_run: false }
    ]
  };

  var DEMO_RUNS = [
    { id: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', created_at: '2026-11-25T04:01:30Z' },
    { id: 2, status: 'completed', conclusion: 'success', event: 'schedule', created_at: '2026-11-25T01:31:49Z' },
    { id: 3, status: 'completed', conclusion: 'success', event: 'schedule', created_at: '2026-11-24T00:20:00Z' },
    { id: 4, status: 'completed', conclusion: 'failure', event: 'workflow_dispatch', created_at: '2026-11-23T10:00:00Z' },
    { id: 5, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', created_at: '2026-11-23T09:55:00Z' }
  ];

  function isDemoRequested() {
    try {
      return /(?:^|[?&])demo=1(?:&|$)/.test(window.location.search) || window.location.hash === '#demo';
    } catch (e) { return false; }
  }

  function startDemo() {
    state.demo = true;
    state.status = JSON.parse(JSON.stringify(DEMO_STATUS));
    state.runs = DEMO_RUNS.map(function (r, i) {
      r.html_url = ACTIONS_URL;  // 데모에서는 링크도 실제 저장소로
      return r;
    });
    state.vars = { KIS_MODE: 'vps', KIS_DRY_RUN: 'false', KIS_KILL_SWITCH: 'false' };
    state.varsReadable = true;
    state.cachedAt = null;
    document.body.classList.remove('is-locked');
    renderSummary();
    renderPockets();
    renderHoldings();
    renderOrders();
    renderRules();
    renderRuns();
    renderCharts();
    var badge = $('badge-connect');
    if (badge) { badge.className = 'pill pill-off'; badge.textContent = '데모'; }
    ['btn-run', 'btn-kill'].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.disabled = true;
    });
    var hint = $('connect-hint');
    if (hint) {
      hint.className = 'hint';
      hint.textContent = '지금은 데모(예시) 화면입니다. 위에 토큰을 넣으면 실제 계좌 현황이 보입니다.';
    }
    notice('warn', '데모 화면입니다. 숫자는 예시이며 실제 계좌 정보가 아닙니다. 버튼도 동작하지 않습니다.');
  }

  function $(id) { return document.getElementById(id); }
  function show(el, visible) { if (el) el.hidden = !visible; }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }

  function notice(kind, message, actionLabelText, action) {
    var el = $('notice');
    if (!el) return;
    if (!message) { el.hidden = true; el.innerHTML = ''; return; }
    el.className = 'notice' + (kind ? ' ' + kind : '');
    el.innerHTML = '<span>' + escapeHtml(message) + '</span>';
    if (actionLabelText && action) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-ghost';
      btn.type = 'button';
      btn.style.minHeight = '40px';
      btn.style.padding = '6px 12px';
      btn.style.fontSize = '15px';
      btn.textContent = actionLabelText;
      btn.addEventListener('click', action);
      el.appendChild(btn);
    }
    el.hidden = false;
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 4200);
  }

  function askConfirm(title, body, okText) {
    return new Promise(function (resolve) {
      var modal = $('modal');
      var okBtn = $('modal-ok');
      var cancelBtn = $('modal-cancel');
      setText('modal-title', title);
      setText('modal-body', body);
      okBtn.textContent = okText || '확인';

      function close(result) {
        modal.hidden = true;
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        resolve(result);
      }
      function onOk() { close(true); }
      function onCancel() { close(false); }
      function onBackdrop(event) { if (event.target === modal) close(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      modal.hidden = false;
    });
  }

  function setConnectionBadge() {
    var badge = $('badge-connect');
    if (!badge) return;
    var token = getToken();
    if (!token) {
      badge.className = 'pill pill-off';
      badge.textContent = '연결 안 됨';
    } else if (state.status) {
      badge.className = 'pill pill-on';
      badge.textContent = state.cachedAt ? '저장본 표시' : '연결됨';
    } else {
      badge.className = 'pill pill-off';
      badge.textContent = '연결 확인 중';
    }
  }

  function renderLocked() {
    document.body.classList.add('is-locked');
    var hint = $('connect-hint');
    if (hint) {
      hint.className = 'hint';
      hint.textContent = '아직 연결 전입니다. 위 안내대로 토큰을 만들어 붙여 넣으면 계좌 현황이 나타납니다.';
    }
    setConnectionBadge();
  }

  function renderSummary() {
    var s = state.status;
    if (!s) return;
    document.body.classList.remove('is-locked');

    var modeBadge = $('badge-mode');
    if (modeBadge) {
      modeBadge.className = 'pill ' + (s.mode === 'prod' ? 'pill-bad' : 'pill-info');
      modeBadge.textContent = s.mode === 'prod' ? '실전투자' : '모의투자';
    }
    var dryBadge = $('badge-dry');
    if (dryBadge) {
      dryBadge.className = 'pill ' + (s.dry_run ? 'pill-warn' : 'pill-good');
      dryBadge.textContent = s.dry_run ? 'DRY-RUN (주문 안 함)' : '실제 주문';
    }
    var kill = killSwitchValue(state.vars, state.varsReadable);
    var killBadge = $('badge-kill');
    if (killBadge) {
      if (kill === 'true') {
        killBadge.className = 'pill pill-bad';
        killBadge.textContent = '일시중지 중';
      } else if (kill === 'false') {
        killBadge.className = 'pill pill-good';
        killBadge.textContent = '자동매매 가동 중';
      } else {
        killBadge.className = 'pill pill-soft';
        killBadge.textContent = '일시중지 상태 확인 불가';
      }
    }

    var killBtn = $('btn-kill');
    if (killBtn) {
      var paused = kill === 'true';
      killBtn.textContent = paused ? '▶ 자동매매 다시 시작' : '⏸ 자동매매 일시중지';
      killBtn.className = 'btn btn-big ' + (paused ? 'btn-resume' : 'btn-danger');
      killBtn.disabled = (kill === null);
    }
    var controlHint = $('control-hint');
    if (controlHint) {
      controlHint.textContent = state.varsReadable
        ? '일시중지는 다음 실행부터 적용됩니다. 진행 중인 실행은 멈추지 않습니다.'
        : '토큰에 Variables 권한이 없어 일시중지 상태를 읽지 못했습니다. (실행 버튼은 그대로 쓸 수 있습니다)';
    }

    var text = String(s.status_text || '');
    if (s.exit_code && Number(s.exit_code) !== 0) {
      text += ' (오류 코드 ' + escapeHtml(String(s.exit_code)) + ')';
    }
    setText('status-text', text || '상태 문구가 없습니다.');
    setText('val-total', fmtWon(s.account && s.account.total_eval_krw));
    setText('val-cash', fmtWon(s.account && s.account.cash_krw));
    setText('val-etf', fmtWon(s.account && s.account.etf_eval_krw));
    setText('updated-at', (s.updated_at ? String(s.updated_at) : '-') + (state.cachedAt ? ' · 저장본' : ''));
  }

  function renderPockets() {
    var card = $('card-pockets');
    var list = $('pockets-list');
    if (!card || !list) return;
    var pockets = (state.status && Array.isArray(state.status.pockets)) ? state.status.pockets : [];
    if (!pockets.length) {
      card.hidden = true;
      list.innerHTML = '';
      return;
    }
    card.hidden = false;
    list.innerHTML = pockets.map(function (p) {
      var ret = Number(p.return_pct || 0);
      var retCls = ret > 0 ? 'pos' : (ret < 0 ? 'neg' : '');
      var retText = (ret > 0 ? '+' : '') + ret.toFixed(2) + '%';
      var dateText = p.last_rebal_date ? ('진입/교체일 ' + p.last_rebal_date) : '첫 진입 대기';
      return '<div class="pocket-item">' +
        '<div class="pocket-head">' +
          '<div>' +
            '<div class="pocket-name">' + esc(p.name) + '</div>' +
            '<div class="pocket-cycle">' + esc(p.cycle || '') + ' · ' + esc(dateText) + '</div>' +
          '</div>' +
          '<div class="pocket-ret ' + retCls + '">' + esc(retText) + '</div>' +
        '</div>' +
        '<div class="pocket-eval">평가 <strong>' + esc(won(p.eval_krw)) + '</strong> · 원금 ' + esc(won(p.capital_krw)) + '</div>' +
        '<div class="pocket-hold">보유: ' + esc(p.holdings_text || '현금 대기') + '</div>' +
        '<div class="pocket-reason">' + esc(p.signal_reason || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderHoldings() {
    var list = $('holdings-list');
    var empty = $('holdings-empty');
    if (!list) return;
    var holdings = (state.status && state.status.holdings) || [];
    if (!holdings.length) {
      list.innerHTML = '';
      show(empty, true);
      return;
    }
    show(empty, false);
    var tolerance = Number((state.status.rules && state.status.rules.tolerance_pct) || 3);
    var html = holdings.map(function (h) {
      var label = actionLabel(h.action);
      var target = toNumber(h.target_pct);
      var current = toNumber(h.current_pct);
      var over = current > target + tolerance;
      var targetWidth = Math.max(0, Math.min(100, target));
      var currentWidth = Math.max(0, Math.min(100, current));
      return '' +
        '<div class="holding">' +
          '<div class="holding-top">' +
            '<div>' +
              '<div class="holding-name">' + escapeHtml(h.name || h.code) + '</div>' +
              '<div class="holding-code">' + escapeHtml(h.code) + '</div>' +
            '</div>' +
            '<span class="pill ' + label.cls + '">' + escapeHtml(label.text) + '</span>' +
          '</div>' +
          '<div class="holding-row">' +
            '<span>보유 <b>' + toNumber(h.qty).toLocaleString('ko-KR') + '주</b></span>' +
            '<span>현재가 <b>' + fmtWon(h.price_krw) + '</b></span>' +
            '<span>평가 <b>' + fmtWon(h.eval_krw) + '</b></span>' +
            '<span>이번 주문 <b>' + toNumber(h.order_qty).toLocaleString('ko-KR') + '주</b></span>' +
          '</div>' +
          '<div class="weight-bars">' +
            '<div class="bar-line"><span>목표</span>' +
              '<div class="bar-track"><div class="bar-fill target" style="width:' + targetWidth + '%"></div></div>' +
              '<span class="bar-value">' + fmtPct(target) + '</span></div>' +
            '<div class="bar-line"><span>현재</span>' +
              '<div class="bar-track"><div class="bar-fill ' + (over ? 'over' : 'current') + '" style="width:' + currentWidth + '%"></div></div>' +
              '<span class="bar-value">' + fmtPct(current) + '</span></div>' +
          '</div>' +
        '</div>';
    }).join('');
    list.innerHTML = html;
  }

  function renderOrders() {
    var list = $('orders-list');
    var empty = $('orders-empty');
    if (!list) return;
    var orders = (state.status && state.status.orders) || [];
    if (!orders.length) {
      list.innerHTML = '';
      show(empty, true);
      return;
    }
    show(empty, false);
    list.innerHTML = orders.map(function (o) {
      var side = String(o.side || '');
      var sideText = side === 'sell' ? '매도' : '매수';
      var st = orderStatusLabel(o.status);
      var cls = 'order' + (side === 'sell' ? ' sell' : '') + (st.text === '실패' ? ' fail' : '');
      var orderNo = o.order_no ? ('주문번호 ' + escapeHtml(String(o.order_no))) : '주문번호 없음';
      return '' +
        '<div class="' + cls + '">' +
          '<div class="order-top">' +
            '<div class="order-name">' + escapeHtml(o.name || o.code) + '</div>' +
            '<span class="pill ' + (side === 'sell' ? 'pill-warn' : 'pill-info') + '">' + sideText + '</span>' +
          '</div>' +
          '<div class="order-meta"><b>' + toNumber(o.qty).toLocaleString('ko-KR') + '주</b> × <b>' +
            fmtWon(o.price_krw) + '</b> = <b>' + fmtWon(o.amount_krw) + '</b></div>' +
          '<div class="order-no">' + orderNo + ' · <span class="pill ' + st.cls + '">' + escapeHtml(st.text) + '</span></div>' +
        '</div>';
    }).join('');
  }

  function renderRules() {
    var grid = $('rules-grid');
    var chips = $('rules-targets');
    if (!grid) return;
    var rules = (state.status && state.status.rules) || {};
    var items = [
      { label: '1회 주문 상한', value: fmtWon(rules.max_order_krw_per_trade) },
      { label: '1일 주문 한도', value: fmtWon(rules.max_daily_order_krw) },
      { label: '허용 오차', value: '±' + toNumber(rules.tolerance_pct) + '%' },
      { label: '매도 허용', value: rules.allow_sell ? '허용' : '안 함' },
      { label: '실행 시간', value: rules.trading_window || '-', small: true },
      { label: '자동 점검', value: '평일 09:20', small: true }
    ];
    grid.innerHTML = items.map(function (it) {
      return '<div class="rule">' +
        '<div class="rule-label">' + escapeHtml(it.label) + '</div>' +
        '<div class="rule-value' + (it.small ? ' small' : '') + '">' + escapeHtml(it.value) + '</div>' +
        '</div>';
    }).join('');

    if (chips) {
      var targets = rules.targets || [];
      chips.innerHTML = targets.map(function (t) {
        return '<span class="pill pill-soft">' + escapeHtml(t.name || t.code) + ' ' + fmtPct(t.target_pct, 0) + '</span>';
      }).join('');
      show(chips, targets.length > 0);
    }
  }

  function renderRuns() {
    var list = $('runs-list');
    var empty = $('runs-empty');
    if (!list) return;
    var runs = state.runs || [];
    if (!runs.length) {
      list.innerHTML = '';
      show(empty, true);
      return;
    }
    show(empty, false);
    list.innerHTML = runs.map(function (run) {
      var st = runState(run);
      var url = run.html_url || (ACTIONS_URL + '/runs/' + run.id);
      return '<a class="run" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
        '<span class="run-dot ' + st.dot + '"></span>' +
        '<span class="run-main">' +
          '<span class="run-title">' + escapeHtml(runTitle(run)) + ' · ' + escapeHtml(st.text) + '</span>' +
          '<span class="run-sub">' + escapeHtml(kstDateTime(run.created_at)) + '</span>' +
        '</span>' +
        '<span class="run-go">›</span>' +
      '</a>';
    }).join('');
  }

  function chartGuard(canvasId, message) {
    var canvas = $(canvasId);
    if (!canvas || !canvas.parentNode) return null;
    var box = canvas.parentNode;
    if (box.getAttribute('data-guard') === '1') return null;
    if (typeof Chart === 'undefined') {
      box.setAttribute('data-guard', '1');
      box.innerHTML = '<p class="empty">' + escapeHtml(message) + '</p>';
      return null;
    }
    return canvas;
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') {
      chartGuard('chart-weights', '차트를 불러오지 못했습니다. 인터넷에 연결한 뒤 새로고침해 주세요.');
      chartGuard('chart-history', '차트를 불러오지 못했습니다. 인터넷에 연결한 뒤 새로고침해 주세요.');
      return;
    }
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#33456b';
    Chart.defaults.font.size = 14;

    var weights = buildWeightChartData(state.status && state.status.holdings);
    if (weights.labels.length) {
      var maxShare = 0;
      weights.target.concat(weights.current).forEach(function (v) { if (v > maxShare) maxShare = v; });
      // 100% 고정 눈금은 막대를 지나치게 짧게 만든다. 실제 값에 맞춰 눈금을 줄인다(최대 100%).
      var axisMax = Math.min(100, Math.max(50, Math.ceil((maxShare * 1.25) / 10) * 10));
      var wCanvas = chartGuard('chart-weights', '');
      if (wCanvas) {
        if (state.charts.weights) state.charts.weights.destroy();
        state.charts.weights = new Chart(wCanvas, {
          type: 'bar',
          data: {
            labels: weights.labels,
            datasets: [
              { label: '목표 %', data: weights.target, backgroundColor: '#b9c6dd', borderRadius: 6 },
              { label: '현재 %', data: weights.current, backgroundColor: '#1a56db', borderRadius: 6 }
            ]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
              x: { beginAtZero: true, max: axisMax, grid: { color: '#e8edf7' }, ticks: { callback: function (v) { return v + '%'; } } },
              y: { grid: { display: false } }
            },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 16, font: { size: 15, weight: '700' } } },
              tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ' ' + ctx.parsed.x + '%'; } } }
            }
          }
        });
      }
    }

    var history = buildHistoryChartData(state.status && state.status.history);
    var historyEmpty = $('chart-history-empty');
    if (history.count < 2) {
      show(historyEmpty, true);
      if (state.charts.history) { state.charts.history.destroy(); state.charts.history = null; }
    } else {
      show(historyEmpty, false);
      var hCanvas = chartGuard('chart-history', '');
      if (hCanvas) {
        if (state.charts.history) state.charts.history.destroy();
        state.charts.history = new Chart(hCanvas, {
          type: 'bar',
          data: {
            labels: history.labels,
            datasets: [
              {
                type: 'line', label: '총평가금액(만원)', data: history.total,
                borderColor: '#1a56db', backgroundColor: 'rgba(26,86,219,0.12)',
                borderWidth: 3, pointRadius: 3, tension: 0.3, fill: true, yAxisID: 'y'
              },
              {
                type: 'bar', label: '매수 금액(만원)', data: history.ordered,
                backgroundColor: '#f0b429', borderRadius: 6, yAxisID: 'y1', maxBarThickness: 26
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: { position: 'left', beginAtZero: false, grid: { color: '#e8edf7' }, ticks: { callback: function (v) { return v.toLocaleString('ko-KR'); } } },
              y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { callback: function (v) { return v.toLocaleString('ko-KR'); } } },
              x: { grid: { display: false } }
            },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 16, font: { size: 15, weight: '700' } } }
            }
          }
        });
      }
    }
  }

  function renderAll() {
    if (!getToken()) { renderLocked(); return; }
    state.statusNotFound = !state.status;
    if (!state.status) {
      document.body.classList.add('is-locked');
      setConnectionBadge();
      notice('warn', '아직 실행 기록(data/status.json)이 없습니다. 자동매매가 한 번 실행되면 여기에 나타납니다.');
      return;
    }
    notice(state.cachedAt ? 'warn' : '', state.cachedAt
      ? '최근 저장본을 보여 주고 있습니다 (' + kstDateTime(new Date(state.cachedAt).toISOString()) + ' 기준).'
      : '');
    renderSummary();
    renderPockets();
    renderHoldings();
    renderOrders();
    renderRules();
    renderRuns();
    renderCharts();
    setConnectionBadge();
  }

  // ===========================================================================
  // 5. 새로고침·제어
  // ===========================================================================
  function setLoading(loading) {
    state.loading = loading;
    var btn = $('btn-refresh');
    if (btn) btn.disabled = loading;
  }

  function refresh() {
    if (!getToken()) {
      if (state.demo) { startDemo(); } else { renderLocked(); }
      return Promise.resolve();
    }
    setLoading(true);
    return Promise.all([
      fetchStatus().catch(function (err) { return { error: err }; }),
      fetchRuns().catch(function () { return []; }),
      fetchVariables().catch(function () { return { vars: {}, readable: false }; })
    ]).then(function (results) {
      var statusResult = results[0];
      var runs = results[1];
      var varResult = results[2];

      state.runs = runs;
      if (varResult && varResult.readable !== undefined) {
        state.vars = varResult.vars || {};
        state.varsReadable = !!varResult.readable;
      }

      if (statusResult && statusResult.error) {
        var cached = readCache();
        if (cached && cached.status) {
          state.status = cached.status;
          state.cachedAt = cached.at || null;
          renderAll();
        } else {
          state.status = null;
          document.body.classList.add('is-locked');
          setConnectionBadge();
        }
        var hint = $('connect-hint');
        if (hint) { hint.className = 'hint error'; hint.textContent = apiErrorText(statusResult.error); }
        var badgeErr = $('badge-connect');
        if (badgeErr) { badgeErr.className = 'pill pill-off'; badgeErr.textContent = '연결 오류'; }
        notice('bad', apiErrorText(statusResult.error), '설정 열기', function () {
          $('connect-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        renderRuns();
        return;
      }

      state.cachedAt = null;
      if (statusResult && statusResult.status) {
        state.status = statusResult.status;
        writeCache({ status: state.status, runs: state.runs, vars: state.vars, varsReadable: state.varsReadable, at: Date.now() });
        var hintOk = $('connect-hint');
        if (hintOk) { hintOk.className = 'hint'; hintOk.textContent = '연결됨 · 토큰 ' + maskToken(getToken()) + ' 로 읽고 있습니다.'; }
        renderAll();
      } else {
        state.status = null;
        renderAll();
        renderRuns();
      }
    }).catch(function (err) {
      notice('bad', apiErrorText(err));
    }).then(function () {
      setLoading(false);
    });
  }

  function doRun() {
    if (state.demo) { toast('데모 화면에서는 실행할 수 없습니다.'); return Promise.resolve(); }
    return askConfirm(
      '지금 1회 실행할까요?',
      'GitHub에서 자동매매를 한 번 실행합니다.\n현재 설정(' + modeText() + ') 그대로 실행되며, 주문은 평소와 같은 한도 안에서 나갑니다.',
      '실행'
    ).then(function (ok) {
      if (!ok) return;
      var btn = $('btn-run');
      if (btn) btn.disabled = true;
      notice('', '실행을 요청하는 중입니다...');
      return dispatchRun(state.vars).then(function () {
        notice('good', '실행을 요청했습니다. 1~2분 뒤 결과가 자동으로 새로고침됩니다.');
        toast('실행 요청 완료');
        setTimeout(refresh, 75000);
        setTimeout(refresh, 150000);
      }).catch(function (err) {
        notice('bad', '실행 요청 실패: ' + apiErrorText(err));
      }).then(function () {
        if (btn) btn.disabled = false;
      });
    });
  }

  function modeText() {
    var mode = state.status ? (state.status.mode === 'prod' ? '실전투자' : '모의투자') : '모의투자';
    var dry = state.status ? (state.status.dry_run ? 'DRY-RUN' : '실제 주문') : '';
    return dry ? mode + ' · ' + dry : mode;
  }

  function doToggleKill() {
    if (state.demo) { toast('데모 화면에서는 바꿀 수 없습니다.'); return Promise.resolve(); }
    var kill = killSwitchValue(state.vars, state.varsReadable);
    if (kill === null) {
      notice('warn', '토큰에 Variables 권한(읽기·쓰기)이 없어 일시중지를 바꿀 수 없습니다.');
      return Promise.resolve();
    }
    var pause = kill !== 'true';
    var title = pause ? '자동매매를 일시중지할까요?' : '자동매매를 다시 시작할까요?';
    var body = pause
      ? '다음 실행부터 아무 주문도 하지 않습니다.\n이미 진행 중인 실행은 멈추지 않습니다.'
      : '다음 실행부터 평소처럼 자동으로 점검·주문합니다.';
    return askConfirm(title, body, pause ? '일시중지' : '다시 시작').then(function (ok) {
      if (!ok) return;
      var btn = $('btn-kill');
      if (btn) btn.disabled = true;
      return setKillSwitch(pause).then(function () {
        state.vars.KIS_KILL_SWITCH = pause ? 'true' : 'false';
        renderSummary();
        toast(pause ? '자동매매를 일시중지했습니다.' : '자동매매를 다시 시작했습니다.');
        notice('good', pause
          ? '일시중지했습니다. 다음 실행부터 주문하지 않습니다.'
          : '다시 시작했습니다. 다음 실행부터 평소처럼 동작합니다.');
      }).catch(function (err) {
        notice('bad', '일시중지 설정 실패: ' + apiErrorText(err));
      }).then(function () {
        if (btn) btn.disabled = false;
      });
    });
  }

  // ===========================================================================
  // 6. 시작
  // ===========================================================================
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:') return;
    try {
      navigator.serviceWorker.register('sw.js')['catch'](function () { /* 등록 실패해도 앱은 동작 */ });
    } catch (e) { /* ignore */ }
  }

  function bindEvents() {
    var form = $('token-form');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = $('token-input');
        var result = normalizeToken(input ? input.value : '');
        var hint = $('connect-hint');
        if (!result.ok) {
          if (hint) {
            hint.className = 'hint error';
            hint.textContent = result.reason === 'prefix'
              ? 'github_pat_ 또는 ghp_ 로 시작하는 토큰을 붙여 넣어 주세요.'
              : '토큰이 비어 있거나 너무 짧습니다. 다시 확인해 주세요.';
          }
          return;
        }
        saveToken(result.token);
        if (input) input.value = '';
        if (hint) { hint.className = 'hint'; hint.textContent = '토큰을 저장했습니다. 계좌 현황을 불러오는 중입니다...'; }
        refresh();
      });
    }

    var clearBtn = $('btn-clear-token');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        askConfirm('토큰을 삭제할까요?', '이 휴대폰에서 토큰을 지웁니다. 계좌 현황은 더 이상 보이지 않습니다.', '삭제')
          .then(function (ok) {
            if (!ok) return;
            clearToken();
            storageRemove(CACHE_KEY);
            state.status = null;
            state.runs = [];
            state.vars = {};
            state.varsReadable = false;
            renderLocked();
            toast('토큰을 삭제했습니다.');
          });
      });
    }

    var refreshBtn = $('btn-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { refresh(); });

    var runBtn = $('btn-run');
    if (runBtn) runBtn.addEventListener('click', function () { doRun(); });

    var killBtn = $('btn-kill');
    if (killBtn) killBtn.addEventListener('click', function () { doToggleKill(); });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && getToken()) refresh();
    });
  }

  function init() {
    bindEvents();
    registerServiceWorker();
    var token = getToken();
    if (!token) {
      if (isDemoRequested()) {
        var demoGuide = $('token-guide');
        if (demoGuide) demoGuide.open = false;
        startDemo();
        return;
      }
      renderLocked();
      var guide = $('token-guide');
      if (guide) guide.open = true;
      return;
    }
    var cached = readCache();
    if (cached && cached.status) {
      state.status = cached.status;
      state.runs = cached.runs || [];
      state.vars = cached.vars || {};
      state.varsReadable = !!cached.varsReadable;
      state.cachedAt = cached.at || null;
      renderAll();
    }
    refresh();
    setInterval(function () {
      if (document.visibilityState === 'visible' && getToken()) refresh();
    }, AUTO_REFRESH_MS);
  }

  // 테스트·디버깅용으로 순수 함수만 밖으로 내보낸다 (토큰은 절대 내보내지 않음)
  var exported = {
    escapeHtml: escapeHtml,
    fmtWon: fmtWon,
    fmtWonShort: fmtWonShort,
    fmtEokWon: fmtEokWon,
    fmtPct: fmtPct,
    decodeBase64Utf8: decodeBase64Utf8,
    normalizeToken: normalizeToken,
    maskToken: maskToken,
    kstDateTime: kstDateTime,
    shortDate: shortDate,
    actionLabel: actionLabel,
    orderStatusLabel: orderStatusLabel,
    runState: runState,
    runTitle: runTitle,
    pickWorkflowInputs: pickWorkflowInputs,
    killSwitchValue: killSwitchValue,
    buildWeightChartData: buildWeightChartData,
    buildHistoryChartData: buildHistoryChartData,
    apiErrorText: apiErrorText,
    refresh: refresh,
    state: state
  };
  if (typeof window !== 'undefined') window.KISDash = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
