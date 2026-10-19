/*
 * XSMB V1 - TOP 10 PAIR MATCHER
 * Version 3.0.0
 *
 * Quy tắc:
 * - Ngày nguồn = ngày mục tiêu - 2 ngày.
 * - Ngày đối chiếu = ngày mục tiêu - 1 ngày.
 * - Chỉ lấy giải DB, G1, G2, G3, G4, G5, G6; bỏ G7.
 * - Chỉ trích cặp từ số gốc dài 4 hoặc 5 chữ số.
 * - Bỏ cặp nằm ở hai chữ số cuối của số gốc.
 * - Cặp đảo chiều được gộp chung khi đếm (34 và 43).
 * - Chọn 10 nhóm có tần suất cao nhất rồi đối chiếu với 2 số cuối
 *   của từng kết quả giải DB-G6 ở ngày kế tiếp.
 * - Giữ toàn bộ vị trí nguồn để kiểm tra.
 */
(function (root) {
  "use strict";

  const VERSION = "XSMB V1 TOP 10 PAIR MATCHER 3.0.0";
  const PRIZE_ORDER = ["DB", "G1", "G2", "G3", "G4", "G5", "G6"];

  const PRIZE_NAMES = {
    DB: "Đặc biệt", G1: "Giải nhất", G2: "Giải nhì",
    G3: "Giải ba", G4: "Giải tư", G5: "Giải năm", G6: "Giải sáu"
  };

  function normalizeDate(value) {
    if (!value) return null;
    const s = String(value);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }

  function shiftDate(date, amount) {
    const normalized = normalizeDate(date);
    if (!normalized) throw new Error("Ngày không hợp lệ: " + date);
    const d = new Date(normalized + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + amount);
    return d.toISOString().slice(0, 10);
  }

  function getResultObject(day) {
    if (!day || typeof day !== "object") return null;
    if (day.prizes && typeof day.prizes === "object") return day;
    if (day.result && typeof day.result === "object" && day.result.prizes) return day.result;
    return day;
  }

  function digitsOnly(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return /^\d+$/.test(s) ? s : null;
  }

  function prizeRows(day) {
    const result = getResultObject(day);
    const prizes = result && result.prizes;
    if (!prizes || typeof prizes !== "object") {
      throw new Error("Thiếu dữ liệu giải cho ngày " + (result?.date || day?.date || "không rõ"));
    }
    const rows = [];
    for (const prize of PRIZE_ORDER) {
      const raw = prizes[prize];
      if (raw === undefined || raw === null) continue;
      const values = Array.isArray(raw) ? raw : [raw];
      values.forEach((v, i) => {
        const value = digitsOnly(v);
        if (!value) return;
        rows.push({
          date: normalizeDate(result.date || day.date),
          prize,
          prizeName: PRIZE_NAMES[prize],
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

  function extractSourcePairs(day) {
    const pairs = [];
    for (const row of prizeRows(day)) {
      const value = row.sourceValue;
      // Chỉ số gốc 4 hoặc 5 chữ số.
      if (value.length !== 4 && value.length !== 5) continue;

      // Bỏ cặp cuối cùng: 12345 -> 12, 23, 34; không lấy 45.
      // i < value.length - 2 đảm bảo không lấy hai chữ số cuối.
      for (let i = 0; i < value.length - 2; i++) {
        const pair = value.slice(i, i + 2);
        pairs.push({
          ...row,
          positionStart: i + 1,
          positionEnd: i + 2,
          pair,
          group: canonicalPair(pair)
        });
      }
    }
    return pairs;
  }

  function extractTargetTails(day) {
    const tails = [];
    for (const row of prizeRows(day)) {
      const tail = row.sourceValue.slice(-2).padStart(2, "0");
      tails.push({
        date: row.date,
        prize: row.prize,
        prizeName: row.prizeName,
        resultIndex: row.resultIndex,
        sourceValue: row.sourceValue,
        tail,
        group: canonicalPair(tail)
      });
    }
    return tails;
  }

  function getDays(data) {
    if (data?.history && Array.isArray(data.history.days)) return data.history.days;
    if (Array.isArray(data?.days)) return data.days;
    throw new Error("Không tìm thấy history.days hoặc days trong dữ liệu.");
  }

  function analyze(data, options = {}) {
    const targetDate = normalizeDate(options.targetDate || data?.requested_date);
    if (!targetDate) {
      throw new Error("Thiếu ngày mục tiêu hợp lệ để xác định ngày nguồn và ngày đối chiếu.");
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

    if (!sourceDay) throw new Error("Worker chưa trả dữ liệu ngày nguồn " + sourceDate + ".");
    if (!compareDay) throw new Error("Worker chưa trả dữ liệu ngày đối chiếu " + compareDate + ".");

    const sourcePairs = extractSourcePairs(sourceDay);
    const targetTails = extractTargetTails(compareDay);
    const targetGroups = new Map();

    for (const tail of targetTails) {
      if (!targetGroups.has(tail.group)) targetGroups.set(tail.group, []);
      targetGroups.get(tail.group).push(tail);
    }

    const grouped = new Map();
    sourcePairs.forEach((item, order) => {
      if (!grouped.has(item.group)) {
        grouped.set(item.group, {
          group: item.group,
          reverse: item.group.split("").reverse().join(""),
          occurrences: [],
          firstOrder: order
        });
      }
      grouped.get(item.group).occurrences.push(item);
    });

    const ranked = Array.from(grouped.values())
      .sort((a, b) => b.occurrences.length - a.occurrences.length || a.firstOrder - b.firstOrder)
      .slice(0, 10)
      .map((record, index) => {
        const matches = targetGroups.get(record.group) || [];
        return {
          rank: index + 1,
          group: record.group,
          reverse: record.reverse,
          label: record.group === record.reverse ? record.group : `${record.group}/${record.reverse}`,
          frequency: record.occurrences.length,
          sourceOccurrences: record.occurrences,
          matched: matches.length > 0,
          matchCount: matches.length,
          comparisonOccurrences: matches
        };
      });

    return {
      version: VERSION,
      targetDate,
      sourceDate,
      compareDate,
      sourcePairs,
      totalSourceOccurrences: sourcePairs.length,
      uniqueGroupCount: grouped.size,
      top10: ranked,
      sourcePrizeOrder: PRIZE_ORDER.slice(),
      notes: [
        "G7 không được dùng.",
        "Chỉ số gốc 4 hoặc 5 chữ số được dùng để trích cặp.",
        "Cặp ở hai chữ số cuối của số gốc bị bỏ.",
        "Cặp đảo chiều được gộp chung khi đếm tần suất.",
        "Xếp hạng dựa trên tần suất ngày nguồn trước khi đối chiếu ngày kế tiếp."
      ]
    };
  }

  root.XSMBAlgorithm = {
    version: VERSION,
    prizeOrder: PRIZE_ORDER,
    canonicalPair,
    extractSourcePairs,
    analyze
  };

  if (typeof module !== "undefined" && module.exports) module.exports = root.XSMBAlgorithm;
})(typeof globalThis !== "undefined" ? globalThis : this);
