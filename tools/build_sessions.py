#!/usr/bin/env python3
"""data/sessions.json -> sessions.html (정적 세션표). 사용: python3 tools/build_sessions.py"""
import json, html, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = json.load(open(os.path.join(ROOT, 'data', 'sessions.json'), encoding='utf-8'))
ABS = json.load(open(os.path.join(ROOT, 'data', 'abstracts.json'), encoding='utf-8'))
e = html.escape
DAY0, DAY1 = 12 * 60, 18 * 60 + 10
NH = (DAY1 - DAY0) / 60

def mins(t):
    h, m = t.split(':'); return int(h) * 60 + int(m)
def pct(t): return (mins(t) - DAY0) / (DAY1 - DAY0) * 100
def room_name(i): return D['rooms'][i - 1]

# ---- 하루 눈금자 ----
def seg(ev, label, cls):
    l, r = pct(ev['start']), pct(ev['end'])
    href = '#' + ev['id']
    if r - l < 6: cls += ' narrow'
    return (f'<a class="seg {cls}" href="{href}" style="left:{l:.3f}%;width:{r-l:.3f}%" '
            f'aria-label="{e(label)} {ev["start"]}~{ev["end"]}"><span>{e(label)}</span></a>')

lanes = {0: [], 1: [], 2: [], 3: []}
for ev in D['events']:
    if ev['type'] == 'posters':
        for rm in ev['rooms']:
            lanes[rm['room']].append(seg(ev, ev['part'].replace('제', '').replace('부', '') + '부', f'r{rm["room"]}'))
    elif ev['type'] == 'talks':
        lanes[ev['room']].append(seg(ev, ev['part'].replace('제', '').replace('부', '') + '부', f'r{ev["room"]}'))
    elif ev['type'] == 'plain':
        lanes[ev.get('room', 0)].append(seg(ev, ev['short'], 'r%d' % ev.get('room', 0)))
ticks = ''.join(
    f'<i class="tick" style="left:{(h-12)*60/(DAY1-DAY0)*100:.3f}%"><b>{h}</b></i>' for h in range(12, 19))
def lane(label, key, cls):
    no = f'<small>{e(D["room_nos"][key-1])}</small>' if key else ''
    return f'<div class="lane-label {cls}">{e(label)}{no}</div><div class="lane">{"".join(lanes[key])}</div>'
ruler = f'''<figure class="day" aria-label="하루 일정 한눈에 보기" style="--n:{NH:.4f}">
<div class="axis-label"></div><div class="axis" aria-hidden="true">{ticks}</div>
{lane("전체", 0, "r0")}{lane(D["rooms"][0], 1, "r1")}{lane(D["rooms"][1], 2, "r2")}
{lane(D["rooms"][2], 3, "r3")}
</figure>'''

# ---- 본문 ----
def room_tag(i):
    return f'<span class="room r{i}"><i></i>{e(room_name(i))} <em>{e(D["room_nos"][i-1])}</em></span>'

def when(ev):
    return f'<div class="when"><time>{ev["start"]}</time><span>{ev["end"]}</span></div>'

def person_line(role, text):
    return f'<div class="rl"><span class="role">{e(role)}</span><span>{e(text)}</span></div>'

EQ = ' ※ 동등 기여, 가나다순'

def linked(item, title, cls=''):
    """공개 동의한 건만 제목에 링크: 원문 PDF(1순위) 또는 초록 페이지(2순위)."""
    a = ABS.get(item.get('abs', ''))
    if not a: return f'<span{cls}>{e(title)}</span>'
    if a.get('file'):
        href, tag, ext = a['file'], '원문', ' target="_blank" rel="noopener"'
    else:
        href, tag, ext = 'abstracts.html#a-' + item['abs'], '초록', ''
    return f'<a class="tl"{cls} href="{e(href)}"{ext}>{e(title)}</a><i class="ltag">{tag}</i>'
out = []
for ev in D['events']:
    t = ev['type']
    if t == 'move':
        out.append(f'<div class="move" role="separator"><span>{ev["start"]}~{ev["end"]}</span> 이동 · {e(ev["note"])}</div>')
    elif t == 'plain':
        head = e(ev.get('part', '')) 
        title = e(ev['title'])
        note = f'<p class="muted">{e(ev["note"])}</p>' if ev.get('note') else ''
        rt = room_tag(ev['room']) if ev.get('room') else ''
        part = f'<p class="part">{head} {rt}</p>' if (head or rt) else ''
        out.append(f'<article class="slot" id="{ev["id"]}">{when(ev)}<div class="body">{part}<h2>{title}</h2>{note}</div></article>')
    elif t == 'posters':
        groups = []
        for rm in ev['rooms']:
            lis = []
            for tm in rm['teams']:
                ti = tm['title']
                tcls = ' class="tbd"' if ti.startswith('(') or '업데이트 예정' in ti else ''
                head = linked(tm, ti, tcls) if tm.get('abs') else f'<span{tcls}>{e(ti)}</span>'
                lis.append(f'<li>{head}<small>{e(tm["authors"])}{EQ if tm.get("equal") else ""}</small></li>')
            groups.append(f'<section class="pgroup"><h3>{e(rm["label"])} {room_tag(rm["room"])}</h3><ul class="posters">{"".join(lis)}</ul></section>')
        out.append(f'''<article class="slot" id="{ev["id"]}">{when(ev)}<div class="body">
<p class="part">{e(ev["part"])} <span class="kind">{e(ev["round"])}</span></p><h2>{e(ev["title"])}</h2>
<div class="pcols">{"".join(groups)}</div></div></article>''')
    elif t == 'talks':
        kind = f'<span class="kind">{e(ev["kind"])}</span>' if ev.get('kind') else ''
        parts = [f'<p class="part">{e(ev["part"])} {kind} {room_tag(ev["room"])}</p><h2>{e(ev["title"])}</h2>']
        rows = []
        for o in ev.get('opening', []):
            rows.append(f'<div class="rl"><span class="role"></span><span class="open">{e(o)}</span></div>')
        if ev.get('chair'):
            rows.append(person_line('사회', ev['chair']))
        for tk in ev['talks']:
            if tk.get('authors'):
                au = ', '.join(('<u>%s</u>' % e(a['name']) if a.get('presenter') else e(a['name'])) + ' (%s)' % e(a['aff']) for a in tk['authors'])
            else:
                au = e(tk['presenter'])
            tcls = ' class="tbd"' if '업데이트 예정' in tk['title'] else ''
            rows.append(f'<div class="rl talk"><span class="role">발표</span><span><b{tcls}>{linked(tk, tk["title"]) if tk.get('abs') else e(tk["title"])}</b><small>{au}{EQ if tk.get('equal') else ''}</small></span></div>')
        if ev.get('discussants'):
            rows.append(person_line('종합토론', ev['discussants']))
        out.append(f'<article class="slot" id="{ev["id"]}">{when(ev)}<div class="body">{"".join(parts)}{"".join(rows)}</div></article>')

NAV = '''<a href="index.html#about">소개</a>
      <a href="index.html#schedule">일정</a>
      <a href="index.html#venue">오시는 길</a>
      <a href="sessions.html" aria-current="page">세션표</a>
      <a href="program.html">프로그램</a>
      <a href="proceedings.html">발제집</a>
      <a class="cta" href="apply.html">신청</a>'''

page = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>세션표 · {e(D["title"])}</title>
<meta name="description" content="{e(D["when"])} {e(D["where"])} 세션표">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="css/sessions.css">
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="index.html"><strong>한국정보사회학회</strong><span class="mono">2026 FALL CONFERENCE</span></a>
    <nav class="nav" aria-label="주요 메뉴">
      {NAV}
    </nav>
  </div>
</header>

<main id="main">
<div class="wrap sess">
  <h1>세션표</h1>
  <p class="lead">{e(D["title"])}<br><span class="theme">{e(D["theme"])}</span></p>
  <dl class="facts">
    <div><dt>일시</dt><dd>{e(D["when"])}</dd></div>
    <div><dt>장소</dt><dd>{e(D["where"])}</dd></div>
  </dl>
  {ruler}
  <div class="slots">
{chr(10).join(out)}
  </div>
  <p class="foot">※ {e(D["footnote"])}</p>
  <p class="foot">※ 제목에 <i class="ltag">초록</i> <i class="ltag">원문</i> 표시가 있으면 누르면 해당 자료를 볼 수 있습니다.</p>
  <p class="foot">※ 저자가 신청 시 공개를 원하지 않은 경우에는 초록과 원문 링크를 연결하지 않으며, 공동 저자의 공개 범위가 서로 다른 팀은 가장 좁은 범위에 맞춥니다. 링크가 없는 발표의 자료는 학술대회 현장에서 발표자를 통해 확인하실 수 있습니다.</p>
  <div class="btn-row"><a class="btn ghost" href="index.html#venue">오시는 길</a><a class="btn ghost" href="program.html">발표 초록 보기</a></div>
</div>
</main>

<footer>
  <div class="wrap">
    <span>한국정보사회학회 · 2026 가을철 정기학술대회 조직위원회</span>
    <span id="contact"></span>
  </div>
</footer>
<script src="js/config.js"></script>
<script src="js/app.js"></script>
</body>
</html>
'''
open(os.path.join(ROOT, 'sessions.html'), 'w', encoding='utf-8').write(page)
print('sessions.html written', len(page))

# ---- abstracts.html ----
seen, cards = set(), []
def entries():
    for ev in D['events']:
        if ev['type'] == 'posters':
            for rm in ev['rooms']:
                for t in rm['teams']: yield ev, t, t['authors'], t['title']
        elif ev['type'] == 'talks':
            for t in ev['talks']:
                if t.get('authors'):
                    au = ', '.join(a['name'] + ' (' + a['aff'] + ')' for a in t['authors'])
                else: au = t['presenter']
                yield ev, t, au, t['title']
for ev, t, au, title in entries():
    i = t.get('abs')
    if not i or i in seen or ABS[i].get('file'): continue
    seen.add(i)
    a = ABS[i]
    paras = ''.join(f'<p>{e(p.strip())}</p>' for p in a['text'].split('\n') if p.strip())
    where = ev['part'] + (' ' + ev.get('round', '') if ev.get('round') else '')
    cards.append(f'<article class="abs" id="a-{i}"><p class="part">{e(where)}</p><h2>{e(title)}</h2><p class="by">{e(au)}</p>{paras}</article>')
apage = page.split('<main id="main">')[0].replace('세션표 · ', '초록 · ').replace(' aria-current="page"', '', 1)
apage = apage.replace('<a href="sessions.html">세션표</a>', '<a href="sessions.html" aria-current="page">세션표</a>') if False else apage
apage += f'''<main id="main">
<div class="wrap sess">
  <h1>초록</h1>
  <p class="lead">{e(D["title"])}<br><span class="theme">발표자가 공개에 동의한 초록입니다. 제목은 세션표 기준이며, 신청 후 수정된 내용과 다를 수 있습니다.</span></p>
  <div class="abslist">
{chr(10).join(cards)}
  </div>
  <div class="btn-row"><a class="btn ghost" href="sessions.html">세션표로 돌아가기</a></div>
</div>
</main>
<footer>
  <div class="wrap">
    <span>한국정보사회학회 · 2026 가을철 정기학술대회 조직위원회</span>
    <span id="contact"></span>
  </div>
</footer>
<script src="js/config.js"></script>
<script src="js/app.js"></script>
</body>
</html>
'''
open(os.path.join(ROOT, 'abstracts.html'), 'w', encoding='utf-8').write(apage)
print('abstracts.html written', len(cards), 'cards')
