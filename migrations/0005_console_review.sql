-- 中控確認時可修正數字：記錄改了哪些區與保全原值、車塔剩餘車位、顯示牌原數字
ALTER TABLE records ADD COLUMN corrections_json TEXT;
ALTER TABLE records ADD COLUMN tower_remaining INTEGER;
ALTER TABLE records ADD COLUMN display_before INTEGER;

-- 回填舊紀錄的車塔剩餘車位（與 buildTowerUsage(...).remaining 同語意）：
-- 該站有啟用中的車塔區、sites.tower_total > 0、且每個車塔區都是 spaces 或 full；
-- 值 = spaces 區的 value 總和（full 視為 0）。其餘維持 NULL。
UPDATE records
SET tower_remaining = (
  SELECT COALESCE(SUM(CAST(json_extract(j.value, '$.value') AS INTEGER)), 0)
  FROM json_each(records.values_json) j
  JOIN zones z
    ON z.code = j.key AND z.site_id = records.site_id AND z.active = 1 AND z.in_tower = 1
  WHERE json_extract(j.value, '$.kind') = 'spaces'
)
WHERE (
    SELECT COUNT(*)
    FROM zones z
    WHERE z.site_id = records.site_id AND z.active = 1 AND z.in_tower = 1
  ) > 0
  AND COALESCE((SELECT s.tower_total FROM sites s WHERE s.id = records.site_id), 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM zones z
    LEFT JOIN json_each(records.values_json) j ON j.key = z.code
    WHERE z.site_id = records.site_id AND z.active = 1 AND z.in_tower = 1
      AND (
        j.key IS NULL
        OR json_extract(j.value, '$.kind') NOT IN ('spaces', 'full')
        OR (
          json_extract(j.value, '$.kind') = 'spaces'
          AND json_type(j.value, '$.value') != 'integer'
        )
      )
  );
