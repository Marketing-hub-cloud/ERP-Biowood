// error ที่ส่งกลับให้ผู้ใช้ได้ (ใช้ได้ทั้งใน route และ logic ที่ไม่ใช่ server-only เช่น stock ledger)
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
