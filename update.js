// update.js — 공개자료 피드 갱신 (GitHub Actions에서 매일 실행)
// 국가별 Google News RSS를 받아 feed.json 의 news/newsAll/newsSummary 만 교체한다.
// records/after(공개 공시 수치)는 그대로 둔다. 외부 패키지 없음(Node 기본 모듈만).
"use strict";
const fs = require("fs"), https = require("https");
const CFG = JSON.parse(fs.readFileSync("queries.json", "utf8"));
const FEED = "feed.json";
const feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const KEEP = CFG.per_country_keep || 20;

const ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };
function decode(s) {
  const one = x => x.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
    if (k[0] === "#") { const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    return ENT[k.toLowerCase()] !== undefined ? ENT[k.toLowerCase()] : m;
  });
  return one(one(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();
}
const tag = (it, t) => { const m = it.match(new RegExp("<" + t + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + t + ">")); return m ? m[1] : ""; };
function parseRSS(xml, cc) {
  const out = [], re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml))) {
    const it = m[1]; let title = decode(tag(it, "title")); const source = decode(tag(it, "source"));
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const link = decode(tag(it, "link"));
    if (!title || !/^https:\/\//.test(link)) continue;
    const pd = Date.parse(decode(tag(it, "pubDate"))), low = title.toLowerCase();
    out.push({ country_code: cc, title, link, source, published_at: isNaN(pd) ? null : new Date(pd).toISOString(),
      matched_keywords: (CFG.keywords_alert || []).filter(k => low.includes(String(k).toLowerCase())) });
  }
  return out;
}
function get(url, n) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (feed-updater)", Accept: "application/rss+xml, text/xml" }, timeout: 15000 }, s => {
      if ([301, 302, 303, 307, 308].includes(s.statusCode) && s.headers.location && (n || 0) < 3) { s.resume(); return res(get(new URL(s.headers.location, url).toString(), (n || 0) + 1)); }
      if (s.statusCode !== 200) { s.resume(); return rej(new Error("HTTP " + s.statusCode)); }
      const c = []; s.on("data", d => c.push(d)); s.on("end", () => res(Buffer.concat(c).toString("utf8"))); s.on("error", rej);
    });
    r.on("timeout", () => r.destroy(new Error("timeout"))); r.on("error", rej);
  });
}
const rssUrl = q => "https://news.google.com/rss/search?q=" + encodeURIComponent(q.q) + "&hl=" + encodeURIComponent(q.hl) + "&gl=" + encodeURIComponent(q.gl) + "&ceid=" + encodeURIComponent(q.ceid);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const now = new Date().toISOString();
  const news = {}, summary = {}; let all = [], ok = 0, fail = 0;
  for (const c of CFG.countries) {
    const cc = c.country_code, items = []; let got = 0;
    for (const q of c.queries) { try { items.push(...parseRSS(await get(rssUrl(q)), cc)); got++; } catch (e) { console.log("fail", cc, q.q, e.message); } await sleep(400); }
    const prev = (feed.news && feed.news[cc]) || { items: [], fetched_at: null };
    let list, fetched_at;
    if (got) {
      const seen = new Set(); items.sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
      list = items.filter(it => { const k = (it.title + "|" + it.source).toLowerCase().replace(/\s+/g, ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, KEEP);
      fetched_at = now; ok++;
    } else { list = prev.items || []; fetched_at = prev.fetched_at; fail++; } // 전부 실패한 국가는 이전 기사 유지
    news[cc] = { cc, name: c.name_ko, items: list, fetched_at, failed: false, stale: !got };
    const hits = list.filter(i => i.matched_keywords.length), kw = new Set(); hits.forEach(i => i.matched_keywords.forEach(k => kw.add(k)));
    summary[cc] = { name: c.name_ko, count: list.length, latest: list[0] ? list[0].published_at : null, fetched_at, failed: false, keyword_hits: hits.length, keywords: [...kw] };
    all = all.concat(list.map(i => Object.assign({ country_ko: c.name_ko }, i)));
  }
  if (!ok) { console.log("모든 국가 수신 실패 — feed.json 변경 안 함"); process.exit(1); }
  all.sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  feed.news = news; feed.newsSummary = summary;
  feed.newsAll = { cc: "ALL", name: "전체", items: all.slice(0, 100), fetched_at: now, failed: false };
  feed.built_at = now; feed.news_updated_at = now;
  fs.writeFileSync(FEED, JSON.stringify(feed));
  console.log("ok countries", ok, "fail", fail, "items", all.length, "size", fs.statSync(FEED).size);
})();
