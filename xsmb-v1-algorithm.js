
/*
 * XSMB V1 - POSITIONAL PAIR MATCHER
 * Version 4.0.0
 *
 * - Ngày nguồn: ngày mục tiêu - 2 ngày.
 * - Ngày đối chiếu thực tế: ngày mục tiêu - 1 ngày.
 * - Tạo cặp từ G3, G5, G6.
 * - G3/G5: lưới 2 hàng x 3 cột.
 * - G6: lưới 1 hàng x 3 cột.
 * - Ghép chữ số cùng vị trí trong các ô ở cột liền kề.
 * - Ghép chéo G5-G6 theo cột tương ứng.
 * - Chỉ giữ nhóm cặp xuất hiện trong kết quả thực tế DB-G7.
 * - Cặp đảo chiều được gộp chung.
 * - Xếp hạng tối đa Top 15 theo tần suất.
 *
 * Lưu ý: lưới được dựng từ thứ tự mảng prizes của Worker.
 * Cần xác nhận thứ tự này khớp với bố cục bảng trên trang nguồn.
 */
(function (root) {
  "use strict";

  const VERSION = "XSMB V1 POSITIONAL PAIR MATCHER 4.0.0";

  const SOURCE_PRIZES = ["G3", "G5", "G6"];
  const TARGET_PRIZES = [
    "DB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"
  ];

  const PRIZE_NAMES = {
    DB: "Đặc biệt",
    G1: "Giải nhất",
    G2: "Giải nhì",
    G3: "Giải ba",
    G4: "Giải tư",
    G5: "Giải năm",
    G6: "Giải sáu",
    G7: "Giải bảy"
  };

  function normalizeDate(value) {
    if (!value) return null;

    const s = String(value).trim();

    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;

    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }

    return null;
  }

  function shiftDate(date, amount) {
    const normalized = normalizeDate(date);

    if (!normalized) {
      throw new Error("Ngày không hợp lệ: " + date);
    }

    const d = new Date(normalized + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + amount);

    return d.toISOString().slice(0, 10);
  }

  function getResultObject(day) {
    if (!day || typeof day !== "object") return null;

    if (day.prizes && typeof day.prizes === "object") {
      return day;
    }

    if (
      day.result &&
      typeof day.result === "object" &&
      day.result.prizes
    ) {
      return day.result;
    }

    return day;
  }

  function digitsOnly(value) {
    if (value === null || value === undefined) return null;

    const s = String(value).trim();

    return /^\d+$/.test(s) ? s : null;
  }

  function prizeValues(day, prizeOrder) {
    const result = getResultObject(day);
    const prizes = result && result.prizes;

    if (!prizes || typeof prizes !== "object") {
      throw new Error(
        "Thiếu dữ liệu giải cho ngày " +
        (result?.date || day?.date || "không rõ")
      );
    }

    const rows = [];

    for (const prize of prizeOrder) {
      const raw = prizes[prize];

      if (raw === undefined || raw === null) continue;

      const values = Array.isArray(raw) ? raw : [raw];

      values.forEach((v, i) => {
        const value = digitsOnly(v);

        if (!value) return;

        rows.push({
          date: normalizeDate(result.date || day.date),
          prize,
          prizeName: PRIZE_NAMES[prize] || prize,
          resultIndex: i + 1,
          sourceValue: value
        });
      });
    }

    return rows;
  }

  function canonicalPair(pair) {
    const reverse = pair.split("").reverse().join("");

    return pair <= reverse ? pair : reverse;
  }

  function getPrizeRows(day, prize) {
    return prizeValues(day, [prize]).filter(
      row => row.prize === prize
    );
  }

  /*
   * Ghép chữ số ở cùng vị trí trong hai số thuộc hai ô liên quan.
   * Ví dụ:
   * left = 12345
   * right = 67890
   * Các cặp tạo ra: 16, 27, 38, 49, 50
   */
  function addPositionalPairs(output, left, right, relation) {
    const a = left.sourceValue;
    const b = right.sourceValue;
    const length = Math.min(a.length, b.length);

    for (let digitIndex = 0; digitIndex < length; digitIndex++) {
      const pair = a[digitIndex] + b[digitIndex];

      output.push({
        date: left.date || right.date,
        relation,
        digitPosition: digitIndex + 1,
        pair,
        group: canonicalPair(pair),

        left: {
          prize: left.prize,
          prizeName: left.prizeName,
          resultIndex: left.resultIndex,
          sourceValue: left.sourceValue,
          digit: a[digitIndex]
        },

        right: {
          prize: right.prize,
          prizeName: right.prizeName,
          resultIndex: right.resultIndex,
          sourceValue: right.sourceValue,
          digit: b[digitIndex]
        }
      });
    }
  }

  function makeGrid(rows, expectedCount, rowCount, columnCount, prize) {
    if (rows.length < expectedCount) {
      throw new Error(
        `Ngày nguồn thiếu số ở ${prize}: cần ${expectedCount}, nhận ${rows.length}.`
      );
    }

    const selected = rows.slice(0, expectedCount);
    const grid = [];

    for (let r = 0; r < rowCount; r++) {
      grid.push(
        selected.slice(r * columnCount, (r + 1) * columnCount)
      );
    }

    return grid;
  }

  function extractSourcePairs(day) {
    const pairs = [];

    const rowsG3 = getPrizeRows(day, "G3");
    const rowsG5 = getPrizeRows(day, "G5");
    const rowsG6 = getPrizeRows(day, "G6");

    const gridG3 = makeGrid(rowsG3, 6, 2, 3, "G3");
    const gridG5 = makeGrid(rowsG5, 6, 2, 3, "G5");
    const gridG6 = makeGrid(rowsG6, 3, 1, 3, "G6");

    // Ghép các ô ở cột liền kề trong từng bảng.
    for (const [prize, grid] of [
      ["G3", gridG3],
      ["G5", gridG5],
      ["G6", gridG6]
    ]) {
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length - 1; c++) {
          addPositionalPairs(
            pairs,
            grid[r][c],
            grid[r][c + 1],
            `${prize}_ADJACENT_COLUMNS`
          );
        }
      }
    }

    // Ghép G5-G6 theo cột tương ứng.
    // Mỗi số G6 ghép với hai số G5 ở cùng cột.
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 2; r++) {
        addPositionalPairs(
          pairs,
          gridG5[r][c],
          gridG6[0][c],
          "G5_G6_SAME_COLUMN"
        );
      }
    }

    return pairs;
  }

  function extractActualTails(day) {
    return prizeValues(day, TARGET_PRIZES).map(row => {
      const tail = row.sourceValue.slice(-2).padStart(2, "0");

      return {
        date: row.date,
        prize: row.prize,
        prizeName: row.prizeName,
        resultIndex: row.resultIndex,
        sourceValue: row.sourceValue,
        tail,
        group: canonicalPair(tail)
      };
    });
  }

  function getDays(data) {
    if (data?.history && Array.isArray(data.history.days)) {
      return data.history.days;
    }

    if (Array.isArray(data?.days)) {
      return data.days;
    }

    throw new Error(
      "Không tìm thấy history.days hoặc days trong dữ liệu."
    );
  }

  function analyze(data, options = {}) {
    const targetDate = normalizeDate(
      options.targetDate ||
      data?.requested_date ||
      data?.date
    );

    if (!targetDate) {
      throw new Error(
        "Thiếu ngày mục tiêu hợp lệ để xác định ngày nguồn và ngày đối chiếu."
      );
    }

    const sourceDate = shiftDate(targetDate, -2);
    const compareDate = shiftDate(targetDate, -1);

    const byDate = new Map();

    for (const day of getDays(data)) {
      const result = getResultObject(day);
      const date = normalizeDate(result?.date || day?.date);

      if (date) byDate.set(date, day);
    }

    const sourceDay = byDate.get(sourceDate);
    const compareDay = byDate.get(compareDate);

    if (!sourceDay) {
      throw new Error(
        "Worker chưa trả dữ liệu ngày nguồn " + sourceDate + "."
      );
    }

    if (!compareDay) {
      throw new Error(
        "Worker chưa trả dữ liệu đối chiếu thực tế " + compareDate + "."
      );
    }

    const sourcePairs = extractSourcePairs(sourceDay);
    const actualTails = extractActualTails(compareDay);

    const actualGroups = new Map();

    for (const tail of actualTails) {
      if (!actualGroups.has(tail.group)) {
        actualGroups.set(tail.group, []);
      }

      actualGroups.get(tail.group).push(tail);
    }

    const grouped = new Map();

    sourcePairs.forEach((item, order) => {
      if (!grouped.has(item.group)) {
        const reverse = item.group.split("").reverse().join("");

        grouped.set(item.group, {
          group: item.group,
          reverse,
          label: item.group === reverse
            ? item.group
            : `${item.group}/${item.group.split("").reverse().join("")}`,
          occurrences: [],
          firstOrder: order
        });
      }

      grouped.get(item.group).occurrences.push(item);
    });

    // Chỉ giữ nhóm cặp có mặt trong kết quả thực tế ngày đối chiếu.
    const matchedRanked = Array.from(grouped.values())
      .map(record => {
        const matches = actualGroups.get(record.group) || [];

        return {
          ...record,
          matched: matches.length > 0,
          matchCount: matches.length,
          comparisonOccurrences: matches
        };
      })
      .filter(record => record.matched)
      .sort((a, b) =>
        b.occurrences.length - a.occurrences.length ||
        a.firstOrder - b.firstOrder
      )
      .slice(0, 15)
      .map((record, index) => ({
        rank: index + 1,
        group: record.group,
        reverse: record.reverse,
        label: record.label,
        frequency: record.occurrences.length,
        sourceOccurrences: record.occurrences,
        matched: true,
        matchCount: record.matchCount,
        comparisonOccurrences: record.comparisonOccurrences
      }));

    return {
      version: VERSION,
      targetDate,
      sourceDate,
      compareDate,

      sourcePairs,
      totalSourceOccurrences: sourcePairs.length,
      uniqueGroupCount: grouped.size,

      matchedGroupCount: Array.from(grouped.values()).filter(
        record => actualGroups.has(record.group)
      ).length,

      top15: matchedRanked,

      // Trường tương thích giao diện cũ.
      // top10 chỉ chứa 10 mục đầu; top15 chứa tối đa 15 mục.
      top10: matchedRanked.slice(0, 10),

      sourcePrizeOrder: SOURCE_PRIZES.slice(),
      targetPrizeOrder: TARGET_PRIZES.slice(),

      notes: [
        "Chỉ G3, G5 và G6 được dùng để tạo cặp theo vị trí.",
        "G3 và G5 dùng lưới 2 hàng x 3 cột; G6 dùng lưới 1 hàng x 3 cột.",
        "Chỉ ghép chữ số cùng vị trí trong các ô liên quan.",
        "G5-G6 được ghép theo cột tương ứng.",
        "Kết quả thực tế đối chiếu lấy đuôi 2 số của các giải DB-G7.",
        "Nhóm cặp không xuất hiện trong kết quả thực tế bị loại trước khi xếp hạng.",
        "Cặp đảo chiều được gộp chung khi đếm và đối chiếu.",
        "Xếp hạng tối đa 15 nhóm hợp lệ theo tần suất.",
        "Khi bằng tần suất, giữ thứ tự xuất hiện đầu tiên."
      ]
    };
  }

  root.XSMBAlgorithm = {
    version: VERSION,
    prizeOrder: SOURCE_PRIZES,
    canonicalPair,
    extractSourcePairs,
    extractActualTails,
    analyze
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.XSMBAlgorithm;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
