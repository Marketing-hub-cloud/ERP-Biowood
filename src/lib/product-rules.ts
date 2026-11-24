// ตรวจค่าคุณสมบัติสินค้าตามชนิดข้อมูล (pure — ใช้ทั้ง client/server)

export type AttributeDef = {
  id: string;
  name: string;
  dataType: "TEXT" | "NUMBER" | "SELECT";
  options: string[];
  isRequired: boolean;
  isActive: boolean;
};

/** คืน error ราย attributeId (ตรวจเฉพาะคุณสมบัติที่เปิดใช้งาน) */
export function validateAttributeValues(defs: AttributeDef[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const d of defs) {
    if (!d.isActive) continue;
    const v = (values[d.id] ?? "").trim();
    if (!v) {
      if (d.isRequired) errors[d.id] = `กรุณากรอก${d.name}`;
      continue;
    }
    if (d.dataType === "NUMBER" && !/^-?\d+(\.\d+)?$/.test(v.replace(/,/g, ""))) errors[d.id] = `${d.name}ต้องเป็นตัวเลข`;
    if (d.dataType === "SELECT" && !d.options.includes(v)) errors[d.id] = `${d.name}: กรุณาเลือกจากรายการ`;
  }
  for (const id of Object.keys(values)) {
    if (!defs.some((d) => d.id === id) && values[id].trim()) errors[id] = "ไม่พบคุณสมบัตินี้";
  }
  return errors;
}

/** ค่าที่จะบันทึก: ตัด comma ของตัวเลข ตัดค่าว่าง */
export function normalizeAttributeValue(def: AttributeDef, v: string): string {
  const t = v.trim();
  return def.dataType === "NUMBER" ? t.replace(/,/g, "") : t;
}
