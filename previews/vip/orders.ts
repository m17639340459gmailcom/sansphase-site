// Local preview only. Never imported by the production server or browser bundle.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { addCalendarMonth } from "../../server/reader-membership.ts";

export type ContactKind = "qq" | "wechat";
export type OrderStatus = "pending" | "paid" | "failed" | "cancelled";
export type DemoOrder = {
  id: string;
  readerId: string;
  amountFen: number;
  contactKind: ContactKind;
  contact: string;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  vipUntil: string | null;
};
export type DemoReader = {
  id: string;
  uid: string;
  nickname: string;
  email: string;
  phone: string;
  signature: string;
  vip: boolean;
  vipUntil: string | null;
};
export type OrderPage = {
  orders: DemoOrder[];
  total: number;
  page: number;
  totalPages: number;
};
export type AdminOrderPage = Omit<OrderPage, "orders"> & {
  orders: (DemoOrder & { nickname: string; uid: string })[];
};

export function createDemoOrders(path: string, clock = Date.now) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS demo_members (id TEXT PRIMARY KEY,until TEXT);
    CREATE TABLE IF NOT EXISTS demo_orders (id TEXT PRIMARY KEY,reader_id TEXT NOT NULL,amount INTEGER NOT NULL,kind TEXT NOT NULL,contact TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,paid_at TEXT,vip_until TEXT);`);
  for (const [id, offset] of [
    ["reader", 0],
    ["vip", 3],
    ["expired", -1],
  ] as const)
    db.prepare("INSERT OR IGNORE INTO demo_members VALUES (?,?)").run(
      id,
      offset ? new Date(clock() + offset * 86400000).toISOString() : null,
    );
  const member = (id: string) => {
    const value = db.prepare("SELECT * FROM demo_members WHERE id=?").get(id);
    if (!value) throw Error("请选择有效的演示账号。");
    return value;
  };
  const map = (row: Record<string, unknown>): DemoOrder => ({
    id: String(row.id),
    readerId: String(row.reader_id),
    amountFen: Number(row.amount),
    contactKind: row.kind as ContactKind,
    contact: String(row.contact),
    status: row.status as OrderStatus,
    createdAt: String(row.created_at),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    vipUntil: row.vip_until ? String(row.vip_until) : null,
  });
  const order = (readerId: string, id: string) => {
    member(readerId);
    const row = db
      .prepare("SELECT * FROM demo_orders WHERE reader_id=? AND id=?")
      .get(readerId, id);
    return row ? map(row) : null;
  };
  const paginate = (
    where: string,
    args: string[],
    page: number,
    size: number,
  ): OrderPage => {
    if (!Number.isSafeInteger(page) || page < 1) throw Error("无效的页码。");
    const total = Number(
      db
        .prepare(`SELECT count(*) AS total FROM demo_orders ${where}`)
        .get(...args)!.total,
    );
    const totalPages = Math.max(1, Math.ceil(total / size));
    page = Math.min(page, totalPages);
    return {
      total,
      page,
      totalPages,
      orders: db
        .prepare(
          `SELECT * FROM demo_orders ${where} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, size, (page - 1) * size)
        .map(map),
    };
  };
  return {
    reader(id: string): DemoReader {
      const value = member(id),
        until = value.until ? String(value.until) : null;
      return {
        id,
        uid: id === "reader" ? "100001" : id === "vip" ? "100002" : "100003",
        nickname:
          id === "reader"
            ? "普通读者示例"
            : id === "vip"
              ? "临近到期示例"
              : "已到期示例",
        email: `${id}@example.test`,
        phone: "13800138000",
        signature: "本地测试资料，不是真实用户。",
        vip: Boolean(until && Date.parse(until) > clock()),
        vipUntil: until,
      };
    },
    order,
    count(readerId: string) {
      member(readerId);
      return Number(
        db
          .prepare(
            "SELECT count(*) AS total FROM demo_orders WHERE reader_id=?",
          )
          .get(readerId)!.total,
      );
    },
    page(readerId: string, page: number) {
      member(readerId);
      return paginate("WHERE reader_id=?", [readerId], page, 5);
    },
    adminPage(page: number, status: string): AdminOrderPage {
      if (!["all", "pending", "paid", "failed", "cancelled"].includes(status))
        throw Error("无效的订单状态。");
      const result = paginate(
        status === "all" ? "" : "WHERE status=?",
        status === "all" ? [] : [status],
        page,
        10,
      );
      return {
        ...result,
        orders: result.orders.map((order) => {
          const { nickname, uid } = this.reader(order.readerId);
          return { ...order, nickname, uid };
        }),
      };
    },
    create(readerId: string, kind: string, contact: string): DemoOrder {
      member(readerId);
      contact = String(contact).trim();
      if (
        !["qq", "wechat"].includes(kind) ||
        !contact ||
        contact.length > 64 ||
        /[\u0000-\u001f\u007f]/.test(contact)
      )
        throw Error("请选择 QQ 或微信，并填写 1 至 64 个字符的联系账号。");
      const id = "DEMO-" + randomUUID(),
        now = new Date(clock()).toISOString();
      // Amount is fixed by the local server, never accepted from a browser field.
      db.prepare("INSERT INTO demo_orders VALUES (?,?,?,?,?,?,?,?,?)").run(
        id,
        readerId,
        20000,
        kind,
        contact,
        "pending",
        now,
        null,
        null,
      );
      return order(readerId, id)!;
    },
    finish(
      readerId: string,
      id: string,
      outcome: "paid" | "failed" | "cancelled",
    ): DemoOrder {
      if (!["paid", "failed", "cancelled"].includes(outcome))
        throw Error("无效的模拟结果。");
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = order(readerId, id);
        if (!current) throw Error("订单不存在。");
        if (current.status === outcome) {
          db.exec("COMMIT");
          return current;
        }
        if (current.status !== "pending")
          throw Error("已结束的订单不能再次支付，请重新创建订单。");
        const now = clock(),
          paidAt = outcome === "paid" ? new Date(now).toISOString() : null;
        let vipUntil: string | null = null;
        if (outcome === "paid") {
          const value = member(readerId),
            until = Date.parse(String(value.until || ""));
          vipUntil = addCalendarMonth(
            new Date(
              Number.isFinite(until) ? Math.max(now, until) : now,
            ).toISOString(),
          );
          db.prepare("UPDATE demo_members SET until=? WHERE id=?").run(
            vipUntil,
            readerId,
          );
        }
        db.prepare(
          "UPDATE demo_orders SET status=?,paid_at=?,vip_until=? WHERE id=?",
        ).run(outcome, paidAt, vipUntil, id);
        db.exec("COMMIT");
        return order(readerId, id)!;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
