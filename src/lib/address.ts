// ที่อยู่ไทย: รายชื่อจังหวัด + จัดรูปแบบที่อยู่ (ใช้ได้ทั้ง client/server)

export const PROVINCES = [
  "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร", "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา",
  "ชลบุรี", "ชัยนาท", "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง", "ตราด", "ตาก", "นครนายก",
  "นครปฐม", "นครพนม", "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี", "นราธิวาส", "น่าน",
  "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์", "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา",
  "พะเยา", "พังงา", "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์", "แพร่", "ภูเก็ต",
  "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน", "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง", "ราชบุรี",
  "ลพบุรี", "ลำปาง", "ลำพูน", "เลย", "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
  "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี", "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี",
  "สุรินทร์", "หนองคาย", "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์", "อุทัยธานี",
  "อุบลราชธานี",
] as const;

export const DEFAULT_COUNTRY = "ไทย";

export type AddressParts = {
  address?: string | null;
  houseNo?: string | null;
  moo?: string | null;
  soi?: string | null;
  road?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

const isBangkok = (p?: string | null) => Boolean(p && /กรุงเทพ/.test(p));

/** ป้ายชื่อตำบล/อำเภอ ตามจังหวัด (กรุงเทพฯ ใช้ แขวง/เขต) */
export function subdistrictLabel(province?: string | null) {
  return isBangkok(province) ? "แขวง" : "ตำบล";
}
export function districtLabel(province?: string | null) {
  return isBangkok(province) ? "เขต" : "อำเภอ";
}

/** รวมที่อยู่เป็นบรรทัดเดียว เช่น "99/1 หมู่ 2 ซอยสุขุมวิท 1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110" */
export function formatAddress(a: AddressParts | null | undefined): string {
  if (!a) return "";
  const t = (v?: string | null) => (v ?? "").trim();
  const bkk = isBangkok(a.province);
  const parts = [
    t(a.address),
    t(a.houseNo),
    t(a.moo) && `หมู่ ${t(a.moo)}`,
    t(a.soi) && `ซอย${t(a.soi)}`,
    t(a.road) && `ถนน${t(a.road)}`,
    t(a.subdistrict) && `${bkk ? "แขวง" : "ตำบล"}${t(a.subdistrict)}`,
    t(a.district) && `${bkk ? "เขต" : "อำเภอ"}${t(a.district)}`,
    t(a.province) && (bkk ? t(a.province) : `จังหวัด${t(a.province)}`),
    t(a.postalCode),
    t(a.country) && t(a.country) !== DEFAULT_COUNTRY ? t(a.country) : "",
  ];
  return parts.filter(Boolean).join(" ");
}
