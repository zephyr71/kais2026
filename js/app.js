(function () {
  'use strict';
  var S = window.SITE || {};
  var MAX_BYTES = 8 * 1024 * 1024;
  var EXT_ABS = ['hwp', 'hwpx', 'doc', 'docx', 'pdf'];
  var EXT_FULL = ['hwp', 'hwpx', 'doc', 'docx', 'pdf', 'ppt', 'pptx'];

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') e.textContent = props[k];
      else e.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  /* ---------- 공통 ---------- */
  var page = location.pathname.split('/').pop() || 'index.html';
  $$('.nav a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (!a.classList.contains('cta') && href.indexOf('#') < 0 && href === page) a.setAttribute('aria-current', 'page');
  });
  var contact = $('#contact');
  if (contact && S.CONTACT_EMAIL) {
    contact.appendChild(document.createTextNode('문의 '));
    contact.appendChild(h('a', { href: 'mailto:' + S.CONTACT_EMAIL, text: S.CONTACT_EMAIL }));
  }
  var acc = $('#account');
  if (acc && S.ACCOUNT && S.ACCOUNT.number) {
    $('#account-text').textContent = [S.ACCOUNT.bank, S.ACCOUNT.number, S.ACCOUNT.holder ? '예금주 ' + S.ACCOUNT.holder : ''].filter(Boolean).join(' · ');
    acc.hidden = false;
  }

  /* ---------- API ---------- */
  function api(payload) {
    if (!S.API_URL) return Promise.reject(new Error('접수 기능이 아직 연결되지 않았습니다. 조직위원회에 문의해 주세요.'));
    return fetch(S.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 사전 요청(preflight) 없이 보내기 위함
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.ok === false) throw new Error((d && d.error) || '처리하지 못했습니다.');
      return d;
    });
  }

  function readFile(input, allowed) {
    var f = input && input.files && input.files[0];
    if (!f) return Promise.resolve(null);
    var ext = f.name.indexOf('.') >= 0 ? f.name.split('.').pop().toLowerCase() : '';
    if (allowed.indexOf(ext) < 0) return Promise.reject(new Error('허용되지 않는 파일 형식입니다: ' + f.name));
    if (f.size > MAX_BYTES) return Promise.reject(new Error('파일은 8MB 이하로 올려 주세요: ' + f.name));
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve({ name: f.name, data: String(fr.result) }); };
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다: ' + f.name)); };
      fr.readAsDataURL(f);
    });
  }

  function show(box, type, nodes) {
    box.className = 'msg ' + type;
    box.textContent = '';
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) { box.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
    box.hidden = false;
  }
  function busy(btn, on) { btn.disabled = on; if (!btn.dataset.t) btn.dataset.t = btn.textContent; btn.textContent = on ? '처리 중…' : btn.dataset.t; }
  function val(form, name) { var el = form.elements[name]; return el ? String(el.value || '').trim() : ''; }

  /* ---------- 신청 페이지 ---------- */
  var applyForm = $('#apply-form');
  if (applyForm) {
    // 탭
    var tabs = $$('[role=tab]');
    function selectTab(name) {
      tabs.forEach(function (t) {
        var on = t.dataset.tab === name;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        $('#panel-' + t.dataset.tab).hidden = !on;
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        selectTab(t.dataset.tab);
        try { history.replaceState(null, '', '#' + t.dataset.tab); } catch (e) { /* file:// 등에서는 주소 갱신을 건너뜀 */ }
      });
      t.addEventListener('keydown', function (ev) {
        var n = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : null;
        if (n === null) return;
        var nt = tabs[(n + tabs.length) % tabs.length];
        nt.focus(); nt.click();
      });
    });
    var hash = location.hash.replace('#', '');
    selectTab(['apply', 'final', 'lookup'].indexOf(hash) >= 0 ? hash : 'apply');

    // 유형별 입력칸
    function kind() { return applyForm.elements.kind.value; }
    function toggle() {
      var k = kind();
      $('#grp-paper').hidden = k === 'discussant';
      $('#grp-topics').hidden = k !== 'discussant';
      $('#grp-publish').hidden = k === 'discussant';
    }
    $$('input[name=kind]', applyForm).forEach(function (r) { r.addEventListener('change', toggle); });
    toggle();

    var ta = $('#f-abstract'), cnt = $('#abstract-count');
    ta.addEventListener('input', function () { cnt.textContent = ta.value.length.toLocaleString('ko-KR') + ' / 3,000'; });

    applyForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var box = $('#apply-msg'), btn = $('#apply-submit');
      box.hidden = true;
      var k = kind();
      var d = {
        name: val(applyForm, 'name'), affiliation: val(applyForm, 'affiliation'), phone: val(applyForm, 'phone'),
        email: val(applyForm, 'email'), title: val(applyForm, 'title'), abstract: ta.value.trim(),
        topics: val(applyForm, 'topics').split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean)
      };
      var err = null;
      if (!d.name) err = '성명을 입력해 주세요.';
      else if (!d.affiliation) err = '소속을 입력해 주세요.';
      else if (!/^[0-9+\-\s()]{8,20}$/.test(d.phone)) err = '전화번호를 확인해 주세요.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) err = '이메일 주소를 확인해 주세요.';
      else if (k === 'discussant' && (d.topics.length < 1 || d.topics.length > 3)) err = '희망 분야를 쉼표로 구분해 2~3개 입력해 주세요.';
      else if (k !== 'discussant' && !d.title) err = '논문 제목(가제목)을 입력해 주세요.';
      else if (k !== 'discussant' && d.abstract.length < 30) err = '초록을 30자 이상 입력해 주세요.';
      else if (k !== 'discussant' && !applyForm.elements.publish.value) err = '공개 범위를 선택해 주세요.';
      else if (!applyForm.elements.privacy.checked) err = '개인정보 수집·이용에 동의해 주세요.';
      if (err) { show(box, 'err', err); return; }

      busy(btn, true);
      Promise.all([readFile($('#f-abs-file'), EXT_ABS), readFile($('#f-full-file'), EXT_FULL)]).then(function (f) {
        var payload = {
          action: 'apply', kind: k, name: d.name, affiliation: d.affiliation, phone: d.phone, email: d.email,
          title: k === 'discussant' ? '' : d.title, abstract: k === 'discussant' ? '' : d.abstract,
          topics: k === 'discussant' ? d.topics : [],
          consent: { privacy: true, publish: k === 'discussant' ? 'none' : applyForm.elements.publish.value },
          files: {}, website: val(applyForm, 'website')
        };
        if (f[0]) payload.files.abstract = f[0];
        if (f[1]) payload.files.fulltext = f[1];
        return api(payload);
      }).then(function (res) {
        show(box, 'ok', ['신청이 접수되었습니다. 접수번호를 보관해 주세요.', h('span', { 'class': 'big', text: res.id }), '확인 메일을 보냈습니다. 메일이 없으면 스팸함을 확인해 주세요.']);
        applyForm.reset(); toggle(); cnt.textContent = '0 / 3,000';
      }).catch(function (e) { show(box, 'err', e.message); }).then(function () { busy(btn, false); });
    });

    // 자료 제출·수정
    var fin = $('#final-form');
    fin.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var box = $('#final-msg'), btn = $('#final-submit');
      box.hidden = true;
      var id = val(fin, 'id'), email = val(fin, 'email');
      if (!id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show(box, 'err', '접수번호와 이메일을 확인해 주세요.'); return; }
      if (!$('#g-abs').files.length && !$('#g-full').files.length) { show(box, 'err', '제출할 파일을 하나 이상 선택해 주세요.'); return; }
      busy(btn, true);
      Promise.all([readFile($('#g-abs'), EXT_ABS), readFile($('#g-full'), EXT_FULL)]).then(function (f) {
        var files = {};
        if (f[0]) files.abstract = f[0];
        if (f[1]) files.fulltext = f[1];
        return api({ action: 'final', id: id, email: email, files: files, publish: fin.elements.publish.value, website: val(fin, 'website') });
      }).then(function (res) {
        show(box, 'ok', [res.message, h('span', { 'class': 'big', text: id + ' · v' + res.version })]);
        fin.reset();
      }).catch(function (e) { show(box, 'err', e.message); }).then(function () { busy(btn, false); });
    });

    // 접수 조회
    var lk = $('#lookup-form');
    lk.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var box = $('#lookup-msg'), btn = $('#lookup-submit');
      box.hidden = true;
      busy(btn, true);
      api({ action: 'lookup', id: val(lk, 'id'), email: val(lk, 'email'), website: val(lk, 'website') }).then(function (r) {
        show(box, 'ok', [
          h('strong', { text: r.id + ' · ' + r.kind }), h('br'),
          r.title ? r.title : '(제목 없음)', h('br'),
          '상태: ' + r.status + ' · 제출 버전: ' + r.version, h('br'),
          '초록 파일: ' + (r.hasAbstractFile ? '있음' : '없음') + ' · 원문/발표자료: ' + (r.hasFullText ? '있음' : '없음')
        ]);
      }).catch(function (e) { show(box, 'err', e.message); }).then(function () { busy(btn, false); });
    });
  }

  /* ---------- 프로그램 · 발제집 ---------- */
  var progBox = $('#program-list'), absBox = $('#abstract-list');
  if (progBox || absBox) {
    var q = $('#q');
    var items = null;
    function loadItems() {
      if (!S.API_URL) return Promise.resolve([]);
      return fetch(S.API_URL + '?action=program').then(function (r) { return r.json(); }).then(function (d) { return (d && d.items) || []; });
    }
    function match(it, term) {
      if (!term) return true;
      return [it.title, it.name, it.affiliation, absBox ? it.abstract : ''].join(' ').toLowerCase().indexOf(term) >= 0;
    }
    function render() {
      var term = q ? q.value.trim().toLowerCase() : '';
      if (progBox) renderProgram(items.filter(function (it) { return match(it, term); }));
      if (absBox) renderAbstracts(items.filter(function (it) { return it.abstract && match(it, term); }));
    }
    function card(it, withMeta) {
      var kids = [];
      if (withMeta) kids.push(h('div', { 'class': 'meta', text: [it.time, it.kind].filter(Boolean).join(' · ') }));
      kids.push(h('h3', { text: it.title || '(제목 미정)' }));
      kids.push(h('div', { 'class': 'who', text: [it.name, it.affiliation].filter(Boolean).join(' · ') }));
      if (it.abstract) kids.push(h('details', {}, [h('summary', { text: '초록 보기' }), h('p', { text: it.abstract })]));
      return h('div', { 'class': 'item' }, kids);
    }
    function renderProgram(list) {
      progBox.textContent = '';
      if (!list.length) { progBox.appendChild(h('p', { 'class': 'empty', text: items.length ? '검색 결과가 없습니다.' : '프로그램은 확정되는 대로 공개됩니다.' })); return; }
      var groups = {}, order = [];
      list.forEach(function (it) { var s = it.session || '세션 미정'; if (!groups[s]) { groups[s] = []; order.push(s); } groups[s].push(it); });
      order.forEach(function (s) {
        progBox.appendChild(h('h2', { 'class': 'session-h', text: s }));
        groups[s].forEach(function (it) { progBox.appendChild(card(it, true)); });
      });
    }
    function renderAbstracts(list) {
      absBox.textContent = '';
      if (!list.length) { absBox.appendChild(h('p', { 'class': 'empty', text: items.length ? '검색 결과가 없습니다.' : '공개 가능한 초록이 확정되는 대로 이곳에 게재됩니다.' })); return; }
      list.forEach(function (it) { absBox.appendChild(card(it, false)); });
    }
    loadItems().then(function (l) { items = l; render(); }).catch(function () {
      items = [];
      (progBox || absBox).textContent = '';
      (progBox || absBox).appendChild(h('p', { 'class': 'empty', text: '목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }));
    });
    if (q) q.addEventListener('input', function () { if (items) render(); });

    var eb = $('#ebook');
    if (eb && S.PROCEEDINGS_URL) {
      $('#ebook-open').href = S.PROCEEDINGS_URL;
      $('#ebook-frame').src = S.PROCEEDINGS_URL;
      eb.hidden = false;
      $('#ebook-none').hidden = true;
    }
  }
})();
