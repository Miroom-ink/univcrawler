// crawler.js
// 경희대학교 공지사항 게시판(BMSR00040)을 카테고리별로 긁어와서
// data/items.json 에 날짜순으로 정렬해 저장하는 스크립트입니다.
//
// 실행: node crawler.js
// 필요 패키지: axios, cheerio  (package.json 참고, npm install 로 설치)

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ── 1) 카테고리 목록 (menuNo만 다르고 게시판 구조는 동일) ──────────────
const CATEGORIES = {
  일반: "200316",
  학사: "200317",
  장학: "200318",
  근로: "200361",
  시간표변경: "200319",
  교내학점교류: "200320",
  행사: "200321",
};

const BASE = "https://www.khu.ac.kr/kor/user/bbs/BMSR00040";

// 카테고리당 최대 몇 페이지까지 긁을지 (한 페이지에 보통 10개 안팎)
const MAX_PAGES = 3;

// ── 2) 한 페이지(list.do)를 요청해서 글 목록을 파싱 ─────────────────
async function fetchListPage(menuNo, pageIndex) {
  const url = `${BASE}/list.do?menuNo=${menuNo}&pageIndex=${pageIndex}`;
  const res = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 10000,
  });

  const $ = cheerio.load(res.data);
  const items = [];

  // 표의 각 행(tr)을 순회. 헤더 행이나 빈 행은 자동으로 걸러짐.
  $("table tbody tr").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");
    if (cells.length < 3) return; // 데이터 행이 아니면 스킵

    // 제목 링크 찾기: onclick="javascript:view('321747','');" 형태에서 글번호 추출
    const $link = $row.find("a[href*='view'], a[onclick*='view']").first();
    if ($link.length === 0) return;

    const onclickAttr = $link.attr("onclick") || $link.attr("href") || "";
    const idMatch = onclickAttr.match(/view\('(\d+)'/);
    const boardId = idMatch ? idMatch[1] : null;
    if (!boardId) return;

    let title = $link.text().trim().replace(/\s+/g, " ");

    // 제목 앞의 [공통]/[국제]/[서울] 같은 캠퍼스 태그 분리
    const tagMatch = title.match(/^\[(.+?)\]\s*/);
    const campusTag = tagMatch ? tagMatch[1] : null;
    if (tagMatch) title = title.slice(tagMatch[0].length);

    // 행 안의 모든 셀 텍스트 중에서 날짜(YYYY-MM-DD) 패턴 찾기
    const rowText = cells.map((_, c) => $(c).text().trim()).get();
    const dateCell = rowText.find((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));

    // 조회수: 마지막 셀이 숫자면 그걸로 간주
    const lastCell = rowText[rowText.length - 1];
    const views = /^\d+$/.test(lastCell) ? Number(lastCell) : null;

    // 작성자: 날짜 셀 바로 앞 셀로 추정
    const dateIdx = rowText.indexOf(dateCell);
    const writer = dateIdx > 0 ? rowText[dateIdx - 1] : null;

    items.push({
      id: boardId,
      title,
      campusTag,
      writer,
      date: dateCell || null,
      views,
      url: `${BASE}/view.do?boardId=${boardId}&menuNo=${menuNo}`,
    });
  });

  return items;
}

// ── 3) 카테고리 하나를 여러 페이지 긁기 ─────────────────────────────
async function fetchCategory(categoryName, menuNo) {
  let all = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const items = await fetchListPage(menuNo, p);
    if (items.length === 0) break; // 더 이상 글이 없으면 중단
    all = all.concat(items.map((it) => ({ ...it, category: categoryName })));
    await sleep(300); // 서버에 과부하 주지 않도록 살짝 대기
  }
  return all;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 4) 전체 카테고리 크롤링 → 날짜순 정렬 → 저장 ─────────────────────
async function main() {
  let all = [];

  for (const [name, menuNo] of Object.entries(CATEGORIES)) {
    console.log(`크롤링 중: ${name} (menuNo=${menuNo})`);
    try {
      const items = await fetchCategory(name, menuNo);
      console.log(`  -> ${items.length}건 수집`);
      all = all.concat(items);
    } catch (err) {
      console.error(`  ${name} 크롤링 실패:`, err.message);
    }
  }

  // 같은 글이 여러 카테고리에 겹칠 수 있으니 id 기준 중복 제거
  const seen = new Set();
  const deduped = all.filter((it) => {
    const key = it.id + "-" + it.category;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 날짜 내림차순 정렬 (게시판 자체는 정렬이 안 되어 있어서 여기서 보정)
  deduped.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const outDir = path.join(__dirname, "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(
    path.join(outDir, "items.json"),
    JSON.stringify(deduped, null, 2),
    "utf-8"
  );

  console.log(`\n총 ${deduped.length}건 저장 완료 -> data/items.json`);
}

main();
