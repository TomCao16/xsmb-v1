
/*
 * XSMB V1 - PAIR EXTRACTOR
 * Version 2.0.0
 *
 * Chức năng:
 * - Đọc dữ liệu history.days từ Worker
 * - Trích xuất cặp 2 chữ số liền nhau từ tất cả các giải
 * - Giữ ngày, giải, thứ tự kết quả, số gốc và vị trí cặp
 * - Chọn 4, 5 hoặc 6 ngày lịch sử
 * - Không chấm điểm, không xếp hạng, không dự đoán
 */
(function (root) {
  "use strict";

  const VERSION = "XSMB V1 PAIR EXTRACTOR 2.0.0";
  const ALLOWED_HISTORY_DAYS = [4, 5, 6];

  const PRIZE_ORDER = [
    "DB", "G1", "G2", "G3",
    "G4", "G5", "G6", "G7"
  ];

  function normalizeDate(value) {
    if (!value) return null;

    const match = String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (match) return value;

    const vn = String(value).match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

    if (vn) {
      return [
        vn[3],
        vn[2].padStart(2, "0"),
        vn[1].padStart(2, "0")
      ].join("-");
    }

    return null;
  }

  function dateToUtc(date) {
    const normalized = normalizeDate(date);
    if (!normalized) return NaN;

    const parts = normalized.split("-").map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  function dayDifference(a, b) {
    const left = dateToUtc(a);
    const right = dateToUtc(b);

    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return null;
    }

    return Math.round((right - left) / 86400000);
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

  function normalizeDigits(value) {
    if (value === null || value === undefined) return null;

    const text = String(value).trim();

    if (!/^\d+$/.test(text)) return null;

    return text;
  }

  function getPrizeValues(day) {
    const result = getResultObject(day);
    const prizes = result && result.prizes;

    if (!prizes || typeof prizes !== "object") {
      return [];
    }

    const rows = [];

    for (const prize of PRIZE_ORDER) {
      const raw = prizes[prize];

      if (raw === undefined || raw === null) continue;

      const values = Array.isArray(raw) ? raw : [raw];

      values.forEach((value, resultIndex) => {
        const digits = normalizeDigits(value);

        if (!digits) return;

        rows.push({
          prize,
          resultIndex: resultIndex + 1,
          sourceValue: digits
        });
      });
    }

    return rows;
  }

  /*
   * Mỗi cặp được giữ riêng theo vị trí.
   * Ví dụ 12345 tạo ra:
   * 12 ở vị trí 1-2
   * 23 ở vị trí 2-3
   * 34 ở vị trí 3-4
   * 45 ở vị trí 4-5
   */
  function extractPairs(day) {
    const result = getResultObject(day);

    if (!result) return [];

    const date = normalizeDate(result.date || day.date);
    const rows = getPrizeValues(day);
    const pairs = [];

    for (const row of rows) {
      const value = row.sourceValue;

      for (let i = 0; i < value.length - 1; i++) {
        pairs.push({
          date,
          prize: row.prize,
          resultIndex: row.resultIndex,
          sourceValue: value,
          positionStart: i + 1,
          positionEnd: i + 2,
          pair: value.slice(i, i + 2)
        });
      }
    }

    return pairs;
  }

  function getLotoSet(day) {
    const result = getResultObject(day);
    const loto = result && result.loto;

    if (!Array.isArray(loto)) return null;

    const values = [];

    for (const item of loto) {
      let value = item;

      if (item && typeof item === "object") {
        value =
          item.number ??
          item.value ??
          item.loto ??
          item.result;
      }

      const digits = normalizeDigits(value);
      if (!digits) continue;

      values.push(digits.slice(-2).padStart(2, "0"));
    }

    return new Set(values);
  }

  function getDays(data) {
    const history =
      data && data.history && Array.isArray(data.history.days)
        ? data.history.days
        : null;

    if (history) return history;

    if (data && Array.isArray(data.days)) return data.days;

    throw new Error(
      "Không tìm thấy danh sách ngày. Cần history.days hoặc days."
    );
  }

  function analyze(data, options) {
    const settings = options || {};
    const requestedDays = Number(settings.historyDays ?? 6);

    if (!ALLOWED_HISTORY_DAYS.includes(requestedDays)) {
      throw new Error("Chỉ được chọn 4, 5 hoặc 6 ngày lịch sử.");
    }

    const inputDays = getDays(data);

    const days = inputDays
      .map((day) => {
        const result = getResultObject(day);

        return {
          original: day,
          result,
          date: normalizeDate(
            result && (result.date || day.date)
          )
        };
      })
      .filter((day) => day.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (days.length < requestedDays + 1) {
      throw new Error(
        "Không đủ ngày dữ liệu. Cần ít nhất " +
        (requestedDays + 1) +
        " ngày để lấy ngày nguồn mới nhất và " +
        requestedDays +
        " ngày lịch sử trước đó."
      );
    }

    const latest = days[days.length - 1];

    /*
     * Ngày cuối cùng là ngày nguồn lấy cặp đầu ra.
     * Các ngày trước đó chỉ dùng để tra cứu vị trí cặp.
     * Không dùng kết quả tương lai để suy ra ứng viên.
     */
    const history = days.slice(
      days.length - requestedDays - 1,
      days.length - 1
    );

    const latestPairs = extractPairs(latest.original);

    const historyRows = history.map((day) => ({
      date: day.date,
      pairs: extractPairs(day.original),
      lotoSet: getLotoSet(day.original)
    }));

    const transitions = historyRows.map((row, index) => {
      const nextDay = days.find(
        (day) => day.date ===
          days[days.indexOf(history[index]) + 1]?.date
      );

      const targetLoto = nextDay
        ? getLotoSet(nextDay.original)
        : null;

      const matches = [];

      if (targetLoto) {
        for (const item of row.pairs) {
          const reverse = item.pair.split("").reverse().join("");

          if (
            targetLoto.has(item.pair) ||
            targetLoto.has(reverse)
          ) {
            matches.push({
              ...item,
              matchedPair: targetLoto.has(item.pair)
                ? item.pair
                : reverse,
              matchType: targetLoto.has(item.pair)
                ? "TRỰC TIẾP"
                : "ĐẢO"
            });
          }
        }
      }

      return {
        sourceDate: row.date,
        targetDate: nextDay ? nextDay.date : null,
        matches
      };
    });

    /*
     * Lập danh sách tra cứu theo cặp số.
     * Giữ toàn bộ vị trí, không gộp mất số gốc.
     */
    const pairLookup = {};

    for (const item of latestPairs) {
      if (!pairLookup[item.pair]) {
        pairLookup[item.pair] = {
          pair: item.pair,
          sourceOccurrences: []
        };
      }

      pairLookup[item.pair].sourceOccurrences.push(item);
    }

    for (const key of Object.keys(pairLookup)) {
      const record = pairLookup[key];

      record.historyOccurrences = [];

      for (const row of historyRows) {
        for (const item of row.pairs) {
          if (item.pair === key) {
            record.historyOccurrences.push(item);
          }
        }
      }
    }

    return {
      version: VERSION,
      historyDays: requestedDays,
      latestDate: latest.date,
      targetDate: null,
      sourcePairs: latestPairs,
      uniquePairs: Object.values(pairLookup),
      historyDates: historyRows.map((row) => row.date),
      transitions,
      notes: [
        "Không chấm điểm và không xếp hạng.",
        "Vị trí bắt đầu được tính từ 1, từ trái sang phải.",
        "Mỗi lần xuất hiện được giữ riêng để có thể kiểm tra lại.",
        "Ngày nguồn mới nhất chỉ dùng để trích xuất cặp số.",
        "Dữ liệu đối chiếu chỉ sử dụng các ngày lịch sử đã chọn."
      ]
    };
  }

  root.XSMBAlgorithm = {
    version: VERSION,
    allowedHistoryDays: ALLOWED_HISTORY_DAYS,
    extractPairs,
    analyze
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.XSMBAlgorithm;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
