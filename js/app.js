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

  /* ---------- 소개 영상 (클릭하기 전에는 유튜브에 접속하지 않음) ---------- */
  var vbox = $('#video-box');
  if (vbox && /^[A-Za-z0-9_-]{11}$/.test(S.VIDEO_ID || '')) {
    vbox.hidden = false;
    $('#video-link').setAttribute('href', 'https://youtu.be/' + S.VIDEO_ID);
    $('#video-play').addEventListener('click', function () {
      var f = h('iframe', {
        src: 'https://www.youtube-nocookie.com/embed/' + S.VIDEO_ID + '?autoplay=1&rel=0',
        title: '학술대회 소개 영상', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin'
      });
      vbox.innerHTML = '';
      vbox.appendChild(f);
    });
  } else if ($('#video')) {
    $('#video').hidden = true;
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

  /* ---------- 공동저자 입력 목록 ---------- */
  var MAX_CO = 5;
  var ROLES = ['주저자', '공동저자', '교신저자'];
  function authorsLine(a) { return a && a.text ? a.text : ''; }
  function coWidget(list, addBtn) {
    function sync() { addBtn.disabled = list.children.length >= MAX_CO; }
    function addRow(name, aff, role) {
      var n = h('input', { type: 'text', placeholder: '성명', maxlength: '50', 'aria-label': '공동저자 성명' });
      var a = h('input', { type: 'text', placeholder: '소속', maxlength: '100', 'aria-label': '공동저자 소속' });
      var sel = h('select', { 'aria-label': '저자 구분' }, ROLES.map(function (x) { return h('option', { text: x }); }));
      sel.value = role || '공동저자';
      var rm = h('button', { type: 'button', 'class': 'btn ghost small', 'aria-label': '이 저자 삭제', text: '삭제' });
      n.value = name || ''; a.value = aff || '';
      var row = h('div', { 'class': 'co-row' }, [n, a, sel, rm]);
      rm.addEventListener('click', function () { list.removeChild(row); sync(); });
      list.appendChild(row); sync();
      return n;
    }
    addBtn.addEventListener('click', function () { if (list.children.length >= MAX_CO) return; addRow().focus(); });
    return {
      get: function () {
        return $$('.co-row', list).map(function (r) { var i = r.querySelectorAll('input'); return { name: i[0].value.trim(), affiliation: i[1].value.trim(), role: r.querySelector('select').value }; })
          .filter(function (c) { return c.name || c.affiliation; });
      },
      set: function (arr) { list.textContent = ''; (arr || []).slice(0, MAX_CO).forEach(function (c) { addRow(c.name, c.affiliation, c.role); }); sync(); },
      clear: function () { list.textContent = ''; sync(); }
    };
  }
  function coError(list) {
    for (var i = 0; i < list.length; i++) if (!list[i].name) return '함께한 저자의 성명을 입력해 주세요.';
    return null;
  }

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
      $('#grp-coauth').hidden = k === 'discussant';
    }
    $$('input[name=kind]', applyForm).forEach(function (r) { r.addEventListener('change', toggle); });
    toggle();

    var coApply = coWidget($('#coauth-list'), $('#coauth-add'));
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
      else if (k !== 'discussant' && coError(coApply.get())) err = coError(coApply.get());
      else if (!applyForm.elements.privacy.checked) err = '개인정보 수집·이용에 동의해 주세요.';
      if (err) { show(box, 'err', err); return; }

      busy(btn, true);
      Promise.all([readFile($('#f-abs-file'), EXT_ABS), readFile($('#f-full-file'), EXT_FULL)]).then(function (f) {
        var payload = {
          action: 'apply', kind: k, name: d.name, affiliation: d.affiliation, phone: d.phone, email: d.email,
          title: k === 'discussant' ? '' : d.title, abstract: k === 'discussant' ? '' : d.abstract,
          topics: k === 'discussant' ? d.topics : [],
          coauthors: k === 'discussant' ? [] : coApply.get(),
          role: k === 'discussant' ? '' : $('#f-role').value, equal: k !== 'discussant' && $('#f-equal').checked,
          consent: { privacy: true, publish: k === 'discussant' ? 'none' : applyForm.elements.publish.value },
          files: {}, website: val(applyForm, 'website')
        };
        if (f[0]) payload.files.abstract = f[0];
        if (f[1]) payload.files.fulltext = f[1];
        return api(payload);
      }).then(function (res) {
        show(box, 'ok', ['신청이 접수되었습니다. 접수번호를 보관해 주세요.', h('span', { 'class': 'big', text: res.id }), '확인 메일을 보냈습니다. 메일이 없으면 스팸함을 확인해 주세요.']);
        applyForm.reset(); coApply.clear(); toggle(); cnt.textContent = '0 / 3,000';
      }).catch(function (e) { show(box, 'err', e.message); }).then(function () { busy(btn, false); });
    });

    // 자료 제출 · 내용 수정
    var fin = $('#final-form');
    var coFinal = coWidget($('#g-coauth-list'), $('#g-coauth-add'));
    var gAbs = $('#g-abstract'), gCnt = $('#g-abstract-count');
    var loaded = null;   // 불러온 신청 내용 (불러온 뒤에만 제목·초록 등을 함께 보냄)
    gAbs.addEventListener('input', function () { gCnt.textContent = gAbs.value.length.toLocaleString('ko-KR') + ' / 3,000'; });
    function resetLoaded() { loaded = null; $('#g-edit').hidden = true; $('#g-abs').disabled = false; $('#g-full').disabled = false; }
    ['g-id', 'g-email'].forEach(function (i) { $('#' + i).addEventListener('input', resetLoaded); });

    $('#g-load').addEventListener('click', function () {
      var box = $('#final-msg'), btn = $('#g-load');
      box.hidden = true;
      var id = val(fin, 'id'), email = val(fin, 'email');
      if (!id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show(box, 'err', '접수번호와 이메일을 확인해 주세요.'); return; }
      busy(btn, true);
      api({ action: 'lookup', id: id, email: email, website: val(fin, 'website') }).then(function (r) {
        if (!r.editable) { show(box, 'err', '수정 기간(' + (r.deadline || '11월 20일') + ')이 지났습니다. 조직위원회로 문의해 주세요.'); return; }
        loaded = r;
        $('#g-edit-paper').hidden = !!r.discussant;
        $('#g-edit-topics').hidden = !r.discussant;
        if (r.discussant) { $('#g-topics').value = r.topics || ''; }
        else {
          $('#g-title').value = r.title || ''; gAbs.value = r.abstract || '';
          gCnt.textContent = gAbs.value.length.toLocaleString('ko-KR') + ' / 3,000';
          coFinal.set(r.coauthors);
          $('#g-role').value = r.role || '주저자'; $('#g-equal').checked = !!r.equal;
        }
        $('#g-edit').hidden = false;
        var filesClosed = r.filesOpen === false;
        ['#g-abs', '#g-full'].forEach(function (s) { $(s).disabled = filesClosed; if (filesClosed) $(s).value = ''; });
        show(box, 'ok', '현재 저장된 내용을 불러왔습니다. 고칠 항목을 수정하고 “저장”을 눌러 주세요.' +
          (filesClosed ? ' 파일 제출은 ' + (r.filesDeadline || '11월 15일') + '에 마감되어 제목·초록·저자만 고칠 수 있습니다.' : ''));
      }).catch(function (e) { show(box, 'err', e.message); }).then(function () { busy(btn, false); });
    });

    fin.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var box = $('#final-msg'), btn = $('#final-submit');
      box.hidden = true;
      var id = val(fin, 'id'), email = val(fin, 'email');
      if (!id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show(box, 'err', '접수번호와 이메일을 확인해 주세요.'); return; }
      var hasFile = $('#g-abs').files.length || $('#g-full').files.length;
      var edit = null;
      if (loaded) {
        if (loaded.discussant) {
          var tp = $('#g-topics').value.trim() ? $('#g-topics').value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
          if (tp.length < 1 || tp.length > 3) { show(box, 'err', '희망 분야를 쉼표로 구분해 1~3개 입력해 주세요.'); return; }
          edit = { topics: tp };
        } else {
          var t = $('#g-title').value.trim(), ab = gAbs.value.trim(), co = coFinal.get();
          if (!t) { show(box, 'err', '논문 제목을 입력해 주세요.'); return; }
          if (ab.length < 30) { show(box, 'err', '초록을 30자 이상 입력해 주세요.'); return; }
          if (coError(co)) { show(box, 'err', coError(co)); return; }
          edit = { title: t, abstract: ab, coauthors: co, role: $('#g-role').value, equal: $('#g-equal').checked };
        }
      }
      if (!hasFile && !edit && !fin.elements.publish.value) { show(box, 'err', '제출할 파일을 하나 이상 선택하거나, “내용 불러오기”로 수정할 항목을 불러와 주세요.'); return; }
      busy(btn, true);
      Promise.all([readFile($('#g-abs'), EXT_ABS), readFile($('#g-full'), EXT_FULL)]).then(function (f) {
        var files = {};
        if (f[0]) files.abstract = f[0];
        if (f[1]) files.fulltext = f[1];
        var payload = { action: 'final', id: id, email: email, files: files, publish: fin.elements.publish.value, website: val(fin, 'website') };
        if (edit) Object.keys(edit).forEach(function (k) { payload[k] = edit[k]; });
        return api(payload);
      }).then(function (res) {
        var nodes = [res.message, h('span', { 'class': 'big', text: id + ' · v' + res.version })];
        if (res.changed && res.changed.length) nodes.push('변경 내용: ' + res.changed.join(', '));
        show(box, 'ok', nodes);
        fin.reset(); resetLoaded(); coFinal.clear();
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
          (r.coauthors && r.coauthors.length) ? '함께한 저자: ' + r.coauthors.map(function (c) { return c.name + (c.affiliation ? '(' + c.affiliation + ')' : '') + '[' + c.role + ']'; }).join(', ') + (r.equal ? ' · 동등 기여(가나다순)' : '') : '', (r.coauthors && r.coauthors.length) ? h('br') : '',
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
      var co = ((it.authors && it.authors.list) || []).map(function (c) { return c.name + ' ' + c.affiliation; }).join(' ');
      return [it.title, it.name, it.affiliation, co, absBox ? it.abstract : ''].join(' ').toLowerCase().indexOf(term) >= 0;
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
      if (authorsLine(it.authors)) kids.push(h('div', { 'class': 'who', text: '저자 ' + authorsLine(it.authors) }));
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
