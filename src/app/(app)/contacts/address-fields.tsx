"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { districtLabel, PROVINCES, subdistrictLabel } from "@/lib/address";

export type AddressValues = {
  address: string;
  houseNo: string;
  moo: string;
  soi: string;
  road: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
  country: string;
};

export const EMPTY_ADDRESS: AddressValues = {
  address: "",
  houseNo: "",
  moo: "",
  soi: "",
  road: "",
  subdistrict: "",
  district: "",
  province: "",
  postalCode: "",
  country: "ไทย",
};

/** ฟิลด์ที่อยู่ไทย (ใช้ทั้งที่อยู่จดทะเบียนและที่อยู่จัดส่ง) */
export function AddressFields({
  value,
  onChange,
  disabled,
  errors = {},
  prefix,
}: {
  value: AddressValues;
  onChange: (v: AddressValues) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
  /** prefix ของ key error/ id เช่น "reg" หรือ "shippingAddresses.0" */
  prefix: string;
}) {
  const uid = useId();
  const provinceList = `${uid}-provinces`;
  const idOf = (f: string) => `${prefix.replace(/\./g, "-")}-${f}`;
  const set = (k: keyof AddressValues, v: string) => onChange({ ...value, [k]: v });
  const field = (k: keyof AddressValues, label: string, className?: string, extra?: React.ComponentProps<typeof Input>) => (
    <FormField label={label} htmlFor={idOf(k)} error={errors[`${prefix}.${k}`]} className={className}>
      <Input id={idOf(k)} value={value[k]} onChange={(e) => set(k, e.target.value)} disabled={disabled} {...extra} />
    </FormField>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {field("address", "ที่อยู่ (อาคาร/หมู่บ้าน)", "sm:col-span-2")}
      {field("houseNo", "เลขที่")}
      {field("moo", "หมู่")}
      {field("soi", "ซอย")}
      {field("road", "ถนน")}
      {field("subdistrict", `${subdistrictLabel(value.province)}`)}
      {field("district", `${districtLabel(value.province)}`)}
      {field("province", "จังหวัด", undefined, { list: provinceList, autoComplete: "off" })}
      <datalist id={provinceList}>
        {PROVINCES.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {field("postalCode", "รหัสไปรษณีย์", undefined, { inputMode: "numeric", maxLength: 10 })}
      {field("country", "ประเทศ")}
    </div>
  );
}
