/**
 * 한국정보사회학회 2026 가을철 정기학술대회 - 접수 백엔드 (Google Apps Script)
 *
 * 배포: 배포 > 새 배포 > 유형 "웹 앱"
 *   - 실행 사용자: 나 (폴더 소유 계정)
 *   - 액세스 권한: 모든 사용자
 * 처음 한 번 setup() 을 실행해 권한을 승인하고 접수대장 서식을 정리합니다.
 */
var CFG = {
  FOLDER_ABSTRACT: '1_kzaPVXb_SMmovIQtUmKK5RWSSm4hi1e',
  FOLDER_FULLTEXT: '1jxXxuTOVz4scaXddlBQ5o5y456s1uR6B',
  SHEET_ID: '1kFTiMbhyMUnGwI9HkMFv90zNLzxkBy4w6_vfGUaJ560',
  SHEET_NAME: '접수대장',
  ADMIN_EMAIL: '',   // 접수 알림을 받을 조직위 메일 (비워 두면 알림 없음)
  REPLY_TO: '',      // 참가자 문의 회신 주소 (선택)
  CONF_NAME: '2026년 한국정보사회학회 가을철 정기학술대회',
  DEADLINE_APPLY: '2026-11-01T23:59:59+09:00',
  DEADLINE_FINAL: '2026-11-15T23:59:59+09:00',   // 파일(초록·원문·발표자료) 제출 마감
  DEADLINE_EDIT: '2026-11-20T23:59:59+09:00',    // 제목·초록·저자 수정 마감
  MAX_FILE_BYTES: 8 * 1024 * 1024,
  EXT: ['hwp', 'hwpx', 'doc', 'docx', 'pdf', 'ppt', 'pptx'],
  PREFIX: { presenter: 'P', discussant: 'D', undergrad: 'U' },
  KIND_LABEL: { presenter: '발표', discussant: '토론·사회', undergrad: '학부생 디지털포스터' },
  PUBLISH: ['abstract', 'full', 'none'],
  STATUS: ['접수', '검토중', '확정', '보류', '철회'],
  ROLES: ['주저자', '공동저자', '교신저자']
};

var COL = {
  TS: 1, ID: 2, KIND: 3, NAME: 4, AFFIL: 5, PHONE: 6, EMAIL: 7, TITLE: 8, TOPICS: 9,
  ABSTRACT: 10, PUBLISH: 11, ABS_FILE: 12, FULL_FILE: 13, VER: 14, STATUS: 15,
  SESSION: 16, TIME: 17, NOTE: 18, COAUTH: 19, ROLE: 20, EQUAL: 21
};
var NCOL = 21;
var EXTRA_HEADERS = ['공동저자', '대표 역할', '동등 기여'];   // 19~21열 머리글 (없으면 자동 추가)
var MAX_COAUTHORS = 5;

/* ---------- 진입점 ---------- */

function doPost(e) {
  var out;
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.website) return json_({ ok: true });            // 스팸 방지용 숨김 필드
    if (p.action === 'apply') out = apply_(p);
    else if (p.action === 'final') out = final_(p);
    else if (p.action === 'lookup') out = lookup_(p);
    else out = fail_('알 수 없는 요청입니다.');
  } catch (err) {
    if (err && err.user) out = fail_(err.msg);
    else {
      console.error(err && err.stack ? err.stack : err);
      out = fail_('처리 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 조직위원회로 문의해 주세요.');
    }
  }
  return json_(out);
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'program') return json_(program_());
  return json_({ ok: true, service: CFG.CONF_NAME });
}

/* ---------- 신청 ---------- */

function apply_(p) {
  var kind = String(p.kind || '');
  if (!CFG.PREFIX[kind]) throw userErr_('신청 유형이 올바르지 않습니다.');
  checkDeadline_(CFG.DEADLINE_APPLY, '신청');

  var d = {
    name: str_(p.name, 50), affil: str_(p.affiliation, 100), phone: str_(p.phone, 20),
    email: str_(p.email, 100).toLowerCase(), title: str_(p.title, 200),
    abstract: String(p.abstract || '').trim()
  };
  if (!d.name) throw userErr_('성명을 입력해 주세요.');
  if (!d.affil) throw userErr_('소속을 입력해 주세요.');
  if (!/^[0-9+\-\s()]{8,20}$/.test(d.phone)) throw userErr_('전화번호를 확인해 주세요.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw userErr_('이메일 주소를 확인해 주세요.');
  if (!p.consent || p.consent.privacy !== true) throw userErr_('개인정보 수집·이용에 동의해 주세요.');
  var publish = CFG.PUBLISH.indexOf(p.consent.publish) >= 0 ? p.consent.publish : 'none';

  var topics = '';
  if (kind === 'discussant') {
    var arr = (Array.isArray(p.topics) ? p.topics : []).map(function (t) { return str_(t, 40); }).filter(Boolean);
    if (arr.length < 1 || arr.length > 3) throw userErr_('희망 분야를 1~3개 입력해 주세요.');
    topics = arr.join(', ');
  } else {
    if (!d.title) throw userErr_('논문 제목(가제목)을 입력해 주세요.');
    if (d.abstract.length < 30) throw userErr_('초록을 30자 이상 입력해 주세요.');
    if (d.abstract.length > 3000) throw userErr_('초록은 3,000자 이내로 입력해 주세요.');
  }

  var co = kind === 'discussant' ? [] : cleanCo_(p.coauthors);   // 대표 발표자 외의 저자
  var role = roleOf_(p.role, '주저자');                              // 대표 발표자(신청자)의 저자 구분
  var equal = kind !== 'discussant' && p.equal === true;           // 모든 저자 동등 기여 → 가나다순 표기

  if (p.files) { checkFile_(p.files.abstract); checkFile_(p.files.fulltext); }   // 저장 전에 먼저 검사

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = sheet_();
    var dup = findDuplicate_(sheet, kind, d.email, d.title);
    if (dup) throw userErr_('이미 접수된 신청입니다. 접수번호: ' + dup + ' (수정은 "자료 제출·수정"에서 해 주세요.)');

    var id = nextId_(kind);
    var absUrl = '', fullUrl = '';

    if (kind !== 'discussant') {
      var tf = folder_(CFG.FOLDER_ABSTRACT).createFile(id + '_초록.txt',
        abstractText_(id, CFG.KIND_LABEL[kind], d.title, d.name, d.affil, co.length ? authorsFrom_(d.name, d.affil, role, coString_(co), equal).text : '', d.abstract), MimeType.PLAIN_TEXT);
      absUrl = tf.getUrl();
    }
    if (p.files && p.files.abstract) absUrl = saveFile_(CFG.FOLDER_ABSTRACT, p.files.abstract, id, d.name, '초록', 1) || absUrl;
    if (p.files && p.files.fulltext) fullUrl = saveFile_(CFG.FOLDER_FULLTEXT, p.files.fulltext, id, d.name, '원문', 1);

    var row = [now_(), id, CFG.KIND_LABEL[kind], d.name, d.affil, d.phone, d.email, d.title, topics,
      d.abstract, publish, absUrl, fullUrl, 1, '접수', '', '', '', coString_(co), kind === 'discussant' ? '' : role, equal ? '동등' : ''];
    appendRow_(sheet, row);

    notify_(d, id, kind, topics);
    return { ok: true, id: id, message: '접수되었습니다. 확인 메일을 보냈습니다.' };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 자료 제출 · 내용 수정 (마감 전까지) ---------- */
// 파일 올리기, 제목·초록·공동저자(토론·사회는 희망 분야) 수정, 공개 범위 변경을 한 번에 처리합니다.
// 요청에 들어 있는 항목만 바꾸며, 바뀐 내용은 비고 열에 기록합니다.

function final_(p) {
  var id = str_(p.id, 30), email = str_(p.email, 100).toLowerCase();
  var files = p.files || {};
  var hasFiles = !!(files.abstract || files.fulltext);
  checkFile_(files.abstract); checkFile_(files.fulltext);   // 저장 전에 먼저 검사

  var edit = {};
  if (p.title !== undefined) edit.title = str_(p.title, 200);
  if (p.abstract !== undefined) edit.abstract = String(p.abstract || '').trim();
  if (p.coauthors !== undefined) edit.co = coString_(cleanCo_(p.coauthors));
  if (p.topics !== undefined) {
    edit.topics = (Array.isArray(p.topics) ? p.topics : []).map(function (t) { return str_(t, 40); }).filter(Boolean);
    if (edit.topics.length < 1 || edit.topics.length > 3) throw userErr_('희망 분야를 1~3개 입력해 주세요.');
    edit.topics = edit.topics.join(', ');
  }
  if (p.role !== undefined) edit.role = roleOf_(p.role, '주저자');
  if (p.equal !== undefined) edit.equal = p.equal === true ? '동등' : '';
  var newPublish = CFG.PUBLISH.indexOf(p.publish) >= 0 ? p.publish : '';

  // 마감: 파일은 DEADLINE_FINAL, 제목·초록·저자·공개범위 수정은 DEADLINE_EDIT
  if (hasFiles) checkDeadline_(CFG.DEADLINE_FINAL, '파일 제출');
  if (Object.keys(edit).length || newPublish) checkDeadline_(CFG.DEADLINE_EDIT, '내용 수정');
  if (!hasFiles && !Object.keys(edit).length && !newPublish) throw userErr_('변경할 내용이나 제출할 파일이 없습니다.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = sheet_();
    var r = findRow_(sheet, id, email);
    if (!r) throw userErr_('접수번호와 이메일이 일치하는 신청이 없습니다.');
    var row = sheet.getRange(r, 1, 1, NCOL).getValues()[0];
    var isDisc = row[COL.KIND - 1] === CFG.KIND_LABEL.discussant;
    var name = row[COL.NAME - 1];

    // 유형에 맞지 않는 항목은 무시
    if (isDisc) { delete edit.title; delete edit.abstract; delete edit.co; delete edit.role; delete edit.equal; } else { delete edit.topics; }
    if (edit.title !== undefined && !edit.title) throw userErr_('논문 제목을 입력해 주세요.');
    if (edit.abstract !== undefined) {
      if (edit.abstract.length < 30) throw userErr_('초록을 30자 이상 입력해 주세요.');
      if (edit.abstract.length > 3000) throw userErr_('초록은 3,000자 이내로 입력해 주세요.');
    }

    var cur = {
      title: String(row[COL.TITLE - 1] || ''), abstract: String(row[COL.ABSTRACT - 1] || '').trim(),
      co: String(row[COL.COAUTH - 1] || ''), topics: String(row[COL.TOPICS - 1] || ''),
      role: String(row[COL.ROLE - 1] || '주저자'), equal: String(row[COL.EQUAL - 1] || '')
    };
    var notes = [], contentChanged = false;
    if (edit.title !== undefined && edit.title !== cur.title) { notes.push("제목 '" + clip_(cur.title, 60) + "' → '" + clip_(edit.title, 60) + "'"); contentChanged = true; }
    if (edit.abstract !== undefined && edit.abstract !== cur.abstract) { notes.push('초록 수정'); contentChanged = true; }
    if (edit.co !== undefined && edit.co !== cur.co) { notes.push("공동저자 '" + clip_(cur.co, 80) + "' → '" + clip_(edit.co, 80) + "'"); contentChanged = true; }
    if (edit.role !== undefined && edit.role !== cur.role) { notes.push('대표 발표자 구분 ' + cur.role + ' → ' + edit.role); contentChanged = true; }
    if (edit.equal !== undefined && edit.equal !== cur.equal) { notes.push(edit.equal ? '동등 기여(가나다순) 지정' : '동등 기여 해제'); contentChanged = true; }
    if (edit.topics !== undefined && edit.topics !== cur.topics) { notes.push("희망 분야 '" + clip_(cur.topics, 60) + "' → '" + clip_(edit.topics, 60) + "'"); contentChanged = true; }
    var publishChanged = !!newPublish && newPublish !== String(row[COL.PUBLISH - 1]);
    if (publishChanged) notes.push('공개범위 ' + row[COL.PUBLISH - 1] + ' → ' + newPublish);

    if (!hasFiles && !contentChanged && !publishChanged) throw userErr_('변경된 내용이 없습니다.');

    var ver = Number(row[COL.VER - 1] || 1);
    if (hasFiles || contentChanged) ver += 1;

    if (files.abstract) {
      setText_(sheet, r, COL.ABS_FILE, saveFile_(CFG.FOLDER_ABSTRACT, files.abstract, id, name, '초록', ver));
      notes.push('초록 파일');
    }
    if (files.fulltext) {
      setText_(sheet, r, COL.FULL_FILE, saveFile_(CFG.FOLDER_FULLTEXT, files.fulltext, id, name, '원문', ver));
      notes.push('원문 파일');
    }
    if (contentChanged) {
      if (edit.title !== undefined) setText_(sheet, r, COL.TITLE, edit.title);
      if (edit.abstract !== undefined) setText_(sheet, r, COL.ABSTRACT, edit.abstract);
      if (edit.co !== undefined) setText_(sheet, r, COL.COAUTH, edit.co);
      if (edit.role !== undefined) setText_(sheet, r, COL.ROLE, edit.role);
      if (edit.equal !== undefined) setText_(sheet, r, COL.EQUAL, edit.equal);
      if (edit.topics !== undefined) setText_(sheet, r, COL.TOPICS, edit.topics);
      if (!isDisc) {   // 초록 폴더에 최신 내용을 새 버전 txt로 보관 (이전 파일은 그대로 남김)
        folder_(CFG.FOLDER_ABSTRACT).createFile(id + '_초록_v' + ver + '.txt',
          abstractText_(id, row[COL.KIND - 1], edit.title !== undefined ? edit.title : cur.title, name, row[COL.AFFIL - 1],
            (edit.co !== undefined ? edit.co : cur.co) ? authorsFrom_(name, row[COL.AFFIL - 1], edit.role !== undefined ? edit.role : cur.role,
              edit.co !== undefined ? edit.co : cur.co, (edit.equal !== undefined ? edit.equal : cur.equal) === '동등').text : '',
            edit.abstract !== undefined ? edit.abstract : cur.abstract), MimeType.PLAIN_TEXT);
      }
    }
    if (publishChanged) setText_(sheet, r, COL.PUBLISH, newPublish);
    setText_(sheet, r, COL.VER, ver, true);
    var note = String(row[COL.NOTE - 1] || '');
    setText_(sheet, r, COL.NOTE, (note ? note + ' | ' : '') + now_() + ' 자료 v' + ver + (notes.length ? ' (' + notes.join(', ') + ')' : ''));

    var summary = notes.length ? '\n변경 내용: ' + notes.join(', ') : '';
    mail_(row[COL.EMAIL - 1], '[' + CFG.CONF_NAME + '] 제출·수정 확인 (' + id + ')',
      name + ' 님,\n\n접수번호 ' + id + '의 내용이 저장되었습니다. (버전 ' + ver + ')' + summary + '\n' +
      '파일은 ' + CFG.DEADLINE_FINAL.slice(0, 10) + '까지, 제목·초록·저자는 ' + CFG.DEADLINE_EDIT.slice(0, 10) + '까지 같은 방법으로 다시 제출·수정하실 수 있습니다.\n\n한국정보사회학회 조직위원회');
    if (contentChanged && row[COL.STATUS - 1] === '확정' && CFG.ADMIN_EMAIL) {
      mail_(CFG.ADMIN_EMAIL, '[수정] 확정된 발표 내용 변경 ' + id + ' - ' + name, id + ' / ' + name + '\n' + notes.join('\n'));
    }
    return { ok: true, id: id, version: ver, changed: notes, message: '저장되었습니다. (버전 ' + ver + ')' };
  } finally {
    lock.releaseLock();
  }
}

function lookup_(p) {
  var id = str_(p.id, 30), email = str_(p.email, 100).toLowerCase();
  var sheet = sheet_();
  var r = findRow_(sheet, id, email);
  if (!r) throw userErr_('접수번호와 이메일이 일치하는 신청이 없습니다.');
  var row = sheet.getRange(r, 1, 1, NCOL).getValues()[0];
  var isDisc = row[COL.KIND - 1] === CFG.KIND_LABEL.discussant;
  return {
    ok: true, id: id, kind: row[COL.KIND - 1], discussant: isDisc, title: row[COL.TITLE - 1],
    abstract: String(row[COL.ABSTRACT - 1] || ''), topics: String(row[COL.TOPICS - 1] || ''),
    coauthors: parseCo_(row[COL.COAUTH - 1]), role: String(row[COL.ROLE - 1] || '주저자'), equal: row[COL.EQUAL - 1] === '동등',
    publish: row[COL.PUBLISH - 1],
    status: row[COL.STATUS - 1], version: row[COL.VER - 1],
    hasAbstractFile: !!row[COL.ABS_FILE - 1], hasFullText: !!row[COL.FULL_FILE - 1],
    editable: new Date() <= new Date(CFG.DEADLINE_EDIT), deadline: CFG.DEADLINE_EDIT.slice(0, 10),
    filesOpen: new Date() <= new Date(CFG.DEADLINE_FINAL), filesDeadline: CFG.DEADLINE_FINAL.slice(0, 10)
  };
}

/* ---------- 공개 프로그램 (상태가 '확정'인 건만, 공개범위 존중) ---------- */

function program_() {
  var sheet = sheet_();
  var n = sheet.getLastRow() - 1;
  var items = [];
  if (n > 0) {
    sheet.getRange(2, 1, n, NCOL).getValues().forEach(function (row) {
      if (row[COL.STATUS - 1] !== '확정') return;
      var publish = row[COL.PUBLISH - 1];
      items.push({
        id: row[COL.ID - 1], kind: row[COL.KIND - 1], name: row[COL.NAME - 1],
        affiliation: row[COL.AFFIL - 1], title: row[COL.TITLE - 1],
        authors: authorsFrom_(row[COL.NAME - 1], row[COL.AFFIL - 1], row[COL.ROLE - 1], row[COL.COAUTH - 1], row[COL.EQUAL - 1] === '동등'),
        abstract: publish === 'none' ? '' : row[COL.ABSTRACT - 1],
        session: row[COL.SESSION - 1], time: row[COL.TIME - 1]
      });
    });
  }
  items.sort(function (a, b) {
    return String(a.session).localeCompare(String(b.session)) || String(a.time).localeCompare(String(b.time));
  });
  return { ok: true, updated: now_(), items: items };
}

/* ---------- 도우미 ---------- */

function userErr_(msg) { return { user: true, msg: msg }; }
function fail_(msg) { return { ok: false, error: msg }; }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function str_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function now_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'); }
function folder_(id) { return DriveApp.getFolderById(id); }

function sheet_() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  var sh = ss.getSheetByName(CFG.SHEET_NAME) || ss.getSheets()[0];
  if (typeof sh.getMaxColumns === 'function' && sh.getMaxColumns() < NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), NCOL - sh.getMaxColumns());
  var hd = sh.getRange(1, COL.COAUTH, 1, EXTRA_HEADERS.length).getValues()[0];   // 열이 추가되기 전에 만든 시트도 자동 보정
  EXTRA_HEADERS.forEach(function (t, i) { if (!hd[i]) sh.getRange(1, COL.COAUTH + i).setValue(t); });
  return sh;
}

// 셀을 텍스트 형식으로 바꾼 뒤 값을 넣는다 (수식 주입·날짜 자동 변환 방지). num=true면 숫자로 저장.
function setText_(sheet, r, c, v, num) {
  var rg = sheet.getRange(r, c);
  if (num) { rg.setValue(Number(v)); return; }
  rg.setNumberFormat('@');
  rg.setValue(String(v));
}

function clip_(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

// 저자 구분: 주저자 / 공동저자 / 교신저자
function roleOf_(v, dflt) { return CFG.ROLES.indexOf(String(v || '')) >= 0 ? String(v) : dflt; }

// 공동저자: [{name, affiliation, role}] ↔ "김철수(B대)[교신저자]; 이영희(C대)[공동저자]"
function cleanCo_(arr) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) throw userErr_('공동저자 형식이 올바르지 않습니다.');
  var out = [];
  arr.forEach(function (c) {
    var name = str_(c && c.name, 50).replace(/[;()（）\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    var aff = str_(c && c.affiliation, 100).replace(/[;\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name && !aff) return;
    if (!name) throw userErr_('저자의 성명을 입력해 주세요.');
    out.push({ name: name, affiliation: aff, role: roleOf_(c && c.role, '공동저자') });
  });
  if (out.length > MAX_COAUTHORS) throw userErr_('함께한 저자는 최대 ' + MAX_COAUTHORS + '명까지 입력할 수 있습니다.');
  return out;
}
function coString_(list) {
  return (list || []).map(function (c) {
    return c.name + (c.affiliation ? '(' + c.affiliation + ')' : '') + '[' + roleOf_(c.role, '공동저자') + ']';
  }).join('; ');
}
function parseCo_(s) {
  return String(s || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
    var m = /^([^()\[\]]*?)\s*(?:\((.*?)\))?\s*(?:\[([^\]]*)\])?$/.exec(x);
    return { name: (m && m[1] ? m[1] : x).trim(), affiliation: (m && m[2]) || '', role: roleOf_(m && m[3], '공동저자') };
  });
}

// 대표 발표자 + 함께한 저자 → 표기 순서 결정.
//  - 동등 기여(equal): 전원 가나다순, 주저자·공동저자 구분은 표시하지 않고 교신저자만 표시
//  - 그 외: 대표 발표자가 먼저, 나머지는 입력 순서, 각자의 구분을 표시
// 반환: { list: [{name, affiliation, role, label}], equal, text }  (발제집 최종판도 이 text를 그대로 사용)
function authorsFrom_(name, affil, role, coStr, equal) {
  var list = [{ name: String(name || ''), affiliation: String(affil || ''), role: roleOf_(role, '주저자') }].concat(parseCo_(coStr));
  // 가나다순: 유니코드 한글 음절 순서(= 표준 사전 순서). 공백 무시·영문 대소문자 무시, 같으면 입력 순서 유지(안정 정렬)
  if (equal) list.sort(function (a, b) {
    var x = sortKey_(a.name), y = sortKey_(b.name);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  list.forEach(function (a) { a.label = equal ? (a.role === '교신저자' ? '교신저자' : '') : a.role; });
  var text = list.length < 2 ? '' : list.map(function (a) {
    var inner = [a.affiliation, a.label].filter(Boolean).join(', ');
    return a.name + (inner ? '(' + inner + ')' : '');
  }).join(', ') + (equal ? ' ※ 동등 기여, 가나다순' : '');
  return { list: list, equal: !!equal, text: text };
}
function sortKey_(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
function abstractText_(id, label, title, name, affil, authorsLine, abstract) {
  return '접수번호: ' + id + '\n유형: ' + label + '\n제목: ' + title + '\n성명: ' + name + '\n소속: ' + affil +
    (authorsLine ? '\n저자: ' + authorsLine : '') + '\n\n[초록]\n' + abstract + '\n';
}

function checkDeadline_(iso, label) {
  if (new Date() > new Date(iso)) throw userErr_(label + ' 마감(' + iso.slice(0, 10) + ')이 지났습니다.');
}

function nextId_(kind) {
  var props = PropertiesService.getScriptProperties();
  var key = 'seq_' + CFG.PREFIX[kind];
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return '2026-' + CFG.PREFIX[kind] + '-' + ('000' + n).slice(-3);
}

function appendRow_(sheet, row) {
  var r = sheet.getLastRow() + 1;
  var range = sheet.getRange(r, 1, 1, NCOL);
  range.setNumberFormat('@');          // 수식 주입 방지: 모든 칸을 텍스트로 저장
  range.setValues([row.map(function (v) { return typeof v === 'number' ? v : String(v); })]);
}

function findDuplicate_(sheet, kindKey, email, title) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return '';
  var label = CFG.KIND_LABEL[kindKey];
  var rows = sheet.getRange(2, 1, n, NCOL).getValues();
  for (var i = 0; i < rows.length; i++) {
    var rw = rows[i];
    if (rw[COL.KIND - 1] === label && String(rw[COL.EMAIL - 1]).toLowerCase() === email &&
        String(rw[COL.TITLE - 1]) === title && rw[COL.STATUS - 1] !== '철회') return rw[COL.ID - 1];
  }
  return '';
}

function findRow_(sheet, id, email) {
  var n = sheet.getLastRow() - 1;
  if (n < 1 || !id || !email) return 0;
  var rows = sheet.getRange(2, 1, n, NCOL).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][COL.ID - 1]) === id && String(rows[i][COL.EMAIL - 1]).toLowerCase() === email) return i + 2;
  }
  return 0;
}

function safeName_(s) { return String(s || '').replace(/[\\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40); }

// 형식·크기 검사만 수행 (아무것도 저장하지 않음). 접수번호 발급과 저장 전에 먼저 호출합니다.
function checkFile_(f) {
  if (!f || !f.data) return null;
  var orig = String(f.name || '').toLowerCase();
  var ext = orig.indexOf('.') >= 0 ? orig.split('.').pop() : '';
  if (CFG.EXT.indexOf(ext) < 0) throw userErr_('허용되지 않는 파일 형식입니다. (' + CFG.EXT.join(', ') + ')');
  var b64 = String(f.data).replace(/^data:[^,]*,/, '');
  if (b64.length * 0.75 > CFG.MAX_FILE_BYTES) throw userErr_('파일은 ' + Math.round(CFG.MAX_FILE_BYTES / 1048576) + 'MB 이하로 올려 주세요.');
  return { ext: ext, b64: b64 };
}

function saveFile_(folderId, f, id, name, label, ver) {
  var c = checkFile_(f);
  if (!c) return '';
  var ext = c.ext;
  var bytes = Utilities.base64Decode(c.b64);
  var fname = id + '_' + safeName_(name) + '_' + label + (ver > 1 ? '_v' + ver : '') + '.' + ext;
  var blob = Utilities.newBlob(bytes, 'application/octet-stream', fname);
  return folder_(folderId).createFile(blob).getUrl();
}

function mail_(to, subject, body) {
  if (!to) return;
  try {
    var opt = { to: to, subject: subject, body: body, name: '한국정보사회학회 학술대회 조직위원회' };
    if (CFG.REPLY_TO) opt.replyTo = CFG.REPLY_TO;
    MailApp.sendEmail(opt);
  } catch (err) {
    console.error('mail failed: ' + err);
  }
}

function notify_(d, id, kind, topics) {
  var label = CFG.KIND_LABEL[kind];
  mail_(d.email, '[' + CFG.CONF_NAME + '] 신청 접수 확인 (' + id + ')',
    d.name + ' 님,\n\n' + label + ' 신청이 접수되었습니다.\n\n접수번호: ' + id +
    '\n제목/분야: ' + (d.title || topics) +
    '\n\n접수번호와 이메일은 자료 제출·수정에 필요하니 보관해 주세요.' +
    '\n홈페이지의 "자료 제출·수정"에서 파일은 ' + CFG.DEADLINE_FINAL.slice(0, 10) + '까지 제출하고, 제목(가제목 포함)·초록·저자는 ' + CFG.DEADLINE_EDIT.slice(0, 10) + '까지 고칠 수 있습니다.' +
    '\n신청 마감: ' + CFG.DEADLINE_APPLY.slice(0, 10) + ' / 최종 자료 파일 마감: ' + CFG.DEADLINE_FINAL.slice(0, 10) + ' / 제목·초록·저자 수정 마감: ' + CFG.DEADLINE_EDIT.slice(0, 10) +
    '\n\n한국정보사회학회 조직위원회');
  if (CFG.ADMIN_EMAIL) {
    mail_(CFG.ADMIN_EMAIL, '[접수] ' + id + ' ' + label + ' - ' + d.name,
      id + ' / ' + label + ' / ' + d.name + ' (' + d.affil + ')\n' + (d.title || topics));
  }
}

/* ---------- 처음 한 번 실행 ---------- */

function setup() {
  var ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  var sh = ss.getSheets()[0];
  if (sh.getName() !== CFG.SHEET_NAME) sh.setName(CFG.SHEET_NAME);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, NCOL).setFontWeight('bold');
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(CFG.STATUS, true).setAllowInvalid(false).build();
  sh.getRange(2, COL.STATUS, 1000, 1).setDataValidation(rule);
  folder_(CFG.FOLDER_ABSTRACT); folder_(CFG.FOLDER_FULLTEXT);   // 폴더 접근 권한 확인
  console.log('setup 완료. 이제 배포 > 새 배포 > 웹 앱으로 배포하세요.');
}
