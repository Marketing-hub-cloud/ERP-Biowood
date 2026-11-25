// ระยะทางระหว่างจุดเช็คอิน — ค่าเริ่มต้น Haversine (เส้นตรงบนผิวโลก)
// ออกแบบให้เปลี่ยนเป็น Google Distance Matrix ได้ภายหลัง: เพิ่ม provider ที่ implement DistanceProvider
// แล้วเลือกใน getDistanceProvider() จาก env DISTANCE_PROVIDER (logic ส่วนอื่นไม่ต้องแก้)

export type LatLng = { lat: number; lng: number };

export interface DistanceProvider {
  /** ชื่อที่เก็บลงข้อมูล (distanceSource) */
  readonly name: string;
  /** ระยะทาง กิโลเมตร */
  distanceKm(from: LatLng, to: LatLng): Promise<number>;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Haversine: ระยะเส้นตรงบนทรงกลม (กิโลเมตร) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const haversineProvider: DistanceProvider = {
  name: "haversine",
  distanceKm: async (a, b) => haversineKm(a, b),
};

export function getDistanceProvider(): DistanceProvider {
  // ตัวอย่างในอนาคต: if (process.env.DISTANCE_PROVIDER === "google") return googleDistanceMatrixProvider;
  return haversineProvider;
}

/** ปัดเป็น 3 ตำแหน่ง (เมตร) ให้ตรงกับคอลัมน์ Decimal(10,3) */
export const roundKm = (km: number) => Math.round(km * 1000) / 1000;

export function isValidLatLng(p: Partial<LatLng>): p is LatLng {
  return (
    typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  );
}

/** ลิงก์เปิด Google Maps ที่พิกัด */
export const mapsUrl = (p: LatLng) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
