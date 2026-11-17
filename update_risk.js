// update_risk.js — 공개자료 피드의 '국가위험·거시·자동 공시' 갱신 (GitHub Actions 매일 실행, update.js 다음)
//   ① 국가위험: OECD Country Risk Classification(crc.json, crc.py 가 OECD PDF 에서 추출) → 0~7 등급 → anchor_score 1~10
//   ② 정책금리: BIS Central bank policy rates(WS_CBPOL, 월말) → 현재값·12개월 변화
//   ③ 환율: fawazahmed0 currency-api(일별, 기준 USD) → 현지통화 90일 변화율(+ = 현지통화 강세)
//   ④ 미국 법인 공시: FDIC BankFind Call Report API(CERT 24920) → 분기 비율 지표 자동 반영
//   ⑤ 공시 게시 감시: 법인 공시 페이지의 새 PDF·다음 분기 예정 주소 확인 → disclosure_watch
// 실패한 항목은 이전 값을 유지하고 오류만 남긴다. 외부 패키지 없음.
"use strict";
const fs = require("fs"), https = require("https");
const FEED = "feed.json";
const feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const now = new Date().toISOString(), today = now.slice(0, 10);
const COUNTRIES = {
  CN: { iso3: "CHN", cur: "cny", bis: "CN", name: "중국" }, ID: { iso3: "IDN", cur: "idr", bis: "ID", name: "인도네시아" },
  KH: { iso3: "KHM", cur: "khr", bis: null, name: "캄보디아" }, VN: { iso3: "VNM", cur: "vnd", bis: null, name: "베트남" },
  RU: { iso3: "RUS", cur: "rub", bis: "RU", name: "러시아" }, BR: { iso3: "BRA", cur: "brl", bis: "BR", name: "브라질" },
  HK: { iso3: "HKG", cur: "hkd", bis: "HK", name: "홍콩" }, PH: { iso3: "PHL", cur: "php", bis: "PH", name: "필리핀" },
  MM: { iso3: "MMR", cur: "mmk", bis: null, name: "미얀마" }, DE: { iso3: "DEU", cur: "eur", bis: "XM", name: "독일" },
  US: { iso3: "USA", cur: "usd", bis: "US", name: "미국" }, JP: { iso3: "JPN", cur: "jpy", bis: "JP", name: "일본" },
  SG: { iso3: "SGP", cur: "sgd", bis: null, name: "싱가포르" }, IN: { iso3: "IND", cur: "inr", bis: "IN", name: "인도" },
  BH: { iso3: "BHR", cur: "bhd", bis: null, name: "바레인" }, BD: { iso3: "BGD", cur: "bdt", bis: null, name: "방글라데시" },
  AE: { iso3: "ARE", cur: "aed", bis: null, name: "아랍에미리트" }, AU: { iso3: "AUS", cur: "aud", bis: "AU", name: "호주" },
  PL: { iso3: "POL", cur: "pln", bis: "PL", name: "폴란드" }, MY: { iso3: "MYS", cur: "myr", bis: "MY", name: "말레이시아" },
  HU: { iso3: "HUN", cur: "huf", bis: "HU", name: "헝가리" }
};
const errors = [];
const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;

function get(url, n) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (feed-updater)" }, timeout: 30000 }, s => {
      if ([301, 302, 303, 307, 308].includes(s.statusCode) && s.headers.location && (n || 0) < 4) { s.resume(); return res(get(new URL(s.headers.location, url).toString(), (n || 0) + 1)); }
      const c = []; s.on("data", d => c.push(d)); s.on("end", () => res({ status: s.statusCode, body: Buffer.concat(c).toString("utf8"), url })); s.on("error", rej);
    });
    r.on("timeout", () => r.destroy(new Error("timeout"))); r.on("error", rej);
  });
}
async function getOk(url) { const r = await get(url); if (r.status !== 200) throw new Error("HTTP " + r.status); return r.body; }
const isoDaysAgo = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

/* ① OECD CRC */
function crc() {
  try {
    const c = JSON.parse(fs.readFileSync("crc.json", "utf8"));
    if (!c.valid_as_of || !c.rows) throw new Error("crc.json 형식");
    return c;
  } catch (e) { errors.push("OECD CRC: " + e.message); return null; }
}
/* ② BIS 정책금리 */
async function bisRates() {
  const codes = [...new Set(Object.values(COUNTRIES).map(c => c.bis).filter(Boolean))].join("+");
  const start = isoDaysAgo(500).slice(0, 7);
  const csv = await getOk("https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M." + codes + "?startPeriod=" + start + "&format=csvfile");
  const lines = csv.trim().split(/\r?\n/), hd = splitCsv(lines[0]);
  const iA = hd.indexOf("REF_AREA"), iT = hd.indexOf("TIME_PERIOD"), iV = hd.indexOf("OBS_VALUE");
  const by = {};
  lines.slice(1).forEach(l => { const c = splitCsv(l); const v = parseFloat(c[iV]); if (!isFinite(v)) return; (by[c[iA]] = by[c[iA]] || []).push({ t: c[iT], v }); });
  Object.keys(by).forEach(k => by[k].sort((a, b) => a.t < b.t ? -1 : 1));
  return by;
}
function splitCsv(l) { const out = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; }
/* ③ 환율 */
async function fxRates(dateStr) {
  const u = d => "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@" + d + "/v1/currencies/usd.min.json";
  if (dateStr === "latest") { const j = JSON.parse(await getOk(u("latest"))); if (j.usd) return { date: j.date, usd: j.usd }; throw new Error("환율 latest 형식"); }
  for (let back = 0; back < 5; back++) {
    const d = new Date(new Date(dateStr + "T00:00:00Z").getTime() - back * 86400000).toISOString().slice(0, 10);
    try { const j = JSON.parse(await getOk(u(d))); if (j.usd) return { date: j.date, usd: j.usd }; } catch (e) { /* 휴일 등 → 하루 전 */ }
  }
  throw new Error("환율 " + dateStr + " 없음");
}

/* ④ FDIC (미국 우리아메리카은행 CERT 24920) */
const FDIC_FIELDS = "REPDTE,RBCRWAJ,RBC1RWAJ,RBCT1CER,RBC1AAJ,NCLNLSR,NCLNLS,LNATRES,LNATRESR,ROA,ROE,LNLSDEPR,ASSET,DEP,LNLSNET,EQ,NETINC";
async function fdic() {
  const url = "https://api.fdic.gov/banks/financials?filters=CERT:24920&fields=" + FDIC_FIELDS + "&sort_by=REPDTE&sort_order=DESC&limit=6&format=json";
  const j = JSON.parse(await getOk(url));
  const recs = [];
  (j.data || []).forEach(x => {
    const d = x.data, rd = String(d.REPDTE), as_of = rd.slice(0, 4) + "-" + rd.slice(4, 6) + "-" + rd.slice(6, 8);
    const period = rd.slice(0, 4) + "Q" + Math.ceil(Number(rd.slice(4, 6)) / 3);
    const src = (field, note) => ({ kind: "공시", title: "FDIC Call Report via BankFind Suite API (CERT 24920, Woori America Bank)", url, page: "field " + field + (note ? " (" + note + ")" : ""), retrieved_at: today });
    const add = (metric, v, unit, field, note, calc) => { if (v == null || !isFinite(v)) return; recs.push({ entity_id: "WB_US_LB", metric, period, as_of, value: r2(v), unit, basis: "local", status: calc ? "당사계산" : "공시", na_reason: null, source: src(field, note), calc: calc || null, note: "FDIC API 자동 갱신", auto: "fdic" }); };
    add("car", d.RBCRWAJ, "%", "RBCRWAJ", "Total risk-based capital ratio, PCA");
    add("tier1", d.RBC1RWAJ, "%", "RBC1RWAJ", "Tier 1 RBC ratio");
    add("cet1", d.RBCT1CER, "%", "RBCT1CER", "CET1 ratio");
    add("leverage", d.RBC1AAJ, "%", "RBC1AAJ", "Tier 1 leverage ratio");
    add("npl_ratio", d.NCLNLSR, "%", "NCLNLSR", "noncurrent loans & leases / gross loans");
    add("provision_ratio", d.LNATRESR, "%", "LNATRESR", "loan loss reserve / gross loans");
    add("roa", d.ROA, "%", "ROA", "연환산, YTD");
    add("roe", d.ROE, "%", "ROE", "연환산, YTD");
    add("ldr", d.LNLSDEPR, "%", "LNLSDEPR", "net loans & leases / deposits");
    if (d.NCLNLS > 0 && d.LNATRES != null) add("coverage", d.LNATRES / d.NCLNLS * 100, "%", "LNATRES, NCLNLS", "", { formula: "LNATRES " + d.LNATRES + " / NCLNLS " + d.NCLNLS + " ×100" });
    add("total_assets", d.ASSET / 1000, "백만 USD", "ASSET", "천 USD→백만 환산");
    add("deposits", d.DEP / 1000, "백만 USD", "DEP", "천 USD→백만 환산");
    add("loans", d.LNLSNET / 1000, "백만 USD", "LNLSNET", "천 USD→백만 환산");
    add("equity", d.EQ / 1000, "백만 USD", "EQ", "천 USD→백만 환산");
    add("net_income", d.NETINC / 1000, "백만 USD", "NETINC", "연초누적, 천 USD→백만 환산");
  });
  return recs;
}
function upsert(list, recs) {
  const key = r => r.entity_id + "|" + r.metric + "|" + r.as_of;
  const m = new Map(list.map(r => [key(r), r]));
  let added = 0, changed = 0;
  recs.forEach(r => { const o = m.get(key(r)); if (!o) { added++; m.set(key(r), r); } else if (o.value !== r.value && o.auto === "fdic") { changed++; m.set(key(r), r); } else if (!o.auto && Math.abs(o.value - r.value) > 0.051) { /* 수기 공시값과 다르면 수기값 유지, 경고만 */ errors.push("FDIC 값 차이(수기값 유지): " + key(r) + " " + o.value + " vs " + r.value); } });
  return { list: [...m.values()], added, changed };
}

/* ⑤ 공시 게시 감시 */
const WATCH = [
  { entity_id: "WB_VN_LB", label: "베트남우리은행 공시 페이지", page: "https://woori.com.vn/en/information-disclosure/", type: "links" },
  { entity_id: "WB_BR_LB", label: "브라질우리은행 홈페이지 공시", page: "https://wooribank.com.br/", type: "links" },
  { entity_id: "WB_HK_LB", label: "홍콩 HKMA 공시(우리은행 홍콩)", type: "next", next: q => "https://vpr.hkma.gov.hk/statics/assets/doc/300505/fd_int/fd_int_" + q.mm + q.yy + "_eng.pdf" },
  { entity_id: "WC_ID_LB", label: "우리파이낸스인도네시아 분기 보고(BPFI)", type: "next", next: q => "https://indopremier.com/xdir/news/LAPORAN%20KEUANGAN/" + q.yyyy + "/q" + q.q + "//BPFI_Q" + q.q + "_" + q.yyyy + ".pdf" }
];
function nextQuarters(lastAsOf) {
  // 마지막 반영 기준일 다음 분기 2개
  const out = []; let y = Number(lastAsOf.slice(0, 4)), m = Number(lastAsOf.slice(5, 7));
  for (let i = 0; i < 2; i++) { m += 3; if (m > 12) { m -= 12; y++; } const mm = String(m).padStart(2, "0"); out.push({ yyyy: String(y), yy: String(y).slice(2), mm, q: Math.ceil(m / 3), as_of: y + "-" + mm }); }
  return out;
}
async function watch(prev) {
  const res = [];
  const lastAsOf = id => { let a = "2000-01-01"; (feed.records || []).concat(feed.after || []).forEach(r => { if (r.entity_id === id && r.as_of > a) a = r.as_of; }); return a; };
  for (const w of WATCH) {
    const p = (prev || []).find(x => x.entity_id === w.entity_id && x.label === w.label) || {};
    const o = { entity_id: w.entity_id, label: w.label, checked_at: now, last_reflected: lastAsOf(w.entity_id), new_items: [], error: null, known: p.known || null };
    try {
      if (w.type === "links") {
        const r = await get(w.page); if (r.status !== 200) throw new Error("HTTP " + r.status);
        const links = [...new Set((r.body.match(/href="([^"]+\.pdf)"/gi) || []).map(s => new URL(s.slice(6, -1), w.page).toString()))];
        if (!o.known) o.known = links; // 첫 실행: 기준 목록 저장
        o.new_items = links.filter(l => !o.known.includes(l)).map(u => ({ url: u, seen_at: (p.new_items || []).find(x => x.url === u)?.seen_at || now }));
        o.page = w.page;
      } else {
        for (const q of nextQuarters(o.last_reflected)) {
          const u = w.next(q), r = await get(u);
          if (r.status === 200 && r.body.slice(0, 5) === "%PDF-") o.new_items.push({ url: u, period: q.as_of, seen_at: (p.new_items || []).find(x => x.url === u)?.seen_at || now });
        }
      }
    } catch (e) { o.error = e.message; o.new_items = p.new_items || []; }
    res.push(o);
  }
  return res;
}

(async () => {
  const prevMacro = feed.macro || [], macro = [];
  const C = crc();
  let bis = null, fxNow = null, fx90 = null;
  try { bis = await bisRates(); } catch (e) { errors.push("BIS 정책금리: " + e.message); }
  try { fxNow = await fxRates("latest"); fx90 = await fxRates(isoDaysAgo(90)); } catch (e) { errors.push("환율: " + e.message); }
  Object.keys(COUNTRIES).forEach(cc => {
    const c = COUNTRIES[cc], old = prevMacro.find(x => x.cc === cc) || {};
    const row = { cc, name: c.name, as_of: today, status: "공시", synthetic: false, sources: [] };
    // 국가위험(OECD 0~7, '-'=고소득 OECD 국가 등 분류 대상 아님 → 0으로 취급)
    const cr = C && C.rows[c.iso3];
    if (cr !== undefined) {
      row.oecd_crc = cr === null ? null : cr; row.oecd_crc_label = cr === null ? "분류 대상 아님(고소득국)" : cr + "등급";
      row.anchor_score = r2(1 + (cr === null ? 0 : cr) * 9 / 7);
      row.sources.push({ kind: "공시", title: "OECD Country Risk Classifications (valid as of " + C.valid_as_of + ")", url: C.url, page: c.iso3 });
    } else if (old.anchor_score != null) { row.anchor_score = old.anchor_score; row.oecd_crc = old.oecd_crc; row.oecd_crc_label = old.oecd_crc_label; row.sources.push(...(old.sources || []).filter(s => /OECD/.test(s.title))); }
    // 정책금리
    const s = bis && c.bis && bis[c.bis];
    if (s && s.length) {
      const last = s[s.length - 1], back = s.find(x => x.t >= shiftMonth(last.t, -12)) || s[0];
      row.policy_rate = last.v; row.policy_rate_as_of = last.t; row.policy_rate_12m_change = r2(last.v - back.v);
      row.sources.push({ kind: "공시", title: "BIS Central bank policy rates (WS_CBPOL, 월말)", url: "https://data.bis.org/topics/CBPOL", page: c.bis + " " + back.t + "→" + last.t });
    } else if (old.policy_rate != null) { ["policy_rate", "policy_rate_as_of", "policy_rate_12m_change"].forEach(k => row[k] = old[k]); }
    // 환율(현지통화 가치 변화: + = 강세)
    if (fxNow && fx90 && c.cur !== "usd" && fxNow.usd[c.cur] && fx90.usd[c.cur]) {
      row.fx_change_90d = r2((fx90.usd[c.cur] / fxNow.usd[c.cur] - 1) * 100); row.fx_usd = fxNow.usd[c.cur]; row.fx_as_of = fxNow.date; row.fx_base_date = fx90.date;
      row.sources.push({ kind: "2차출처", title: "currency-api 일별 환율(USD 기준, 중앙은행·시장 환율 집계)", url: "https://github.com/fawazahmed0/exchange-api", page: c.cur.toUpperCase() + " " + fx90.date + "→" + fxNow.date });
    } else if (c.cur === "usd") { row.fx_change_90d = 0; row.fx_as_of = today; }
    else if (old.fx_change_90d != null) { ["fx_change_90d", "fx_usd", "fx_as_of", "fx_base_date"].forEach(k => row[k] = old[k]); }
    macro.push(row);
  });
  feed.macro = macro;
  feed.country_risk_meta = { oecd_valid_as_of: C ? C.valid_as_of : (feed.country_risk_meta || {}).oecd_valid_as_of || null, bis_ok: !!bis, fx_ok: !!(fxNow && fx90), updated_at: now };
  // 미국 공시 자동
  try {
    const recs = await fdic(), basis = feed.basis_as_of || "2026-06-30";
    const all = (feed.records || []).concat(feed.after || []);
    const u = upsert(all, recs);
    feed.records = u.list.filter(r => !r.as_of || r.as_of <= basis); feed.after = u.list.filter(r => r.as_of && r.as_of > basis);
    feed.auto_disclosure = { fdic: { added: u.added, changed: u.changed, latest: recs.length ? recs[0].as_of : null, checked_at: now } };
  } catch (e) { errors.push("FDIC: " + e.message); }
  try { feed.disclosure_watch = await watch(feed.disclosure_watch); } catch (e) { errors.push("공시 감시: " + e.message); }
  feed.risk_updated_at = now; feed.built_at = now; feed.risk_errors = errors;
  fs.writeFileSync(FEED, JSON.stringify(feed));
  console.log("macro", macro.length, "anchor", macro.filter(m => m.anchor_score != null).length, "rate", macro.filter(m => m.policy_rate != null).length, "fx", macro.filter(m => m.fx_change_90d != null).length);
  console.log("fdic", JSON.stringify(feed.auto_disclosure || {}), "watch", (feed.disclosure_watch || []).map(w => w.entity_id + ":" + w.new_items.length + (w.error ? "(" + w.error + ")" : "")).join(" "));
  if (errors.length) console.log("errors:\n - " + errors.join("\n - "));
})();
function shiftMonth(t, d) { let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)) + d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + "-" + String(m).padStart(2, "0"); }
