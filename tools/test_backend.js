// Apps Script 백엔드 모의 환경 테스트: node test_backend.js <Code.gs 경로>
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(process.argv[2], 'utf8');

const rows = [['접수일시', '접수번호', '유형', '성명', '소속', '전화', '이메일', '논문제목', '희망분야', '초록', '공개범위', '초록파일', '원문파일', '버전', '상태', '세션', '시간', '비고']];
const files = [];
const mails = [];
const props = {};

function range(r, c, nr, nc) {
  nr = nr || 1; nc = nc || 1;
  return {
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) { const row = rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); }
      return out;
    },
    setValues(vs) { vs.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }); },
    setValue(v) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; },
    setNumberFormat() {}, setFontWeight() {}, setDataValidation() {}
  };
}
const sheet = { getMaxColumns: () => 26, insertColumnsAfter() {}, getLastRow: () => rows.length, getRange: range, getName: () => 'Untitled', setName() {}, setFrozenRows() {} };

const ctx = {
  console,
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => null, getSheets: () => [sheet] }), newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }) },
  DriveApp: { getFolderById: id => ({ createFile(a, b, c) { const f = a && a.name ? { folder: id, name: a.name, bytes: a.bytes.length } : { folder: id, name: a, text: b }; files.push(f); return { getUrl: () => 'https://drive.example/' + (f.name || a) }; } }) },
  MimeType: { PLAIN_TEXT: 'text/plain' },
  Utilities: { base64Decode: s => Array.from(Buffer.from(s, 'base64')), newBlob: (bytes, mime, name) => ({ bytes, mime, name }), formatDate: () => '2026-10-15 13:00:00' },
  MailApp: { sendEmail: o => mails.push(o) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const post = p => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(p) } }).s);
const get = a => JSON.parse(ctx.doGet({ parameter: { action: a } }).s);
const b64 = s => Buffer.from(s).toString('base64');
const base = { action: 'apply', kind: 'presenter', name: '홍길동', affiliation: '광운대학교', phone: '010-1234-5678', email: 'Hong@Example.com', title: '생성형 AI 거버넌스 연구', abstract: '이 연구는 생성형 AI 확산기의 플랫폼 거버넌스 변화를 분석한다. 규제와 자율규제의 상호작용을 살핀다.', consent: { privacy: true, publish: 'abstract' } };
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  -', name); }

t('발표 신청 성공: 접수번호, 행 추가, 초록 txt 저장, 메일 발송', () => {
  const r = post(base);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.id, '2026-P-001');
  assert.strictEqual(rows.length, 2); assert.strictEqual(rows[1].length, 21);
  assert.strictEqual(rows[1][6], 'hong@example.com'); assert.strictEqual(rows[1][14], '접수'); assert.strictEqual(rows[1][10], 'abstract');
  assert.ok(files.find(f => f.name === '2026-P-001_초록.txt' && f.folder.startsWith('1_kza')));
  assert.strictEqual(mails.length, 1); assert.strictEqual(mails[0].to, 'hong@example.com');
});
t('같은 이메일·제목 중복 신청 거부', () => { const r = post(base); assert.strictEqual(r.ok, false); assert.ok(r.error.includes('2026-P-001')); });
t('동의 없으면 거부', () => { const r = post(Object.assign({}, base, { title: '다른 제목', consent: { privacy: false } })); assert.strictEqual(r.ok, false); });
t('초록이 짧으면 거부', () => { const r = post(Object.assign({}, base, { title: '짧은 초록', abstract: '짧음' })); assert.strictEqual(r.ok, false); });
t('잘못된 이메일·전화 거부', () => {
  assert.strictEqual(post(Object.assign({}, base, { title: 'a1', email: 'x' })).ok, false);
  assert.strictEqual(post(Object.assign({}, base, { title: 'a2', phone: 'abc' })).ok, false);
});
t('허용되지 않는 확장자(exe) 거부: 행·드라이브 파일이 늘지 않고 접수번호도 소진되지 않음', () => {
  const before = rows.length, fb = files.length, seq = props.seq_P;
  const r = post(Object.assign({}, base, { title: '파일 테스트', files: { fulltext: { name: 'a.exe', data: b64('x') } } }));
  assert.strictEqual(r.ok, false); assert.strictEqual(rows.length, before);
  assert.strictEqual(files.length, fb); assert.strictEqual(props.seq_P, seq);
});
t('8MB 초과 파일 거부', () => {
  const big = Buffer.alloc(9 * 1024 * 1024).toString('base64');
  const r = post(Object.assign({}, base, { title: '큰 파일', files: { fulltext: { name: 'a.pdf', data: big } } }));
  assert.strictEqual(r.ok, false); assert.ok(r.error.includes('8MB'));
});
t('원문 파일 포함 신청: 원문 폴더에 저장, 파일명 규칙', () => {
  const r = post(Object.assign({}, base, { title: '원문 포함', email: 'b@example.com', files: { fulltext: { name: '논문.PDF', data: 'data:application/pdf;base64,' + b64('%PDF-1.4') } } }));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.id, '2026-P-002');
  const f = files.find(x => x.name === '2026-P-002_홍길동_원문.pdf'); assert.ok(f && f.folder.startsWith('1jxX') && f.bytes === 8);
});
t('토론·사회 신청(희망 분야), 접수번호 D', () => {
  const r = post({ action: 'apply', kind: 'discussant', name: '김토론', affiliation: 'A대', phone: '02-123-4567', email: 'd@example.com', topics: ['AI 윤리', '플랫폼'], consent: { privacy: true } });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.id, '2026-D-001');
  assert.strictEqual(rows[rows.length - 1][8], 'AI 윤리, 플랫폼'); assert.strictEqual(rows[rows.length - 1][10], 'none');
});
t('학부생 신청, 접수번호 U', () => {
  const r = post(Object.assign({}, base, { kind: 'undergrad', title: '학부생 포스터', email: 'u@example.com' }));
  assert.strictEqual(r.ok, true); assert.strictEqual(r.id, '2026-U-001');
});
t('수식 주입 문자열은 텍스트로 저장(숫자형이 아닌 문자열)', () => {
  const r = post(Object.assign({}, base, { title: '=HYPERLINK("http://x")', email: 'f@example.com' }));
  assert.strictEqual(r.ok, true); assert.strictEqual(typeof rows[rows.length - 1][7], 'string');
});
t('스팸 숨김 필드가 차 있으면 저장하지 않음', () => {
  const before = rows.length; const r = post(Object.assign({}, base, { title: '봇', email: 'bot@example.com', website: 'http://spam' }));
  assert.strictEqual(r.ok, true); assert.strictEqual(rows.length, before);
});
t('신청 마감 후 거부', () => {
  const old = ctx.CFG.DEADLINE_APPLY; ctx.CFG.DEADLINE_APPLY = '2020-01-01T00:00:00+09:00';
  const r = post(Object.assign({}, base, { title: '늦은 신청', email: 'late@example.com' })); ctx.CFG.DEADLINE_APPLY = old;
  assert.strictEqual(r.ok, false); assert.ok(r.error.includes('마감'));
});
t('최종 자료 제출: 이메일 불일치 거부', () => {
  const r = post({ action: 'final', id: '2026-P-001', email: 'wrong@example.com', files: { fulltext: { name: 'a.pptx', data: b64('x') } } });
  assert.strictEqual(r.ok, false);
});
t('최종 자료 제출: 버전 2, 파일명 _v2, 공개범위 변경, 비고 기록', () => {
  const r = post({ action: 'final', id: '2026-P-001', email: 'HONG@example.com', publish: 'full', files: { fulltext: { name: '발표.pptx', data: b64('slides') }, abstract: { name: '초록.docx', data: b64('abs') } } });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.version, 2);
  assert.ok(files.find(f => f.name === '2026-P-001_홍길동_원문_v2.pptx')); assert.ok(files.find(f => f.name === '2026-P-001_홍길동_초록_v2.docx'));
  assert.strictEqual(rows[1][13], 2); assert.strictEqual(rows[1][10], 'full'); assert.ok(rows[1][17].includes('자료 v2'));
});
t('최종 제출은 파일 없이 거부', () => { assert.strictEqual(post({ action: 'final', id: '2026-P-001', email: 'hong@example.com', files: {} }).ok, false); });
t('최종 마감 후 제출 거부', () => {
  const old = ctx.CFG.DEADLINE_FINAL; ctx.CFG.DEADLINE_FINAL = '2020-01-01T00:00:00+09:00';
  const r = post({ action: 'final', id: '2026-P-001', email: 'hong@example.com', files: { fulltext: { name: 'a.pdf', data: b64('x') } } }); ctx.CFG.DEADLINE_FINAL = old;
  assert.strictEqual(r.ok, false);
});
t('접수 조회: 일치하면 상태 반환, 개인정보(전화·이메일) 미포함', () => {
  const r = post({ action: 'lookup', id: '2026-P-001', email: 'hong@example.com' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.version, 2); assert.ok(!('phone' in r) && !('email' in r));
  assert.strictEqual(post({ action: 'lookup', id: '2026-P-001', email: 'no@example.com' }).ok, false);
});
t('공개 프로그램: 상태가 확정인 건만, 공개범위 none이면 초록 숨김, 전화·이메일 미노출', () => {
  assert.strictEqual(get('program').items.length, 0);
  rows[1][14] = '확정'; rows[1][15] = '세션1'; rows[1][16] = '10:00';
  const u = rows.findIndex(r => r[1] === '2026-U-001'); rows[u][14] = '확정'; rows[u][10] = 'none';
  const items = get('program').items;
  assert.strictEqual(items.length, 2);
  const p = items.find(i => i.id === '2026-P-001'); assert.ok(p.abstract.length > 10);
  const q = items.find(i => i.id === '2026-U-001'); assert.strictEqual(q.abstract, '');
  items.forEach(i => { assert.ok(!('phone' in i) && !('email' in i)); });
});

t('신청: 공동저자 저장 형식, 초록 txt에 공동저자 포함, 헤더 자동 보정', () => {
  const r = post(Object.assign({}, base, { title: '공동 연구', email: 'co@example.com', coauthors: [{ name: '김철수', affiliation: 'B대' }, { name: '이영희;(x)', affiliation: 'C대(박사과정)' }, { name: '', affiliation: '' }] }));
  assert.strictEqual(r.ok, true);
  const row = rows[rows.length - 1];
  assert.strictEqual(row[18], '김철수(B대)[공동저자]; 이영희 x(C대(박사과정))[공동저자]');
  assert.deepStrictEqual([rows[0][18], rows[0][19], rows[0][20]], ['공동저자', '대표 역할', '동등 기여']);
  assert.strictEqual(row[19], '주저자'); assert.strictEqual(row[20], '');
  const txt = files.find(f => f.name === r.id + '_초록.txt'); assert.ok(txt && txt.text.includes('저자: 홍길동(') && txt.text.includes('김철수(B대, 공동저자)'));
});
t('신청: 공동저자 6명 초과·이름 없는 소속만 입력은 거부(번호 소진 없음)', () => {
  const seq = props.seq_P;
  const six = Array.from({ length: 6 }, (_, i) => ({ name: 'n' + i, affiliation: 'a' }));
  assert.strictEqual(post(Object.assign({}, base, { title: '여섯', email: 's@example.com', coauthors: six })).ok, false);
  assert.strictEqual(post(Object.assign({}, base, { title: '이름없음', email: 't@example.com', coauthors: [{ name: '', affiliation: 'A대' }] })).ok, false);
  assert.strictEqual(props.seq_P, seq);
});
t('수정: 가제목→확정 제목, 버전 증가, 비고에 이전 값 기록, 새 txt 보관', () => {
  const id = rows[1][1]; const before = rows[1][13];
  const nf = files.length;
  const r = post({ action: 'final', id, email: 'hong@example.com', title: '확정된 제목' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.version, before + 1);
  assert.strictEqual(rows[1][7], '확정된 제목');
  assert.ok(rows[1][17].includes("제목 '생성형 AI 거버넌스 연구' → '확정된 제목'"));
  assert.ok(files.slice(nf).find(f => f.name === id + '_초록_v' + (before + 1) + '.txt' && f.text.includes('제목: 확정된 제목')));
});
t('수정: 공동저자 교체·삭제, 초록 수정(길이 검증)', () => {
  const id = rows[1][1];
  assert.strictEqual(post({ action: 'final', id, email: 'hong@example.com', coauthors: [{ name: '박공동', affiliation: 'D대' }] }).ok, true);
  assert.strictEqual(rows[1][18], '박공동(D대)[공동저자]');
  assert.strictEqual(post({ action: 'final', id, email: 'hong@example.com', coauthors: [] }).ok, true);
  assert.strictEqual(rows[1][18], '');
  assert.strictEqual(post({ action: 'final', id, email: 'hong@example.com', abstract: '짧음' }).ok, false);
  assert.strictEqual(post({ action: 'final', id, email: 'hong@example.com', abstract: '새로운 초록입니다. '.repeat(5) }).ok, true);
  assert.ok(rows[1][9].startsWith('새로운 초록'));
});
t('수정: 변경 없음·빈 제목·이메일 불일치는 거부하고 버전 유지', () => {
  const id = rows[1][1]; const v = rows[1][13];
  assert.strictEqual(post({ action: 'final', id, email: 'hong@example.com', title: rows[1][7] }).ok, false);
  assert.strictEqual(post({ action: 'final', id, email: 'hong@example.com', title: '   ' }).ok, false);
  assert.strictEqual(post({ action: 'final', id, email: 'x@example.com', title: '남의 것' }).ok, false);
  assert.strictEqual(rows[1][13], v);
});
t('수정: 제목 칸에 수식을 넣어도 텍스트로 저장', () => {
  const id = rows[1][1];
  assert.strictEqual(post({ action: 'final', id, email: 'hong@example.com', title: '=SUM(1,1)' }).ok, true);
  assert.strictEqual(typeof rows[1][7], 'string'); assert.strictEqual(rows[1][7], '=SUM(1,1)');
});
t('수정: 공개 범위만 바꾸면 버전은 그대로', () => {
  const id = rows[1][1]; const v = rows[1][13]; const cur = rows[1][10];
  const r = post({ action: 'final', id, email: 'hong@example.com', publish: cur === 'none' ? 'abstract' : 'none' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.version, v); assert.strictEqual(rows[1][13], v);
});
t('수정: 토론·사회는 희망 분야만 수정, 제목·초록 요청은 무시', () => {
  const d = rows.find(r => r[1] === '2026-D-001');
  assert.strictEqual(post({ action: 'final', id: '2026-D-001', email: 'd@example.com', topics: ['데이터 거버넌스'], title: '무시', coauthors: [{ name: 'x' }] }).ok, true);
  const d2 = rows.find(r => r[1] === '2026-D-001');
  assert.strictEqual(d2[8], '데이터 거버넌스'); assert.strictEqual(d2[7], ''); assert.strictEqual(d2[18] || '', '');
});
t('수정: 마감 후에는 제목도 수정할 수 없음', () => {
  const old = ctx.CFG.DEADLINE_EDIT; ctx.CFG.DEADLINE_EDIT = '2020-01-01T00:00:00+09:00';
  const r = post({ action: 'final', id: rows[1][1], email: 'hong@example.com', title: '마감 후' }); ctx.CFG.DEADLINE_EDIT = old;
  assert.strictEqual(r.ok, false); assert.notStrictEqual(rows[1][7], '마감 후');
});
t('확정된 건을 수정하면 조직위(ADMIN_EMAIL)에 알림', () => {
  const oldA = ctx.CFG.ADMIN_EMAIL; ctx.CFG.ADMIN_EMAIL = 'admin@example.org'; const m = mails.length;
  rows[1][14] = '확정';
  assert.strictEqual(post({ action: 'final', id: rows[1][1], email: 'hong@example.com', title: '확정 후 수정 제목' }).ok, true);
  ctx.CFG.ADMIN_EMAIL = oldA;
  assert.ok(mails.slice(m).find(x => x.to === 'admin@example.org' && x.subject.includes('수정')));
  rows[1][14] = '접수';
});
t('조회: 수정용 현재 내용(제목·초록·공동저자·분야)과 수정 가능 여부 반환, 전화·이메일 미포함', () => {
  const r = post({ action: 'lookup', id: '2026-D-001', email: 'd@example.com' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.discussant, true); assert.strictEqual(r.topics, '데이터 거버넌스'); assert.strictEqual(r.editable, true);
  assert.ok(!('phone' in r) && !('email' in r));
  const co = rows.find(x => x[7] === '공동 연구'); const l = post({ action: 'lookup', id: co[1], email: 'co@example.com' });
  assert.deepStrictEqual(l.coauthors[0], { name: '김철수', affiliation: 'B대', role: '공동저자' }); assert.deepStrictEqual(l.coauthors[1], { name: '이영희 x', affiliation: 'C대(박사과정)', role: '공동저자' });
  assert.strictEqual(l.role, '주저자'); assert.strictEqual(l.equal, false); assert.strictEqual(l.deadline, '2026-11-20'); assert.strictEqual(l.filesDeadline, '2026-11-15');
});
t('공개 프로그램: 공동저자 배열 포함, 전화·이메일 미노출', () => {
  const co = rows.find(x => x[7] === '공동 연구'); co[14] = '확정';
  const it = get('program').items.find(i => i.id === co[1]);
  assert.strictEqual(it.authors.list.length, 3); assert.strictEqual(it.authors.list[0].label, '주저자'); assert.ok(it.authors.text.includes('김철수(B대, 공동저자)')); assert.ok(!('phone' in it) && !('email' in it));
});
t('알 수 없는 요청·깨진 JSON도 오류 JSON으로 응답', () => {
  assert.strictEqual(post({ action: 'x' }).ok, false);
  assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: '{bad' } }).s).ok, false);
});
t('저자 구분: 교신저자 지정, 잘못된 구분은 공동저자로, 대표 발표자 구분 저장', () => {
  const r = post(Object.assign({}, base, { title: '역할 시험', email: 'role@example.com', role: '교신저자', coauthors: [{ name: '나주저', affiliation: 'E대', role: '주저자' }, { name: '다공동', affiliation: 'F대', role: '엉뚱' }] }));
  assert.strictEqual(r.ok, true);
  const row = rows.find(x => x[1] === r.id);
  assert.strictEqual(row[19], '교신저자'); assert.strictEqual(row[18], '나주저(E대)[주저자]; 다공동(F대)[공동저자]');
  row[14] = '확정';
  const it = get('program').items.find(i => i.id === r.id);
  assert.deepStrictEqual(it.authors.list.map(a => a.label), ['교신저자', '주저자', '공동저자']); assert.strictEqual(it.authors.equal, false);
});
t('동등 기여: 가나다순 정렬, 주저자·공동저자 구분 숨기고 교신저자만 표시, txt에도 반영', () => {
  const r = post(Object.assign({}, base, { name: '하대표', title: '동등 시험', email: 'eq@example.com', role: '주저자', equal: true, coauthors: [{ name: '가나다', affiliation: 'A대', role: '공동저자' }, { name: '마교신', affiliation: 'B대', role: '교신저자' }] }));
  assert.strictEqual(r.ok, true);
  const row = rows.find(x => x[1] === r.id); assert.strictEqual(row[20], '동등'); row[14] = '확정';
  const it = get('program').items.find(i => i.id === r.id);
  assert.deepStrictEqual(it.authors.list.map(a => a.name), ['가나다', '마교신', '하대표']);
  assert.deepStrictEqual(it.authors.list.map(a => a.label), ['', '교신저자', '']);
  assert.ok(it.authors.text.startsWith('가나다(A대), 마교신(B대, 교신저자), 하대표(')); assert.ok(it.authors.text.endsWith('동등 기여, 가나다순'));
  const txt = files.find(f => f.name === r.id + '_초록.txt'); assert.ok(txt.text.includes('동등 기여, 가나다순'));
});
t('수정: 저자 구분·동등 기여 변경 기록과 버전, 토론·사회는 무시', () => {
  const row = rows.find(x => x[7] === '역할 시험'); const id = row[1];
  const r = post({ action: 'final', id, email: 'role@example.com', equal: true, role: '주저자' });
  assert.strictEqual(r.ok, true); assert.strictEqual(row[20], '동등'); assert.strictEqual(row[19], '주저자');
  assert.ok(String(row[17]).includes('동등 기여(가나다순) 지정') && String(row[17]).includes('대표 발표자 구분 교신저자 → 주저자'));
  assert.strictEqual(post({ action: 'final', id, email: 'role@example.com', equal: true, role: '주저자' }).ok, false);
  const d = post({ action: 'final', id: '2026-D-001', email: 'd@example.com', topics: ['데이터 거버넌스', 'AI'], equal: true, role: '교신저자' });
  const dr = rows.find(x => x[1] === '2026-D-001'); assert.strictEqual(dr[19], ''); assert.strictEqual(dr[20], '');
});
t('마감 분리: 파일은 11/15, 내용 수정은 11/20 (11/15 이후에도 내용 수정 가능, 파일은 거부)', () => {
  const row = rows.find(x => x[7] === '동등 시험'); const id = row[1];
  const oldF = ctx.CFG.DEADLINE_FINAL; ctx.CFG.DEADLINE_FINAL = '2020-01-01T00:00:00+09:00';
  const a = post({ action: 'final', id, email: 'eq@example.com', title: '동등 시험(수정)' });
  const b = post({ action: 'final', id, email: 'eq@example.com', files: { fulltext: { name: 'a.pdf', data: b64('x') } } });
  const lk = post({ action: 'lookup', id, email: 'eq@example.com' });
  ctx.CFG.DEADLINE_FINAL = oldF;
  assert.strictEqual(a.ok, true); assert.strictEqual(b.ok, false); assert.strictEqual(lk.editable, true); assert.strictEqual(lk.filesOpen, false);
  const oldE = ctx.CFG.DEADLINE_EDIT; ctx.CFG.DEADLINE_EDIT = '2020-01-01T00:00:00+09:00';
  const c = post({ action: 'final', id, email: 'eq@example.com', title: '또 수정' }); const lk2 = post({ action: 'lookup', id, email: 'eq@example.com' });
  ctx.CFG.DEADLINE_EDIT = oldE;
  assert.strictEqual(c.ok, false); assert.strictEqual(lk2.editable, false);
});
console.log('\n통과 ' + n + '건');
