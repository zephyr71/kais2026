// 홈페이지 동작 테스트 (jsdom): node test_site.js <site 폴더>
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const root = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
const ok = name => { n++; console.log('ok  -', name); };

// 외부 자원(구글 폰트)은 불러오지 않고, config.js → (tweak) → app.js 순서로 직접 실행한다.
async function load(file, tweak) {
  const calls = [];
  let reply = { ok: true };
  const dom = await JSDOM.fromFile(path.join(root, file), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url, opts) => { calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null, method: (opts && opts.method) || 'GET' }); return Promise.resolve({ json: () => Promise.resolve(typeof reply === 'function' ? reply(url, opts) : reply) }); };
    }
  });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'));
  if (tweak) tweak(w, v => { reply = v; });
  w.eval(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'));
  return { dom, w, d: w.document, calls, setReply: v => { reply = v; } };
}
const fileOf = (w, name, content) => new w.File([content], name);
const setFiles = (el, files) => Object.defineProperty(el, 'files', { value: files, configurable: true });
const fillBase = (d) => { d.querySelector('#f-name').value = '홍길동'; d.querySelector('#f-affil').value = '광운대학교'; d.querySelector('#f-phone').value = '010-1234-5678'; d.querySelector('#f-email').value = 'hong@example.com'; };
const submit = (w, form) => form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));

(async () => {
  /* ---- 신청 페이지 ---- */
  {
    const { w, d, calls, setReply } = await load('apply.html');
    w.SITE.API_URL = 'https://example.test/exec';
    const form = d.querySelector('#apply-form'), msg = d.querySelector('#apply-msg');

    submit(w, form); await sleep(20);
    assert.ok(msg.textContent.includes('성명을 입력해')); assert.ok(msg.classList.contains('err')); assert.strictEqual(calls.length, 0); ok('빈 신청서는 서버로 보내지 않고 안내 문구 표시');

    d.querySelector('input[name=kind][value=discussant]').checked = true; d.querySelector('input[name=kind][value=discussant]').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(d.querySelector('#grp-topics').hidden, false); assert.strictEqual(d.querySelector('#grp-paper').hidden, true); assert.strictEqual(d.querySelector('#grp-publish').hidden, true); ok('토론·사회 선택 시 희망 분야 칸만 표시');
    d.querySelector('input[name=kind][value=presenter]').checked = true; d.querySelector('input[name=kind][value=presenter]').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(d.querySelector('#grp-paper').hidden, false); ok('발표 선택 시 논문 칸 다시 표시');

    fillBase(d); d.querySelector('#f-title').value = '생성형 AI 거버넌스'; d.querySelector('#f-abstract').value = '가'.repeat(40);
    d.querySelector('#f-abstract').dispatchEvent(new w.Event('input'));
    assert.ok(d.querySelector('#abstract-count').textContent.startsWith('40')); ok('초록 글자 수 표시');
    submit(w, form); await sleep(20);
    assert.ok(msg.textContent.includes('공개 범위')); ok('공개 범위 미선택 시 안내');
    d.querySelector('input[name=publish][value=abstract]').checked = true;
    submit(w, form); await sleep(20);
    assert.ok(msg.textContent.includes('동의')); ok('개인정보 동의 없으면 안내');
    d.querySelector('#f-privacy').checked = true;

    setFiles(d.querySelector('#f-full-file'), [fileOf(w, 'virus.exe', 'x')]);
    submit(w, form); await sleep(50);
    assert.ok(msg.textContent.includes('허용되지 않는')); assert.strictEqual(calls.length, 0); ok('허용되지 않는 파일 형식은 보내기 전에 차단');

    setFiles(d.querySelector('#f-full-file'), [fileOf(w, '논문.pdf', '%PDF')]);
    setReply({ ok: true, id: '2026-P-001' });
    submit(w, form); await sleep(80);
    assert.strictEqual(calls.length, 1); const p = calls[0].body;
    assert.strictEqual(calls[0].method, 'POST'); assert.strictEqual(p.action, 'apply'); assert.strictEqual(p.kind, 'presenter'); assert.strictEqual(p.consent.publish, 'abstract'); assert.strictEqual(p.consent.privacy, true);
    assert.ok(p.files.fulltext.data.startsWith('data:')); assert.strictEqual(p.files.fulltext.name, '논문.pdf'); assert.strictEqual(p.website, '');
    assert.ok(msg.classList.contains('ok') && msg.textContent.includes('2026-P-001')); assert.strictEqual(d.querySelector('#apply-submit').disabled, false); ok('정상 신청: 올바른 데이터 전송, 접수번호 표시, 버튼 복구');
    assert.strictEqual(d.querySelector('#f-name').value, ''); ok('성공 후 입력칸 초기화');

    fillBase(d); d.querySelector('#f-title').value = 't2'; d.querySelector('#f-abstract').value = '나'.repeat(40);
    d.querySelector('input[name=publish][value=none]').checked = true; d.querySelector('#f-privacy').checked = true;
    setReply({ ok: false, error: '이미 접수된 신청입니다. 접수번호: 2026-P-001' });
    submit(w, form); await sleep(80);
    assert.ok(msg.classList.contains('err') && msg.textContent.includes('이미 접수')); ok('서버 오류 메시지를 그대로 표시');

    // 토론·사회 전송 형식
    d.querySelector('input[name=kind][value=discussant]').checked = true; d.querySelector('input[name=kind][value=discussant]').dispatchEvent(new w.Event('change', { bubbles: true }));
    fillBase(d); d.querySelector('#f-topics').value = 'AI 윤리, 플랫폼 거버넌스'; d.querySelector('#f-privacy').checked = true;
    setReply({ ok: true, id: '2026-D-001' }); const before = calls.length;
    submit(w, form); await sleep(80);
    const dp = calls[before].body; assert.deepStrictEqual(dp.topics, ['AI 윤리', '플랫폼 거버넌스']); assert.strictEqual(dp.consent.publish, 'none'); ok('토론·사회 신청 전송 형식');

    // API 미설정
    w.SITE.API_URL = '';
    d.querySelector('input[name=kind][value=presenter]').checked = true; d.querySelector('input[name=kind][value=presenter]').dispatchEvent(new w.Event('change', { bubbles: true }));
    fillBase(d); d.querySelector('#f-title').value = 't3'; d.querySelector('#f-abstract').value = '다'.repeat(40); d.querySelector('input[name=publish][value=abstract]').checked = true; d.querySelector('#f-privacy').checked = true;
    submit(w, form); await sleep(50);
    assert.ok(msg.textContent.includes('아직 연결되지 않았')); ok('API 주소 미설정 시 친절한 안내');
    w.SITE.API_URL = 'https://example.test/exec';

    // 탭
    d.querySelector('#tab-final').click();
    assert.strictEqual(d.querySelector('#panel-final').hidden, false); assert.strictEqual(d.querySelector('#panel-apply').hidden, true); assert.strictEqual(d.querySelector('#tab-final').getAttribute('aria-selected'), 'true'); ok('탭 전환');

    // 자료 제출
    const fin = d.querySelector('#final-form'), fm = d.querySelector('#final-msg');
    submit(w, fin); await sleep(20); assert.ok(fm.textContent.includes('접수번호와 이메일')); ok('자료 제출: 접수번호·이메일 없으면 안내');
    d.querySelector('#g-id').value = '2026-P-001'; d.querySelector('#g-email').value = 'hong@example.com';
    submit(w, fin); await sleep(20); assert.ok(fm.textContent.includes('파일을 하나 이상')); ok('자료 제출: 파일 없으면 안내');
    setFiles(d.querySelector('#g-full'), [fileOf(w, '발표.pptx', 'slides')]); setReply({ ok: true, version: 2, message: '자료가 제출되었습니다. (버전 2)' });
    const b2 = calls.length; submit(w, fin); await sleep(80);
    const fp = calls[b2].body; assert.strictEqual(fp.action, 'final'); assert.strictEqual(fp.id, '2026-P-001'); assert.ok(fp.files.fulltext.name === '발표.pptx' && !fp.files.abstract);
    assert.ok(fm.classList.contains('ok') && fm.textContent.includes('v2')); ok('자료 제출: 전송 형식과 결과 표시');

    // 조회
    const lk = d.querySelector('#lookup-form'), lm = d.querySelector('#lookup-msg');
    d.querySelector('#l-id').value = '2026-P-001'; d.querySelector('#l-email').value = 'hong@example.com';
    setReply({ ok: true, id: '2026-P-001', kind: '발표', title: '생성형 AI 거버넌스', status: '접수', version: 2, hasAbstractFile: true, hasFullText: false });
    submit(w, lk); await sleep(80); assert.ok(lm.textContent.includes('상태: 접수') && lm.textContent.includes('원문/발표자료: 없음')); ok('접수 조회 결과 표시');
  }


  /* ---- 공동저자 · 내용 수정 ---- */
  {
    const { w, d, calls, setReply } = await load('apply.html');
    w.SITE.API_URL = 'https://example.test/exec';
    const form = d.querySelector('#apply-form'), msg = d.querySelector('#apply-msg');
    const click = el => el.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
    const rowsIn = sel => [...d.querySelectorAll(sel + ' .co-row')];

    // 신청서 공동저자 칸
    click(d.querySelector('#coauth-add')); click(d.querySelector('#coauth-add'));
    assert.strictEqual(rowsIn('#coauth-list').length, 2); ok('신청: 공동저자 추가 버튼으로 입력줄 추가');
    for (let i = 0; i < 5; i++) click(d.querySelector('#coauth-add'));
    assert.strictEqual(rowsIn('#coauth-list').length, 5); assert.strictEqual(d.querySelector('#coauth-add').disabled, true); ok('신청: 공동저자는 최대 5명, 5명이면 추가 버튼 비활성');
    click(rowsIn('#coauth-list')[4].querySelector('button')); assert.strictEqual(rowsIn('#coauth-list').length, 4); assert.strictEqual(d.querySelector('#coauth-add').disabled, false); ok('신청: 공동저자 삭제');
    rowsIn('#coauth-list').slice(2).forEach(r => click(r.querySelector('button')));
    const [r1, r2] = rowsIn('#coauth-list').map(r => r.querySelectorAll('input'));
    r1[0].value = '김철수'; r1[1].value = 'B대'; r2[0].value = ''; r2[1].value = 'C대';

    fillBase(d); d.querySelector('#f-title').value = '공동 연구'; d.querySelector('#f-abstract').value = '가'.repeat(40);
    d.querySelector('input[name=publish][value=abstract]').checked = true; d.querySelector('#f-privacy').checked = true;
    submit(w, form); await sleep(30);
    assert.ok(msg.textContent.includes('저자의 성명')); assert.strictEqual(calls.length, 0); ok('신청: 공동저자 성명 없이 소속만 있으면 보내지 않고 안내');
    r2[0].value = '이영희';
    d.querySelector('#f-role').value = '교신저자'; d.querySelector('#f-equal').checked = true; rowsIn('#coauth-list')[1].querySelector('select').value = '주저자';
    setReply({ ok: true, id: '2026-P-005' }); submit(w, form); await sleep(80);
    assert.deepStrictEqual(calls[0].body.coauthors, [{ name: '김철수', affiliation: 'B대', role: '공동저자' }, { name: '이영희', affiliation: 'C대', role: '주저자' }]); ok('신청: 공동저자가 요청에 포함됨');
    assert.strictEqual(calls[0].body.role, '교신저자'); assert.strictEqual(calls[0].body.equal, true); ok('신청: 본인 저자 구분·동등 기여가 요청에 포함됨');
    assert.strictEqual(rowsIn('#coauth-list').length, 0); ok('신청 성공 후 공동저자 칸 초기화');

    d.querySelector('input[name=kind][value=discussant]').checked = true; d.querySelector('input[name=kind][value=discussant]').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(d.querySelector('#grp-coauth').hidden, true); ok('토론·사회에서는 공동저자 칸 숨김');

    // 내용 수정 흐름
    const fin = d.querySelector('#final-form'), fm = d.querySelector('#final-msg');
    const rec = { ok: true, id: '2026-P-005', kind: '발표', discussant: false, title: '가제목', abstract: '기존 초록입니다. '.repeat(5), topics: '', coauthors: [{ name: '김철수', affiliation: 'B대', role: '공동저자' }], role: '주저자', equal: false, publish: 'abstract', status: '접수', version: 1, editable: true, deadline: '2026-11-20' };
    d.querySelector('#g-id').value = '2026-P-005'; d.querySelector('#g-email').value = 'hong@example.com';
    assert.strictEqual(d.querySelector('#g-edit').hidden, true); ok('수정: 불러오기 전에는 수정 칸이 숨겨져 있음');
    setReply(rec); click(d.querySelector('#g-load')); await sleep(60);
    assert.strictEqual(d.querySelector('#g-edit').hidden, false); assert.strictEqual(d.querySelector('#g-title').value, '가제목');
    assert.ok(d.querySelector('#g-abstract').value.startsWith('기존 초록')); assert.strictEqual(rowsIn('#g-coauth-list').length, 1); assert.strictEqual(rowsIn('#g-coauth-list')[0].querySelectorAll('input')[0].value, '김철수'); ok('수정: 불러오기로 현재 제목·초록·공동저자가 채워짐');

    d.querySelector('#g-title').value = '확정된 제목';
    rowsIn('#g-coauth-list')[0].querySelectorAll('input')[1].value = 'D대';
    setReply({ ok: true, version: 2, message: '저장되었습니다. (버전 2)', changed: ["제목 '가제목' → '확정된 제목'"] });
    const b = calls.length; submit(w, fin); await sleep(80);
    const p = calls[b].body; assert.strictEqual(p.action, 'final'); assert.strictEqual(p.title, '확정된 제목'); assert.deepStrictEqual(p.coauthors, [{ name: '김철수', affiliation: 'D대', role: '공동저자' }]); assert.ok(p.abstract.startsWith('기존 초록'));
    assert.ok(fm.classList.contains('ok') && fm.textContent.includes('v2') && fm.textContent.includes('변경 내용')); ok('수정: 제목·초록·공동저자가 함께 전송되고 변경 내용이 표시됨');
    assert.strictEqual(d.querySelector('#g-edit').hidden, true); ok('수정 성공 후 수정 칸 닫힘');

    // 검증
    setReply(rec); d.querySelector('#g-id').value = '2026-P-005'; d.querySelector('#g-email').value = 'hong@example.com'; click(d.querySelector('#g-load')); await sleep(60);
    d.querySelector('#g-title').value = ''; const b2 = calls.length; submit(w, fin); await sleep(30);
    assert.ok(fm.textContent.includes('제목을 입력')); assert.strictEqual(calls.length, b2); ok('수정: 제목을 비우면 보내지 않음');
    d.querySelector('#g-title').value = 't'; d.querySelector('#g-abstract').value = '짧음'; submit(w, fin); await sleep(30);
    assert.ok(fm.textContent.includes('30자')); assert.strictEqual(calls.length, b2); ok('수정: 초록이 짧으면 보내지 않음');

    // 이메일을 바꾸면 불러온 내용을 닫음
    d.querySelector('#g-email').value = 'other@example.com'; d.querySelector('#g-email').dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.strictEqual(d.querySelector('#g-edit').hidden, true); ok('수정: 접수번호·이메일을 바꾸면 불러온 내용을 닫음');

    // 마감 후
    d.querySelector('#g-email').value = 'hong@example.com'; setReply(Object.assign({}, rec, { editable: false })); click(d.querySelector('#g-load')); await sleep(60);
    assert.strictEqual(d.querySelector('#g-edit').hidden, true); assert.ok(fm.classList.contains('err') && fm.textContent.includes('지났')); ok('수정: 마감 후에는 수정 칸을 열지 않고 안내');

    // 토론·사회
    setReply({ ok: true, id: '2026-D-001', kind: '토론·사회', discussant: true, title: '', abstract: '', topics: 'AI 윤리', coauthors: [], editable: true });
    d.querySelector('#g-id').value = '2026-D-001'; d.querySelector('#g-email').value = 'd@example.com'; click(d.querySelector('#g-load')); await sleep(60);
    assert.strictEqual(d.querySelector('#g-edit-topics').hidden, false); assert.strictEqual(d.querySelector('#g-edit-paper').hidden, true); assert.strictEqual(d.querySelector('#g-topics').value, 'AI 윤리'); ok('수정: 토론·사회는 희망 분야 칸만 표시');
    d.querySelector('#g-topics').value = '데이터 거버넌스, 플랫폼';
    setReply({ ok: true, version: 2, message: '저장' }); const b3 = calls.length; submit(w, fin); await sleep(80);
    assert.deepStrictEqual(calls[b3].body.topics, ['데이터 거버넌스', '플랫폼']); assert.ok(!('title' in calls[b3].body)); ok('수정: 토론·사회 희망 분야 전송');
  }

  /* ---- 프로그램 ---- */
  {
    const { w, d, calls, setReply } = await load('program.html');
    await sleep(20);
    assert.ok(d.querySelector('#program-list').textContent.includes('확정되는 대로')); ok('프로그램: API 미설정이면 공개 예정 안내');
  }
  {
    const items = [
      { id: 'a', kind: '발표', name: '홍길동', affiliation: 'A대', title: '플랫폼 거버넌스', abstract: '초록 가나다', session: '세션 1', time: '10:00' },
      { id: 'b', kind: '학부생 디지털포스터', name: '이학생', affiliation: 'B대', title: '<img src=x onerror=alert(1)>', abstract: '', session: '포스터', time: '13:00' },
      { id: 'c', kind: '발표', name: '박교수', affiliation: 'C대', title: '알고리즘 규제', abstract: '규제 연구', session: '세션 1', time: '11:00', authors: { list: [{ name: '박교수', affiliation: 'C대', role: '주저자', label: '주저자' }, { name: '최공동', affiliation: 'D대', role: '공동저자', label: '공동저자' }], equal: false, text: '박교수(C대, 주저자), 최공동(D대, 공동저자)' } }
    ];
    const { w, d, calls } = await load('program.html', (w, setReply) => { w.SITE.API_URL = 'https://example.test/exec'; setReply({ ok: true, items }); });
    await sleep(50);
    const list = d.querySelector('#program-list');
    assert.ok(calls.some(c => c.url === 'https://example.test/exec?action=program')); assert.strictEqual(list.querySelectorAll('.session-h').length, 2); assert.strictEqual(list.querySelectorAll('.item').length, 3); ok('프로그램: 세션별로 묶어 표시');
    assert.strictEqual(list.querySelector('img'), null); assert.ok(list.textContent.includes('<img src=x')); ok('프로그램: 제목의 HTML이 실행되지 않고 글자로 표시(XSS 방지)');
    assert.ok(list.textContent.includes('저자 박교수(C대, 주저자), 최공동(D대, 공동저자)')); ok('프로그램: 공동저자 표시');
    const q2 = d.querySelector('#q'); q2.value = '최공동'; q2.dispatchEvent(new w.Event('input')); assert.strictEqual(list.querySelectorAll('.item').length, 1); ok('프로그램: 공동저자 이름으로도 검색');
    const q = d.querySelector('#q'); q.value = '이학생'; q.dispatchEvent(new w.Event('input')); assert.strictEqual(list.querySelectorAll('.item').length, 1); ok('프로그램: 검색');
  }

  /* ---- 발제집 ---- */
  {
    const a = await load('proceedings.html');
    assert.strictEqual(a.d.querySelector('#ebook').hidden, true); assert.strictEqual(a.d.querySelector('#ebook-none').hidden, false); ok('발제집: 전자책 주소 없으면 공개 예정 안내');
    const { w, d } = await load('proceedings.html', (w, setReply) => {
      w.SITE.PROCEEDINGS_URL = 'proceedings/2026.pdf'; w.SITE.API_URL = 'https://example.test/exec';
      setReply({ ok: true, items: [{ id: 'a', kind: '발표', name: '홍', affiliation: 'A', title: 'T1', abstract: '초록 있음' }, { id: 'b', kind: '발표', name: '김', affiliation: 'B', title: 'T2', abstract: '' }] });
    });
    await sleep(50);
    assert.strictEqual(d.querySelector('#ebook').hidden, false); assert.strictEqual(d.querySelector('#ebook-frame').getAttribute('src'), 'proceedings/2026.pdf'); ok('발제집: 전자책 주소를 넣으면 뷰어 표시');
    assert.strictEqual(d.querySelectorAll('#abstract-list .item').length, 1); ok('발제집: 초록이 있는(공개 동의한) 발표만 목록에 표시');
  }

  /* ---- 홈 ---- */
  {
    const a = await load('index.html', w => { w.SITE.ACCOUNT = { bank: '', number: '', holder: '' }; });
    assert.strictEqual(a.d.querySelector('#account').hidden, true); ok('홈: 계좌 정보가 비어 있으면 이체 안내를 숨김');
    const { d } = await load('index.html', w => { w.SITE.ACCOUNT = { bank: '○○은행', number: '000-000-000000', holder: '한국정보사회학회' }; w.SITE.CONTACT_EMAIL = 'kais@example.org'; });
    assert.strictEqual(d.querySelector('#account').hidden, false); assert.ok(d.querySelector('#account-text').textContent.includes('000-000-000000')); assert.ok(d.querySelector('#contact a')); ok('홈: 계좌·문의 메일을 설정하면 표시');
    assert.strictEqual(d.querySelectorAll('h1').length, 1); assert.ok(d.querySelector('h1').textContent.includes('불확실성의 시대')); ok('홈: 대주제 표시');
    assert.ok(d.querySelector('#fee').textContent.includes('10,000원') && d.querySelector('#fee').textContent.includes('면제')); ok('홈: 등록비 표시');
    assert.strictEqual(d.querySelector('#video-box').hidden, false); assert.ok(!d.querySelector('#video-box iframe')); ok('홈: 영상은 클릭 전에는 iframe 없이 표시');
    d.querySelector('#video-play').click();
    assert.ok(d.querySelector('#video-box iframe').getAttribute('src').startsWith('https://www.youtube-nocookie.com/embed/')); ok('홈: 재생 클릭 시 nocookie 임베드 생성');
    assert.strictEqual(d.querySelector('#indoor').hidden, false); assert.ok(!d.querySelector('#indoor-box iframe')); ok('홈: 건물 안 길 안내 영상은 클릭 전 iframe 없음');
    d.querySelector('#indoor-play').click();
    assert.ok(d.querySelector('#indoor-box iframe').getAttribute('src').includes('youtube-nocookie.com/embed/kPjMg-olgho')); ok('홈: 길 안내 영상 클릭 시 nocookie 임베드');
    assert.ok(d.querySelector('#venue').textContent.includes('성균관로 25-2') && d.querySelector('#map-skku').href.startsWith('https://admission.skku.edu/')); ok('홈: 오시는 길 주소·지도 링크');
    assert.strictEqual(d.querySelector('#bus').hidden, false); d.querySelector('#bus-play').click();
    assert.ok(d.querySelector('#bus-box iframe').getAttribute('src').includes('youtube-nocookie.com/embed/mO_ZNuycknM')); ok('홈: 종로07 영상 클릭 시 nocookie 임베드');
    assert.ok(d.querySelector('#venue').textContent.includes('명륜동2가(성균관대입구)(01227) 하차 — 151, 171, 172, 272, 601') && d.querySelector('#venue').textContent.includes('성균관대운동장” 정류장까지')); ok('홈: 추가 정류장·종로07 안내 문구');
    assert.ok(d.querySelector('.map-fig img').getAttribute('src') === 'images/hoam-map.jpg' && d.querySelector('.map-fig img').alt); ok('홈: 호암관 약도 이미지와 대체 텍스트');
    const ni = await load('index.html', w => { w.SITE.INDOOR_VIDEO_ID = ''; }); assert.strictEqual(ni.d.querySelector('#indoor').hidden, true); ok('홈: 길 안내 영상 ID 없으면 숨김');
    const nv = await load('index.html', w => { w.SITE.VIDEO_ID = ''; });
    assert.strictEqual(nv.d.querySelector('#video').hidden, true); ok('홈: 영상 ID가 없으면 구역 숨김');
  }
  console.log('\n통과 ' + n + '건');
  process.exit(0);
})().catch(e => { console.error('\nFAIL', e); process.exit(1); });
