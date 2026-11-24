// โครงสร้างเมนู + รายการ menuKey ที่ใช้กำหนดสิทธิ์ (ดู CLAUDE.md หัวข้อ 3)
// ไฟล์นี้ใช้ได้ทั้งฝั่ง client และ server (ห้าม import ของฝั่ง server)

export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete", "cancel", "approve"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "ดู",
  create: "สร้าง",
  edit: "แก้ไข",
  delete: "ลบ",
  cancel: "ยกเลิก",
  approve: "อนุมัติ",
};

const ALL: PermissionAction[] = ["view", "create", "edit", "delete", "cancel"];
/** เอกสารที่ผ่าน approval engine: มีสิทธิ์ "อนุมัติ" เพิ่ม (ใช้เมื่อไม่ได้ตั้งผังอนุมัติ) */
const ALL_APPROVE: PermissionAction[] = [...ALL, "approve"];
const VIEW_ONLY: PermissionAction[] = ["view"];
const VIEW_EDIT: PermissionAction[] = ["view", "edit"];

export type MenuItem = {
  key: string;
  label: string;
  href: string;
  /** สิทธิ์ที่มีความหมายกับเมนูนี้ (แสดงในหน้ากำหนดสิทธิ์) */
  actions: PermissionAction[];
  /** เฟสที่จะพัฒนา ถ้ายังไม่ถึงจะแสดงหน้า "กำลังพัฒนา" */
  ready?: boolean;
  /** ไม่ต้องใช้สิทธิ์ (ผู้ใช้ทุกคนเห็น) */
  public?: boolean;
};

export type MenuSection = {
  key: string;
  label: string;
  icon: "contacts" | "crm" | "inventory" | "engineer" | "purchase" | "users" | "settings";
  items: MenuItem[];
};

export const MENU: MenuSection[] = [
  {
    key: "contacts",
    label: "ผู้ติดต่อ",
    icon: "contacts",
    items: [
      { key: "contacts.customer", label: "ลูกค้า", href: "/contacts/customers", actions: ALL, ready: true },
      { key: "contacts.vendor", label: "ผู้ขาย", href: "/contacts/vendors", actions: ALL, ready: true },
    ],
  },
  {
    key: "crm",
    label: "การขาย (CRM)",
    icon: "crm",
    items: [
      { key: "crm.project", label: "โครงการ", href: "/crm/projects", actions: ALL },
      { key: "crm.plan", label: "แผนการทำงาน", href: "/crm/plans", actions: ALL },
      { key: "crm.report", label: "รายงาน", href: "/crm/reports", actions: VIEW_ONLY },
    ],
  },
  {
    key: "inventory",
    label: "คลังสินค้า",
    icon: "inventory",
    items: [
      { key: "inventory.product", label: "สินค้า", href: "/inventory/products", actions: ALL, ready: true },
      { key: "inventory.receipt", label: "นำเข้า", href: "/inventory/receipts", actions: ALL, ready: true },
      { key: "inventory.issue", label: "นำออก", href: "/inventory/issues", actions: ALL, ready: true },
      { key: "inventory.delivery", label: "ตารางงานพนักงานส่ง", href: "/inventory/deliveries", actions: ALL },
      { key: "inventory.report", label: "รายงาน", href: "/inventory/reports", actions: VIEW_ONLY },
    ],
  },
  {
    key: "engineer",
    label: "ถอดแบบ/ติดตั้ง",
    icon: "engineer",
    items: [
      { key: "engineer.document", label: "ใบถอดแบบ/ติดตั้ง", href: "/engineer/documents", actions: ALL },
    ],
  },
  {
    key: "purchase",
    label: "จัดซื้อ",
    icon: "purchase",
    items: [
      { key: "purchase.request", label: "ใบขอซื้อ", href: "/purchase/requests", actions: ALL_APPROVE, ready: true },
      { key: "purchase.order", label: "ใบสั่งซื้อ", href: "/purchase/orders", actions: ALL_APPROVE, ready: true },
      { key: "purchase.return", label: "ใบส่งคืน", href: "/purchase/returns", actions: ALL_APPROVE, ready: true },
      { key: "purchase.report", label: "รายงาน", href: "/purchase/reports", actions: VIEW_ONLY },
    ],
  },
  {
    key: "users",
    label: "ผู้ใช้งาน",
    icon: "users",
    items: [
      { key: "users.account", label: "บัญชีผู้ใช้", href: "/users/accounts", actions: ["view", "create", "edit", "cancel"], ready: true },
      { key: "users.group", label: "กำหนดสิทธิ์", href: "/users/groups", actions: ["view", "create", "edit", "delete"], ready: true },
      { key: "users.profile", label: "แก้ไขข้อมูลส่วนตัว", href: "/profile", actions: [], ready: true, public: true },
    ],
  },
  {
    key: "settings",
    label: "ตั้งค่า",
    icon: "settings",
    items: [
      { key: "settings.inventory", label: "ตั้งค่าคลัง", href: "/settings/inventory", actions: VIEW_EDIT, ready: true },
      { key: "settings.approval", label: "การอนุมัติ", href: "/settings/approval", actions: VIEW_EDIT, ready: true },
      { key: "settings.remark", label: "ตั้งค่าหมายเหตุ", href: "/settings/remarks", actions: ALL, ready: true },
      { key: "settings.company", label: "ข้อมูลบริษัท", href: "/settings/company", actions: VIEW_EDIT, ready: true },
      { key: "settings.notification", label: "การแจ้งเตือน", href: "/settings/notifications", actions: VIEW_EDIT },
    ],
  },
];

export const MENU_ITEMS: MenuItem[] = MENU.flatMap((s) => s.items);

/** menuKey ที่ต้องใช้สิทธิ์ (ไม่รวมเมนู public) */
export const PERMISSION_MENU_KEYS: string[] = MENU_ITEMS.filter((i) => !i.public).map((i) => i.key);

export function findMenuItem(key: string): MenuItem | undefined {
  return MENU_ITEMS.find((i) => i.key === key);
}

export function findMenuByPath(pathname: string): { section: MenuSection; item: MenuItem } | undefined {
  for (const section of MENU) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) return { section, item };
    }
  }
  return undefined;
}
