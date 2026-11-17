# crc.py — OECD Country Risk Classification(현행) PDF → crc.json
# 출처: https://www.oecd.org/en/topics/sub-issues/country-risk-classification.html (Prevailing Country Risk Classification PDF)
# 실패하면 기존 crc.json 을 그대로 둔다(종료 코드 0, update_risk.js 가 이전 값 사용).
import json, re, sys, io, urllib.request
URL = "https://www.oecd.org/content/dam/oecd/en/topics/policy-sub-issues/country-risk-classification/cre-crc-current-english.pdf"
try:
    from pypdf import PdfReader
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (feed-updater)"})
    data = urllib.request.urlopen(req, timeout=60).read()
    text = "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)
    flat = text.replace("\n", " ")
    m = re.search(r"(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)", flat)
    months = ["January","February","March","April","May","June","July","August","September","October","November","December"]
    valid = "%s-%02d-%02d" % (m.group(3), months.index(m.group(2)) + 1, int(m.group(1))) if m else None
    rows = {}
    # 행: nb ISO3 국가명 Previous Current [Notes]  — Current(현행) 값 사용. '-' = 분류 대상 아님
    for mm in re.finditer(r"\b\d{1,3}\s+([A-Z]{3})\s+(.+?)\s+([0-7]|-)\s+([0-7]|-)(?=\s|$)", flat):
        iso, cur = mm.group(1), mm.group(4)
        rows[iso] = None if cur == "-" else int(cur)
    if not valid or len(rows) < 150:
        print("crc.py: 파싱 결과 부족(valid=%s rows=%d) — 기존 crc.json 유지" % (valid, len(rows))); sys.exit(0)
    json.dump({"valid_as_of": valid, "url": URL, "rows": rows}, open("crc.json", "w", encoding="utf-8"), ensure_ascii=False)
    print("crc.py: valid", valid, "rows", len(rows), "VNM", rows.get("VNM"), "KHM", rows.get("KHM"), "RUS", rows.get("RUS"), "USA", rows.get("USA"))
except Exception as e:
    print("crc.py: 오류 — 기존 crc.json 유지:", e)
