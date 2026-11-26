import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { allocateDocNumber, DOC_PREFIXES } from "@/lib/doc-number";
import { formatDate, formatNumber } from "@/lib/format";
import { cancelIssue, postIssue, serialBalances, STOCK_TX } from "@/lib/stock-ledger";
import { checkIssueQuantities, dateOnly, ISSUE_STATUS_LABELS, ISSUE_TYPE_LABELS, toMilli } from "@/lib/stock-rules";
import { rtLineIssued } from "@/lib/purchase-status";
import { pathLabel, type TreeNode } from "@/lib/tree";
import type { IssueData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { kickNotificationWorker } from "@/lib/notification-worker";
import { cancelDeliveriesOfIssue } from "./deliveries";
import type { Prisma } from "@/generated/prisma/client";

export const ENTITY_ISSUE = "GoodsIssue";

export const issueInclude = {
  contact: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } },
  purchaseReturn: { select: { id: true, docNo: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  postedBy: { select: { firstName: true, lastName: true } },
  cancelledBy: { select: { firstName: true, lastName: true } },
  lines: {
    orderBy: { lineNo: "asc" },
    include: {
      product: { include: { stockUnit: true } },
      serial: true,
    },
  },
} satisfies Prisma.GoodsIssueInclude;
export type IssueFull = Prisma.GoodsIssueGetPayload<{ include: typeof issueInclude }>;

export async function getIssueOr404(id: string) {
  const r = await prisma.goodsIssue.findUnique({ where: { id }, include: issueInclude });
  if (!r) throw new ApiError(404, "ไม่พบใบนำออก");
  return r;
}

async function snapshot(tx: TxClient, id: string) {
  const d = await tx.goodsIssue.findUniqueOrThrow({ where: { id }, include: issueInclude });
  return {
    type: ISSUE_TYPE_LABELS[d.type],
    docDate: formatDate(d.docDate),
    contact: d.contact ? `${d.contact.code} ${d.contact.name}` : null,
    purchaseReturn: d.purchaseReturn?.docNo ?? null,
    recipientName: d.recipientName,
    shippingAddress: d.shippingAddress,
    note: d.note,
    status: ISSUE_STATUS_LABELS[d.status],
    lines: d.lines.map((l) => `${l.serial.barcode} ${l.product.code} × ${formatNumber(l.quantity.toString())} ${l.product.stockUnit?.name ?? ""}`.trim()),
  };
}

export type SerialInfo = {
  serialId: string;
  barcode: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  warehouse: string;
  location: string;
  lot: string | null;
  balance: number;
};

/** ข้อมูล SN สำหรับสแกนนำออก (เฉพาะ SN ที่นำเข้าคลังแล้ว) */
export async function lookupSerial(barcode: string): Promise<SerialInfo> {
  const s = await prisma.stockSerial.findUnique({
    where: { barcode },
    include: { product: { include: { stockUnit: true } }, warehouse: true, receiptLine: { include: { receipt: true } } },
  });
  if (!s) throw new ApiError(404, `ไม่พบ barcode ${barcode}`);
  if (s.receiptLine.receipt.status !== "POSTED" || !s.warehouseId) throw new ApiError(400, `${barcode} ยังไม่ได้นำเข้าคลัง`);
  const [bal, nodes] = await Promise.all([prisma.$transaction((tx) => serialBalances(tx, [s.id])), prisma.stockLocation.findMany()]);
  const balance = bal.get(s.id) ?? 0;
  return {
    serialId: s.id,
    barcode: s.barcode,
    productId: s.productId,
    productCode: s.product.code,
    productName: s.product.name,
    unit: s.product.stockUnit?.name ?? "",
    warehouse: s.warehouse?.name ?? "",
    location: s.locationId && s.locationId !== s.warehouseId ? pathLabel(nodes as TreeNode[], s.locationId).split(" > ").slice(1).join(" > ") : "",
    lot: s.lot,
    balance,
  };
}

/** ตรวจผู้ติดต่อ + SN + จำนวน (ยอดตรวจซ้ำแบบ lock ตอนนำออกจริง) */
async function assertRefs(tx: TxClient, d: IssueData, currentReturnId?: string | null) {
  const rt =
    d.type === "RETURN" && d.purchaseReturnId
      ? await tx.purchaseReturn.findUnique({ where: { id: d.purchaseReturnId }, include: { lines: { orderBy: { lineNo: "asc" }, include: { product: true } } } })
      : null;
  if (d.type === "RETURN") {
    const ok = rt && (rt.status === "APPROVED" || rt.status === "PARTIAL" || (rt.status === "COMPLETED" && rt.id === currentReturnId));
    if (!rt || !ok) throw new ApiError(400, "ใบส่งคืนนี้ยังไม่อนุมัติ ถูกยกเลิก หรือส่งคืนครบแล้ว", { purchaseReturnId: "ใบส่งคืนไม่ถูกต้อง" });
    d.contactId = rt.vendorId; // ผู้รับ = ผู้ขายของใบส่งคืน
  } else {
    d.purchaseReturnId = null;
  }
  if (d.contactId) {
    const c = await tx.contact.findFirst({ where: { id: d.contactId, deletedAt: null } });
    if (!c) throw new ApiError(400, "ไม่พบผู้ติดต่อ", { contactId: "ไม่พบผู้ติดต่อ" });
    if (d.type === "SALE" && !c.isCustomer) throw new ApiError(400, "ประเภทขายต้องเลือกผู้ติดต่อที่เป็นลูกค้า", { contactId: "ผู้ติดต่อนี้ไม่ใช่ลูกค้า" });
  }
  const ids = d.lines.map((l) => l.serialId);
  const serials = await tx.stockSerial.findMany({ where: { id: { in: ids } }, include: { receiptLine: { include: { receipt: true } } } });
  const bal = await serialBalances(tx, ids);
  const qtyErr = checkIssueQuantities(d.lines, bal);
  const fields: Record<string, string> = {};
  d.lines.forEach((l, i) => {
    const s = serials.find((x) => x.id === l.serialId);
    if (!s || s.receiptLine.receipt.status !== "POSTED") fields[`lines.${i}.quantity`] = "SN นี้ยังไม่ได้นำเข้าคลัง";
    else if (qtyErr[l.serialId]) fields[`lines.${i}.quantity`] = `${s.barcode}: ${qtyErr[l.serialId]}`;
  });
  if (Object.keys(fields).length) throw new ApiError(400, Object.values(fields)[0], fields);

  // ส่งคืน: จับคู่แต่ละ SN กับรายการในใบส่งคืนที่เป็นสินค้าเดียวกันและยังคืนได้พอ
  const returnAlloc = new Map<string, string>();
  if (rt) {
    const issued = await rtLineIssued(tx, rt.lines.map((l) => l.id));
    const left = new Map(rt.lines.map((l) => [l.id, toMilli(l.quantity.toString()) - toMilli(issued.get(l.id) ?? 0)]));
    d.lines.forEach((l, i) => {
      const s = serials.find((x) => x.id === l.serialId)!;
      const candidates = rt.lines.filter((rl) => rl.productId === s.productId);
      if (!candidates.length) {
        fields[`lines.${i}.quantity`] = `${s.barcode}: สินค้านี้ไม่อยู่ในใบส่งคืน`;
        return;
      }
      const rl = candidates.find((c) => (left.get(c.id) ?? 0) >= toMilli(l.quantity));
      if (!rl) {
        const remain = candidates.reduce((n, c) => n + (left.get(c.id) ?? 0), 0) / 1000;
        fields[`lines.${i}.quantity`] = `${s.barcode}: เกินจำนวนที่ต้องส่งคืน (คงค้าง ${formatNumber(remain)})`;
        return;
      }
      left.set(rl.id, (left.get(rl.id) ?? 0) - toMilli(l.quantity));
      returnAlloc.set(l.serialId, rl.id);
    });
    if (Object.keys(fields).length) throw new ApiError(400, Object.values(fields)[0], fields);
  }
  return { serials, returnAlloc };
}

async function writeLines(tx: TxClient, issueId: string, d: IssueData, refs: { serials: { id: string; productId: string }[]; returnAlloc: Map<string, string> }) {
  const { serials, returnAlloc } = refs;
  await tx.goodsIssueLine.deleteMany({ where: { issueId } });
  await tx.goodsIssueLine.createMany({
    data: d.lines.map((l, i) => ({
      issueId,
      lineNo: i + 1,
      serialId: l.serialId,
      productId: serials.find((s) => s.id === l.serialId)!.productId,
      quantity: l.quantity,
      returnLineId: returnAlloc.get(l.serialId) ?? null,
      note: l.note,
    })),
  });
}

const header = (d: IssueData) => ({
  type: d.type,
  docDate: dateOnly(d.docDate),
  contactId: d.contactId,
  purchaseReturnId: d.type === "RETURN" ? d.purchaseReturnId : null,
  recipientName: d.recipientName,
  shippingAddress: d.shippingAddress,
  note: d.note,
});

/** สร้างใบนำออก — post = true จะนำออกทันทีใน transaction เดียวกัน (ไม่สำเร็จ = ไม่บันทึกอะไรเลย) */
export async function createIssue(actor: CurrentUser, d: IssueData, post: boolean, ip: string | null) {
  const doc = await createIssueTx(actor, d, post, ip);
  if (post) kickNotificationWorker();
  return doc;
}

async function createIssueTx(actor: CurrentUser, d: IssueData, post: boolean, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const refs = await assertRefs(tx, d);
    const docNo = await allocateDocNumber(tx, DOC_PREFIXES.GOODS_ISSUE);
    const doc = await tx.goodsIssue.create({ data: { ...header(d), docNo, createdById: actor.id } });
    await writeLines(tx, doc.id, d, refs);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_ISSUE, entityId: doc.id, action: "CREATE", after: await snapshot(tx, doc.id), ip });
    if (post) await postAndAudit(tx, actor, doc.id, ip);
    return doc;
  }, STOCK_TX);
}

export async function updateIssue(actor: CurrentUser, id: string, d: IssueData, post: boolean, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM goods_issues WHERE id = ${id} FOR UPDATE`;
    if (!rows[0]) throw new ApiError(404, "ไม่พบใบนำออก");
    if (rows[0].status !== "DRAFT") throw new ApiError(409, "แก้ไขได้เฉพาะใบนำออกที่เป็นร่าง");
    const cur = await tx.goodsIssue.findUniqueOrThrow({ where: { id }, select: { purchaseReturnId: true } });
    const refs = await assertRefs(tx, d, cur.purchaseReturnId);
    const before = await snapshot(tx, id);
    await tx.goodsIssue.update({ where: { id }, data: { ...header(d), updatedById: actor.id } });
    await writeLines(tx, id, d, refs);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_ISSUE, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
    if (post) await postAndAudit(tx, actor, id, ip);
  }, STOCK_TX);
}

async function postAndAudit(tx: TxClient, actor: CurrentUser, id: string, ip: string | null) {
  const before = await snapshot(tx, id);
  await postIssue(tx, id, actor.id);
  await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_ISSUE, entityId: id, action: "STATUS_CHANGE", before, after: await snapshot(tx, id), note: "นำออกจากคลัง", ip });
}

export async function postIssueDoc(actor: CurrentUser, id: string, ip: string | null) {
  await prisma.$transaction((tx) => postAndAudit(tx, actor, id, ip), STOCK_TX);
  kickNotificationWorker();
}

export async function cancelIssueDoc(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  await cancelIssueTx(actor, id, reason, ip);
  kickNotificationWorker();
}

async function cancelIssueTx(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, id);
    const res = await cancelIssue(tx, id, actor.id, reason);
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_ISSUE,
      entityId: id,
      action: "CANCEL",
      before,
      after: await snapshot(tx, id),
      note: `${res.wasPosted ? "ยกเลิกและคืนสต๊อก" : "ยกเลิกร่าง"}: ${reason}`,
      ip,
    });
    const doc = await tx.goodsIssue.findUniqueOrThrow({ where: { id }, select: { docNo: true } });
    await cancelDeliveriesOfIssue(tx, id, doc.docNo, actor.id, ip);
  }, STOCK_TX);
}

/** ข้อมูลใบนำออกสำหรับหน้าฟอร์ม (รวมคงเหลือปัจจุบันของแต่ละ SN) */
export async function getIssueDetail(id: string) {
  const d = await prisma.goodsIssue.findUnique({
    where: { id },
    include: {
      ...issueInclude,
      lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } }, serial: { include: { warehouse: true } } } },
    },
  });
  if (!d) return null;
  const ids = d.lines.map((l) => l.serialId);
  const [bal, nodes] = await Promise.all([prisma.$transaction((tx) => serialBalances(tx, ids)), prisma.stockLocation.findMany()]);
  const lines = d.lines.map((l) => ({
    serial: {
      serialId: l.serialId,
      barcode: l.serial.barcode,
      productId: l.productId,
      productCode: l.product.code,
      productName: l.product.name,
      unit: l.product.stockUnit?.name ?? "",
      warehouse: l.serial.warehouse?.name ?? "",
      location: l.serial.locationId && l.serial.locationId !== l.serial.warehouseId ? pathLabel(nodes as TreeNode[], l.serial.locationId).split(" > ").slice(1).join(" > ") : "",
      lot: l.serial.lot,
      balance: bal.get(l.serialId) ?? 0,
    } satisfies SerialInfo,
    quantity: l.quantity.toString(),
    note: l.note ?? "",
  }));
  return { doc: d, lines };
}
