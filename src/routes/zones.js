export async function getActiveZones(db) {
  const { results } = await db
    .prepare(
      'SELECT code, label, excel_label, position, is_car, in_tower FROM zones WHERE active = 1 AND site_id = 1 ORDER BY position'
    )
    .all();
  return results.map((z) => ({
    code: z.code,
    label: z.label,
    excelLabel: z.excel_label,
    position: z.position,
    isCar: !!z.is_car,
    inTower: !!z.in_tower,
  }));
}

export function toApiZones(zones) {
  return zones.map(({ code, label, excelLabel, position, isCar, inTower }) => ({
    code,
    label,
    excelLabel,
    position,
    isCar,
    inTower,
  }));
}

export async function getSite(db) {
  return db.prepare('SELECT id, name, tower_total FROM sites WHERE id = 1').first();
}
